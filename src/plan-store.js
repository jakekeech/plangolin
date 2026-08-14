// One live plan review, expressed as an observable attempt state machine.
// The persisted project map and the temporary plan impacts stay separate: the
// former owns component identity, while the latter exists only for this review.

import { splitSteps, stepCount } from "./plan-steps.js";
import { planImpact, remapImpactTargets, validateImpacts } from "./plan-impact.js";
import { buildBrief } from "./plan-brief.js";
import { planReach } from "./plan-reach.js";
import { load, saveIfEmpty, docFromMoves } from "./schema.js";
import { buildFileGraph, fingerprintGraph } from "./filegraph.js";
import {
  discoverProject,
  nameProject,
  movesFromDiscovery,
  provisionalImpactContext,
} from "./adopt.js";
import {
  readPreparation,
  preparationStartup,
  followPreparation,
} from "./preparation.js";

export const COLD_IMPACT_CONCURRENCY = false;
export const MAX_BROWSER_COUNT = 1_000_000;
export const MAX_BROWSER_NOTE_LENGTH = 500;

const WORKING_PHASES = new Set([
  "loading_system_map",
  "mapping_project",
  "grouping_components",
  "naming_components",
  "naming_and_matching",
  "matching_plan",
  "arranging_review",
]);
const PHASE_RANK = new Map([...WORKING_PHASES].map((phase, index) => [phase, index]));

let counter = 0;
const nextId = () => (++counter).toString(36) + Math.random().toString(36).slice(2, 6);
const decided = (review) => review.status === "resolved" || review.status === "skipped";
const boundedCount = (value) => Number.isFinite(value)
  ? Math.min(MAX_BROWSER_COUNT, Math.max(0, Math.floor(value)))
  : 0;
const boundedNote = (value) => (typeof value === "string" ? value : "")
  .replace(/\s+/g, " ").trim().slice(0, MAX_BROWSER_NOTE_LENGTH);

const sheetNodes = (nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter((node) => node && typeof node === "object" && typeof node.id === "string");

const truncationNote = (review) => review.truncated
  ? `This plan is longer than plangolin reads — only the first ${review.steps.length} steps were reviewed.`
  : "";

const browserState = (review) => {
  if (!review) return null;
  const {
    id, status, phase, revision, elapsedMs, counts, steps, impacts, reach, note,
  } = review;
  return { id, status, phase, revision, elapsedMs, counts, steps, impacts, reach, note };
};

async function keepScan(ws, moves) {
  try {
    const scanned = docFromMoves(moves);
    if (!scanned.nodes.length) return;
    await saveIfEmpty(ws, scanned);
  } catch {
    // An unwritable workspace still gets a transient review.
  }
}

function scanResult(record) {
  return {
    moves: Array.isArray(record?.moves) ? record.moves : [],
    dropped: Array.isArray(record?.dropped) ? record.dropped : [],
    provider: record?.provider ?? null,
    model: record?.model ?? null,
  };
}

function changedIds(impacts) {
  const ids = new Set();
  for (const impact of impacts) {
    if ((impact.level === "component" || impact.level === "support") && impact.targetId) {
      ids.add(impact.targetId);
    }
    for (const item of impact.removals || []) ids.add(item.id);
    for (const item of impact.responsibilities || []) ids.add(item.id);
    for (const item of impact.connections || []) { ids.add(item.from); ids.add(item.to); }
    for (const item of impact.disconnections || []) { ids.add(item.from); ids.add(item.to); }
  }
  return ids;
}

export function createPlanStore(dependencies = {}) {
  const deps = {
    now: Date.now,
    setTimeout,
    clearTimeout,
    onPublish: null,
    buildGraph: buildFileGraph,
    fingerprintGraph,
    readPreparation,
    preparationStartup,
    followPreparation,
    discoverProject,
    nameProject,
    movesFromDiscovery,
    provisionalImpactContext,
    remapImpactTargets,
    validateImpacts,
    impact: planImpact,
    coldImpactConcurrency: COLD_IMPACT_CONCURRENCY,
    ...dependencies,
  };

  let review = null;
  let waiters = [];
  let scanning = null;

  const isCurrentAttempt = (token) => Boolean(
    review && review.id === token.id && review.attempt === token.attempt,
  );

  const notify = () => {
    if (!deps.onPublish) return;
    try {
      Promise.resolve(deps.onPublish(browserState(review))).catch(() => {});
    } catch {
      // Observability can never become control flow for analysis.
    }
  };

  const publish = (patch = {}) => {
    if (!review) return false;
    const status = patch.status ?? review.status;
    const requestedPhase = patch.phase ?? review.phase;
    const phase = status === "working" && WORKING_PHASES.has(requestedPhase) ? requestedPhase : "";
    const note = boundedNote(patch.note ?? review.note);
    const measuredElapsed = patch.elapsedMs ?? Math.max(0, deps.now() - review.attemptStartedAt);
    const elapsedMs = Math.max(review.elapsedMs || 0, measuredElapsed);
    const rawCounts = { ...review.counts, ...(patch.counts || {}) };
    const counts = {
      files: boundedCount(rawCounts.files),
      links: boundedCount(rawCounts.links),
      components: boundedCount(rawCounts.components),
      steps: boundedCount(review.steps.length),
    };
    Object.assign(review, patch, {
      status,
      phase,
      note,
      elapsedMs: Math.max(0, elapsedMs),
      counts,
      revision: review.revision + 1,
    });
    notify();
    return true;
  };

  const adoptionProgress = (token, event = {}) => {
    const phase = WORKING_PHASES.has(event.phase) ? event.phase : review?.phase;
    if (!isCurrentAttempt(token) || review.status !== "working" || !phase) return;
    if (PHASE_RANK.get(phase) < PHASE_RANK.get(review.phase)) return;
    publish({
      phase,
      counts: event.counts,
      ...(Number.isFinite(event.elapsed) ? { elapsedMs: event.elapsed } : {}),
    });
  };

  const completeAttempt = (token, result) => {
    if (!isCurrentAttempt(token) || review.status !== "working") return false;
    const impacts = result.impacts;
    publish({ phase: "arranging_review" });
    const partial = result.outcome === "partial" || result.diagnostics?.invalidOperations > 0 ||
      impacts.some((entry) => entry.level === "unresolved");
    review.diagnostics = result.diagnostics || {};
    review.accepted = new Set(impacts.map((entry) => entry.key));
    publish({
      status: partial ? "partial" : "ready",
      impacts,
      reach: planReach(review.edges, changedIds(impacts)),
      note: truncationNote(review),
    });
    return true;
  };

  const failAttempt = (token, error) => {
    if (!isCurrentAttempt(token) || review.status !== "working") return false;
    const generated = validateImpacts({ impacts: [] }, {
      nodes: review.nodes,
      edges: review.edges,
      steps: review.steps,
    });
    const message = error?.userFacing
      ? error.message
      : "Couldn't read this plan — review it by hand.";
    review.diagnostics = generated.diagnostics;
    review.accepted = new Set(generated.impacts.map((entry) => entry.key));
    publish({
      status: "error",
      impacts: generated.impacts,
      reach: [],
      note: [truncationNote(review), message].filter(Boolean).join(" "),
    });
    return true;
  };

  const useMoves = async (ws, result) => {
    const shared = scanResult(result);
    await keepScan(ws, shared.moves);
    const doc = docFromMoves(shared.moves);
    return { scan: shared, nodes: doc.nodes, edges: doc.edges };
  };

  const acquireColdMap = async (ws, graph, options, token) => {
    const onProgress = (event) => adoptionProgress(token, event);
    const discovery = await (options.discoverProject || deps.discoverProject)(ws, {
      graph,
      onProgress,
    });
    const name = options.nameProject || deps.nameProject;
    const movesFrom = options.movesFromDiscovery || deps.movesFromDiscovery;
    const concurrent = options.coldImpactConcurrency ?? deps.coldImpactConcurrency;
    let described;
    let provisional = null;
    if (concurrent) {
      adoptionProgress(token, {
        phase: "naming_and_matching",
        counts: { components: discovery.flatGroups.length },
      });
      const naming = name(discovery, { onProgress });
      adoptionProgress(token, { phase: "matching_plan" });
      const matching = (options.impact || deps.impact)(
        (options.provisionalImpactContext || deps.provisionalImpactContext)(discovery),
        token.steps,
        { deferValidation: true },
      );
      [described, provisional] = await Promise.all([naming, matching]);
    } else {
      described = await name(discovery, { onProgress });
    }
    const mapped = movesFrom(discovery, described);
    const finalMap = await useMoves(ws, {
      moves: mapped.moves,
      dropped: [...(discovery.dropped || []), ...(described.dropped || [])],
      provider: described.provider,
      model: described.model,
    });
    if (!provisional) return finalMap;

    const raw = provisional.raw || { impacts: provisional.impacts };
    const remapped = (options.remapImpactTargets || deps.remapImpactTargets)(raw, mapped.idFor);
    const validated = (options.validateImpacts || deps.validateImpacts)(remapped, {
      nodes: finalMap.nodes,
      edges: finalMap.edges,
      steps: token.steps,
    });
    const partial = validated.diagnostics.invalidOperations > 0 ||
      validated.impacts.some((entry) => entry.level === "unresolved");
    return {
      ...finalMap,
      impactResult: {
        ...validated,
        provider: provisional.provider,
        model: provisional.model,
        outcome: partial ? "partial" : "ready",
      },
    };
  };

  const acquireMap = async (ws, options, token) => {
    if (typeof options.scan === "function") {
      return useMoves(ws, await options.scan(ws));
    }
    const buildGraph = options.buildGraph || deps.buildGraph;
    const graph = await buildGraph(ws);
    adoptionProgress(token, {
      phase: "loading_system_map",
      counts: { files: graph.files.length, links: graph.links.length },
    });
    const fingerprint = (options.fingerprintGraph || deps.fingerprintGraph)(graph);
    const readExactPreparation = async () => {
      try {
        return await (options.readPreparation || deps.readPreparation)(ws.root, fingerprint);
      } catch {
        return null;
      }
    };

    let prepared = await readExactPreparation();
    if (prepared) return useMoves(ws, prepared);

    let startup = { live: false, ready: false };
    try {
      startup = await (options.preparationStartup || deps.preparationStartup)(ws.root);
    } catch {
      startup = { live: false, ready: false };
    }
    if (startup.live) {
      try {
        prepared = await (options.followPreparation || deps.followPreparation)(ws.root, fingerprint, {
          onProgress: (event) => adoptionProgress(token, event),
        });
      } catch {
        prepared = null;
      }
      if (prepared) return useMoves(ws, prepared);
    }

    prepared = await readExactPreparation();
    if (prepared) return useMoves(ws, prepared);

    return acquireColdMap(ws, graph, options, token);
  };

  const analyze = async (ws, token, options) => {
    let nodes = [];
    let edges = [];
    let preparedImpact = null;
    if (isCurrentAttempt(token) && review.mapReady) {
      nodes = review.nodes;
      edges = review.edges;
    } else {
      try {
        const { doc } = await load(ws);
        nodes = doc.nodes;
        edges = doc.edges;
      } catch {
        // An unreadable or absent map takes the discovery path.
      }
    }

    if (!nodes.length) {
      const mapWork = acquireMap(ws, options, token);
      scanning = mapWork.then(({ scan }) => scan);
      scanning.catch(() => {});
      const mapped = await mapWork;
      nodes = mapped.nodes;
      edges = mapped.edges;
      preparedImpact = mapped.impactResult || null;
    }

    if (!isCurrentAttempt(token) || review.status !== "working") return;
    review.nodes = nodes;
    review.edges = edges;
    review.mapReady = true;
    publish({
      phase: "matching_plan",
      counts: { ...(scanning ? {} : { links: edges.length }), components: nodes.length },
    });
    const result = preparedImpact || await (options.impact || deps.impact)({ nodes, edges }, token.steps);
    if (!result || !Array.isArray(result.impacts) || !["ready", "partial"].includes(result.outcome)) {
      throw new Error("plangolin's impact service returned a malformed response.");
    }
    completeAttempt(token, result);
  };

  const beginAttempt = (ws, options) => {
    review.attempt += 1;
    review.attemptStartedAt = deps.now();
    review.elapsedMs = 0;
    review.analysisOptions = options;
    review.accepted = new Set();
    const token = { id: review.id, attempt: review.attempt, steps: review.steps };
    publish({
      status: "working",
      phase: "loading_system_map",
      impacts: [],
      reach: [],
      note: truncationNote(review),
    });
    const running = analyze(ws, token, options).catch((error) => {
      failAttempt(token, error);
    });
    review.analysis = running;
    return running;
  };

  const release = (id, payload) => {
    const mine = waiters.filter((waiter) => waiter.id === id);
    waiters = waiters.filter((waiter) => waiter.id !== id);
    for (const waiter of mine) {
      deps.clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
  };

  const store = {
    open({ plan }) {
      if (review && !decided(review)) return { busy: true, id: review.id };
      scanning = null;
      const steps = splitSteps(plan);
      review = {
        id: nextId(),
        status: "working",
        phase: "loading_system_map",
        revision: 0,
        elapsedMs: 0,
        counts: { files: 0, links: 0, components: 0, steps: steps.length },
        plan: String(plan || ""),
        steps,
        impacts: [],
        reach: [],
        note: "",
        nodes: [],
        edges: [],
        accepted: new Set(),
        diagnostics: {},
        truncated: stepCount(plan) > steps.length,
        attempt: 0,
        attemptStartedAt: deps.now(),
        analysis: null,
        analysisOptions: {},
        mapReady: false,
      };
      review.note = truncationNote(review);
      publish({ phase: "loading_system_map", elapsedMs: 0 });
      return { id: review.id };
    },

    current() {
      return review;
    },

    forBrowser() {
      return browserState(review);
    },

    takeScan() {
      return scanning;
    },

    fill(ws, options = {}) {
      if (!review || review.status !== "working") return Promise.resolve();
      if (review.analysis) return review.analysis;
      return beginAttempt(ws, options);
    },

    resolve(id, { accepted, skipped, nodes } = {}) {
      if (!review || review.id !== id || decided(review)) return false;
      if (skipped) {
        publish({ status: "skipped" });
        scanning = null;
        release(id, { status: "skipped" });
        return true;
      }
      if (review.status !== "ready" && review.status !== "partial") return false;

      const knownKeys = new Set(review.impacts.map((entry) => entry.key));
      const acceptedKeys = new Set(
        (Array.isArray(accepted) ? accepted : []).filter((key) => knownKeys.has(key)),
      );
      const renamed = new Map(
        sheetNodes(nodes)
          .filter((node) => typeof node.name === "string" && node.name.trim())
          .map((node) => [node.id, node.name.trim()]),
      );
      const nodesForBrief = review.nodes.map((node) =>
        renamed.has(node.id) ? { ...node, name: renamed.get(node.id) } : node);
      review.brief = buildBrief({
        nodes: nodesForBrief,
        steps: review.steps,
        impacts: review.impacts,
        reach: review.reach,
        accepted: acceptedKeys,
        truncated: review.truncated,
      });
      review.accepted = acceptedKeys;
      publish({ status: "resolved" });
      scanning = null;
      release(id, { status: "resolved", brief: review.brief });
      return true;
    },

    retry(id, ws) {
      if (!review || review.id !== id || review.status !== "error") return false;
      review.analysis = null;
      beginAttempt(ws, review.analysisOptions || {});
      return true;
    },

    wait(id, ms) {
      if (!review || review.id !== id) return Promise.resolve({ status: "gone" });
      if (review.status === "resolved") return Promise.resolve({ status: "resolved", brief: review.brief || "" });
      if (review.status === "skipped") return Promise.resolve({ status: "skipped" });
      return new Promise((resolve) => {
        const waiter = { id, resolve, timer: null };
        waiter.timer = deps.setTimeout(() => {
          waiters = waiters.filter((entry) => entry !== waiter);
          resolve({ status: "pending" });
        }, ms);
        waiters.push(waiter);
      });
    },
  };

  return store;
}
