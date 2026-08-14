// Trust boundary for adaptive plan review. The hosted reply is deliberately
// treated as untrusted: this module validates operations, reports gaps,
// and is the only place that assigns review-local identities.

import { callTask } from "./llm.js";

const LEVELS = ["system", "component"];
const LEVEL_RANK = new Map([["system", 0], ["component", 1]]);
const OPERATION_NAMES = [
  "additions", "removals", "responsibilities", "connections", "disconnections",
];

const MAX_TITLE = 80;
const MAX_NAME = 60;
const MAX_KIND = 40;
const MAX_INTENT = 200;
const MAX_WHY = 200;
const MAX_LABEL = 40;
const MAX_EVIDENCE = 6;

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const list = (value) => Array.isArray(value) ? value : [];

function counts() {
  return {
    categories: { system: 0, component: 0, support: 0, unresolved: 0 },
    operations: {
      additions: 0, removals: 0, responsibilities: 0, connections: 0, disconnections: 0,
    },
  };
}

function keptCounts() {
  return {
    categories: { system: 0, component: 0 },
    operations: {
      additions: 0, removals: 0, responsibilities: 0, connections: 0, disconnections: 0,
    },
  };
}

function countRaw(rawImpacts) {
  const result = counts();
  for (const raw of rawImpacts) {
    if (!isObject(raw)) continue;
    if (Object.hasOwn(result.categories, raw.level)) result.categories[raw.level]++;
    for (const name of OPERATION_NAMES) result.operations[name] += list(raw[name]).length;
  }
  return result;
}

function countKept(impacts) {
  const result = keptCounts();
  for (const impact of impacts) {
    result.categories[impact.level]++;
    for (const name of OPERATION_NAMES) result.operations[name] += impact[name].length;
  }
  return result;
}

function cleanString(value, limit, diagnostics, field, { required = false, fallback = "" } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text && required) diagnostics.issues.push({ code: `blank_${field}`, field });
  if (text.length > limit) diagnostics.issues.push({ code: "oversized_string", field, limit });
  return text.slice(0, limit) || fallback;
}

function safePath(value) {
  if (typeof value !== "string") return "";
  const path = value.replace(/\\/g, "/").trim();
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "";
  const parts = path.split("/");
  if (parts.some((part) => part === "..")) return "";
  return parts.filter((part) => part && part !== ".").join("/");
}

function validateEvidence(raw, diagnostics) {
  const files = [];
  for (const value of list(raw.files)) {
    const path = safePath(value);
    if (!path) {
      diagnostics.issues.push({ code: "unsafe_path", field: "files" });
      continue;
    }
    if (files.length < MAX_EVIDENCE && !files.includes(path)) files.push(path);
  }

  const symbols = [];
  for (const value of list(raw.symbols)) {
    const symbol = typeof value === "string" ? value.trim() : "";
    if (symbol && symbols.length < MAX_EVIDENCE && !symbols.includes(symbol)) symbols.push(symbol);
  }
  return { files, symbols };
}

function validateSteps(values, validSteps, diagnostics, sourceIndex) {
  const result = [];
  for (const value of list(values)) {
    if (!Number.isInteger(value) || !validSteps.has(value)) {
      const issue = { code: "invalid_step", sourceIndex };
      if (typeof value === "number" && Number.isFinite(value)) issue.step = value;
      else issue.stepType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      diagnostics.issues.push(issue);
      continue;
    }
    if (!result.includes(value)) result.push(value);
  }
  result.sort((a, b) => a - b);
  return result;
}

function validId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
}

function validateAllAdditions(rawImpacts, existingIds, diagnostics) {
  const byImpact = new Map();
  const ids = new Set();

  rawImpacts.forEach((raw, sourceIndex) => {
    const additions = [];
    for (const addition of list(raw?.additions)) {
      if (!isObject(addition) || !validId(addition.id) || existingIds.has(addition.id) || ids.has(addition.id)) {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_addition", sourceIndex });
        continue;
      }
      const name = cleanString(addition.name, MAX_NAME, diagnostics, "addition_name", { required: true });
      const intent = cleanString(addition.intent, MAX_INTENT, diagnostics, "addition_intent", { required: true });
      if (!name || !intent) {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_addition", sourceIndex });
        continue;
      }
      const files = [];
      for (const value of list(addition.files)) {
        const path = safePath(value);
        if (!path) diagnostics.issues.push({ code: "unsafe_path", field: "addition.files", sourceIndex });
        else if (files.length < MAX_EVIDENCE && !files.includes(path)) files.push(path);
      }
      const rawDir = typeof addition.dir === "string" ? addition.dir.trim() : "";
      const dir = rawDir ? safePath(rawDir) : "";
      if (rawDir && !dir) diagnostics.issues.push({ code: "unsafe_path", field: "addition.dir", sourceIndex });
      ids.add(addition.id);
      additions.push({
        id: addition.id,
        name,
        kind: cleanString(addition.kind, MAX_KIND, diagnostics, "addition_kind"),
        intent,
        dir,
        files,
      });
    }
    byImpact.set(sourceIndex, additions);
  });
  return { ids, byImpact };
}

function validateCandidates(rawImpacts, context) {
  const {
    additions, existingIds, knownIds, existingEdges, validSteps, diagnostics,
  } = context;

  return rawImpacts.map((rawValue, sourceIndex) => {
    const raw = isObject(rawValue) ? rawValue : {};
    const steps = validateSteps(raw.steps, validSteps, diagnostics, sourceIndex);
    const evidence = validateEvidence(raw, diagnostics);
    const originalLevel = raw.level;
    const targetIsString = typeof raw.targetId === "string";
    const rawTargetId = targetIsString ? raw.targetId : "";
    let level = originalLevel;
    let targetId = rawTargetId;
    let invalidImpact = false;

    if (!LEVELS.includes(originalLevel)) {
      diagnostics.issues.push({ code: "invalid_level", sourceIndex });
      invalidImpact = true;
    } else if (!targetIsString) {
      diagnostics.issues.push({ code: "invalid_target", sourceIndex });
      invalidImpact = true;
    } else if (originalLevel === "system") {
      if (targetId) {
        diagnostics.issues.push({ code: "invalid_target", sourceIndex });
        invalidImpact = true;
      }
    } else if (originalLevel === "component") {
      if (!targetId || !knownIds.has(targetId)) {
        diagnostics.issues.push({ code: "invalid_target", sourceIndex });
        invalidImpact = true;
      }
    }

    const size = ["", "small", "substantial"].includes(raw.size) ? raw.size : "";
    if (size !== raw.size) {
      invalidImpact = true;
      diagnostics.issues.push({ code: "invalid_size", sourceIndex });
    }

    const title = cleanString(raw.title, MAX_TITLE, diagnostics, "title", {
      required: true, fallback: "Needs review",
    });
    if (title === "Needs review" && !(typeof raw.title === "string" && raw.title.trim())) invalidImpact = true;
    const why = cleanString(raw.why, MAX_WHY, diagnostics, "why");

    if (OPERATION_NAMES.some((name) => !Array.isArray(raw[name]))) {
      diagnostics.invalidOperations++;
      diagnostics.issues.push({ code: "invalid_operations_shape", sourceIndex });
      invalidImpact = true;
    }

    const operations = {
      additions: additions.byImpact.get(sourceIndex) || [],
      removals: [], responsibilities: [], connections: [], disconnections: [],
    };

    for (const removal of list(raw.removals)) {
      if (isObject(removal) && existingIds.has(removal.id)) operations.removals.push({ id: removal.id });
      else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_removal", sourceIndex });
      }
    }
    for (const responsibility of list(raw.responsibilities)) {
      const intent = cleanString(responsibility?.intent, MAX_INTENT, diagnostics, "responsibility_intent");
      const operationWhy = cleanString(responsibility?.why, MAX_WHY, diagnostics, "responsibility_why");
      if (isObject(responsibility) && existingIds.has(responsibility.id) && intent) {
        operations.responsibilities.push({ id: responsibility.id, intent, why: operationWhy });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_responsibility", sourceIndex });
      }
    }
    for (const connection of list(raw.connections)) {
      const from = connection?.from;
      const to = connection?.to;
      if (isObject(connection) && knownIds.has(from) && knownIds.has(to) && from !== to &&
          !existingEdges.has(`${from}\0${to}`)) {
        operations.connections.push({
          from, to,
          label: cleanString(connection.label, MAX_LABEL, diagnostics, "connection_label"),
        });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_connection", sourceIndex });
      }
    }
    for (const disconnection of list(raw.disconnections)) {
      const from = disconnection?.from;
      const to = disconnection?.to;
      if (isObject(disconnection) && existingEdges.has(`${from}\0${to}`)) {
        operations.disconnections.push({ from, to });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_disconnection", sourceIndex });
      }
    }

    const rawOperationCount = OPERATION_NAMES.reduce((sum, name) => sum + list(raw[name]).length, 0);
    const validOperationCount = OPERATION_NAMES.reduce((sum, name) => sum + operations[name].length, 0);
    if (level !== "system" && rawOperationCount) {
      diagnostics.invalidOperations += validOperationCount;
      diagnostics.issues.push({ code: "non_system_operations", sourceIndex });
      invalidImpact = true;
    }
    if (level === "system" && !validOperationCount) {
      diagnostics.issues.push({ code: "system_without_operation", sourceIndex });
      invalidImpact = true;
    }

    // A malformed structural claim cannot be repaired by keeping its surviving
    // operations: reject the whole decision, without keeping partial structure.
    if (level === "system" && diagnostics.issues.some((issue) =>
      issue.sourceIndex === sourceIndex && issue.code.startsWith("invalid_") &&
      ["invalid_addition", "invalid_removal", "invalid_responsibility", "invalid_connection", "invalid_disconnection"]
        .includes(issue.code))) invalidImpact = true;

    if (invalidImpact) {
      return null;
    }

    return { sourceIndex, level, targetId, title, why, size, steps, ...evidence, ...operations };
  }).filter(Boolean);
}

function revalidateCandidateReferences(candidates, existingIds, diagnostics) {
  let validated = candidates;
  for (;;) {
    const reachableIds = new Set(existingIds);
    for (const candidate of validated) {
      if (candidate.level !== "system") continue;
      for (const addition of candidate.additions) reachableIds.add(addition.id);
    }

    let changed = false;
    validated = validated.map((candidate) => {
      const orphanTarget = candidate.level === "component" && !reachableIds.has(candidate.targetId);
      const orphanConnections = candidate.connections.filter((connection) =>
        !reachableIds.has(connection.from) || !reachableIds.has(connection.to));
      if (!orphanTarget && !orphanConnections.length) return candidate;
      diagnostics.invalidOperations += orphanConnections.length;
      diagnostics.issues.push({ code: "orphan_reference", sourceIndex: candidate.sourceIndex });
      changed = true;
      return null;
    }).filter(Boolean);
    if (!changed) return validated;
  }
}

function resolveStepConflicts(candidates, diagnostics) {
  const owner = new Map();
  for (const candidate of candidates) {
    for (const step of candidate.steps) {
      const incumbent = owner.get(step);
      if (!incumbent || LEVEL_RANK.get(candidate.level) < LEVEL_RANK.get(incumbent.level)) {
        if (incumbent) {
          diagnostics.conflicts++;
        }
        owner.set(step, candidate);
      } else {
        diagnostics.conflicts++;
      }
    }
  }

  const owned = candidates.map((candidate) => ({
    ...candidate,
    steps: candidate.steps.filter((step) => owner.get(step) === candidate),
  }));
  for (const candidate of owned) {
    if (!candidate.steps.length) {
      diagnostics.droppedImpacts++;
      diagnostics.issues.push({ code: "no_owned_steps", sourceIndex: candidate.sourceIndex });
    }
  }
  return owned.filter((candidate) => candidate.steps.length);
}

function unmappedSteps(impacts, steps, rawUnmapped, diagnostics) {
  const claims = new Map();
  for (const impact of impacts) {
    for (const step of impact.steps) claims.set(step, (claims.get(step) || 0) + 1);
  }
  const declared = new Set(list(rawUnmapped).filter((step) => Number.isInteger(step)));
  const unmapped = [];
  for (const step of steps) {
    if (claims.has(step.n)) continue;
    unmapped.push(step.n);
    if (!declared.has(step.n)) diagnostics.issues.push({ code: "unmapped_step", step: step.n });
  }
  return unmapped;
}

function groupComponentImpacts(impacts) {
  const grouped = new Map();
  const out = [];
  for (const impact of impacts) {
    if (impact.level !== "component" || !impact.targetId) {
      out.push(impact);
      continue;
    }
    const existing = grouped.get(impact.targetId);
    if (!existing) {
      const copy = {
        ...impact,
        steps: [...impact.steps],
        files: [...impact.files],
        symbols: [...impact.symbols],
      };
      grouped.set(impact.targetId, copy);
      out.push(copy);
      continue;
    }
    existing.steps = [...new Set([...existing.steps, ...impact.steps])].sort((a, b) => a - b);
    existing.files = [...new Set([...existing.files, ...impact.files])].slice(0, MAX_EVIDENCE);
    existing.symbols = [...new Set([...existing.symbols, ...impact.symbols])].slice(0, MAX_EVIDENCE);
    if (impact.size === "substantial") existing.size = "substantial";
  }
  return out;
}

function assignTrustedKeys(validated, diagnostics, steps, rawUnmapped = []) {
  const impacts = validated.map(({ sourceIndex: _sourceIndex, ...impact }, index) => ({
    key: `impact:${index + 1}`,
    ...impact,
  }));
  const gaps = unmappedSteps(impacts, steps, rawUnmapped, diagnostics);
  diagnostics.kept = countKept(impacts);
  return {
    impacts,
    unmappedSteps: gaps,
    // Kept for the offline evaluation script; the live review no longer uses
    // coverage as a success gate or retries gaps.
    rejectedSteps: gaps,
    coverage: { claimed: steps.length - gaps.length, total: steps.length, complete: gaps.length === 0 },
    diagnostics,
  };
}

function ownedPaths(node) {
  if (Array.isArray(node?.anchor?.paths)) return node.anchor.paths;
  if (typeof node?.anchor?.dir === "string" && node.anchor.dir) return [`${node.anchor.dir.replace(/\/+$/, "")}/`];
  return list(node?.files);
}

function promptItem(node, provisional) {
  const id = provisional ? node.ref || node.id : node.id;
  return [
    `id: ${id}`,
    `name: ${node.name || id}`,
    `kind: ${node.kind || ""}`,
    `intent: ${node.intent || ""}`,
    `parent: ${node.parent || ""}`,
    `owns: ${ownedPaths(node).join(", ") || "(no files yet)"}`,
    provisional && node.rationale ? `rationale: ${node.rationale}` : "",
    provisional && list(node.dependencies).length ? `dependencies: ${node.dependencies.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export function buildImpactPrompt({ nodes = [], edges = [], groups = [] }, steps) {
  const components = nodes.length ? nodes : groups;
  const provisional = !nodes.length && groups.length > 0;
  return [
    "The current project map:",
    "",
    components.length ? components.map((node) => promptItem(node, provisional)).join("\n\n") : "(empty project map)",
    "",
    "Directed edges:",
    edges.length
      ? edges.map((edge) => `${edge.from} -> ${edge.to}${edge.label ? `: ${edge.label}` : ""}`).join("\n")
      : "(none)",
    "",
    "The plan, preserving supplied step numbers:",
    "",
    steps.map((step) => `${step.n}. ${step.text}`).join("\n"),
  ].join("\n");
}

/** Compatibility for the offline evaluator. Live review never calls this. */
export function buildPlacementRetryPrompt(context, steps) {
  return buildImpactPrompt(context, steps);
}

export function validateImpacts(raw, { nodes = [], edges = [], steps = [] }) {
  const rawImpacts = isObject(raw) && Array.isArray(raw.impacts) ? raw.impacts : [];
  const diagnostics = {
    issues: [], invalidOperations: 0, conflicts: 0, droppedImpacts: 0,
    raw: countRaw(rawImpacts), kept: keptCounts(),
  };
  const existingIds = new Set(nodes.map((node) => node.id).filter((id) => typeof id === "string"));
  const validSteps = new Set(steps.map((step) => step.n));
  const existingEdges = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
  const additions = validateAllAdditions(rawImpacts, existingIds, diagnostics);
  const knownIds = new Set([...existingIds, ...additions.ids]);
  const candidates = revalidateCandidateReferences(validateCandidates(rawImpacts, {
    additions, existingIds, knownIds, existingEdges, validSteps, diagnostics,
  }), existingIds, diagnostics);
  const owned = revalidateCandidateReferences(
    resolveStepConflicts(candidates, diagnostics), existingIds, diagnostics,
  );
  return assignTrustedKeys(groupComponentImpacts(owned), diagnostics, steps, raw?.unmappedSteps);
}

function mapId(value, idFor) {
  if (idFor instanceof Map) return idFor.get(value) || value;
  if (typeof idFor === "function") return idFor(value) || value;
  if (isObject(idFor)) return idFor[value] || value;
  return value;
}

export function remapImpactTargets(raw, idFor) {
  if (!isObject(raw) || !Array.isArray(raw.impacts)) return raw;
  return {
    ...raw,
    impacts: raw.impacts.map((impact) => {
      if (!isObject(impact)) return impact;
      return {
        ...impact,
        targetId: mapId(impact.targetId, idFor),
        removals: list(impact.removals).map((operation) =>
          isObject(operation) ? { ...operation, id: mapId(operation.id, idFor) } : operation),
        responsibilities: list(impact.responsibilities).map((operation) =>
          isObject(operation) ? { ...operation, id: mapId(operation.id, idFor) } : operation),
        connections: list(impact.connections).map((operation) => isObject(operation) ? {
          ...operation, from: mapId(operation.from, idFor), to: mapId(operation.to, idFor),
        } : operation),
        disconnections: list(impact.disconnections).map((operation) => isObject(operation) ? {
          ...operation, from: mapId(operation.from, idFor), to: mapId(operation.to, idFor),
        } : operation),
      };
    }),
  };
}

function malformedResponseError() {
  const error = new Error("plangolin's impact service returned a malformed response.");
  error.validation = true;
  return error;
}

function parsedImpacts(response) {
  return isObject(response) && isObject(response.parsed) && Array.isArray(response.parsed.impacts)
    ? response.parsed
    : null;
}

export async function planImpact(context, steps, {
  call = callTask,
} = {}) {
  const prompt = buildImpactPrompt(context, steps);
  const response = await call({ task: "impact", prompt });
  const parsed = parsedImpacts(response);
  if (!parsed) throw malformedResponseError();
  const validated = validateImpacts(parsed, { ...context, steps });
  return { ...validated, provider: response.provider, model: response.model, outcome: "ready" };
}
