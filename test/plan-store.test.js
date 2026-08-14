import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COLD_IMPACT_CONCURRENCY,
  MAX_BROWSER_COUNT,
  MAX_BROWSER_NOTE_LENGTH,
  createPlanStore,
} from "../src/plan-store.js";
import { emptyDoc, load as loadDoc, save as saveDoc } from "../src/schema.js";
import {
  followPreparation as followPreparedLease,
  preparationPaths,
  preparationStartup as inspectPreparationStartup,
  readPreparation as readPreparedLease,
} from "../src/preparation.js";

const PLAN = "1. Add a limiter\n2. Wire it up\n";
const STEPS = [
  { n: 1, text: "Add a limiter" },
  { n: 2, text: "Wire it up" },
];
const NODES = [
  { id: "server", name: "Server", intent: "Serves the app." },
  { id: "store", name: "Store", intent: "Stores records." },
];
const EDGES = [
  { id: "server__store", from: "server", to: "store", label: "reads" },
];
const SYSTEM = { version: 1, nodes: NODES, edges: EDGES, notes: [], types: {}, dismissed: [] };

function impact(overrides = {}) {
  return {
    key: "impact:1",
    level: "component",
    targetId: "server",
    title: "Add request limiting",
    why: "Protects the server.",
    size: "small",
    steps: [1, 2],
    files: [],
    symbols: [],
    additions: [],
    removals: [],
    responsibilities: [],
    connections: [],
    disconnections: [],
    ...overrides,
  };
}

const readyResult = (overrides = {}) => ({
  impacts: [impact()],
  diagnostics: { invalidOperations: 0, issues: [] },
  coverage: { claimed: 2, total: 2 },
  provider: "test-provider",
  model: "test-model",
  outcome: "ready",
  ...overrides,
});

function memWs(system = null) {
  const files = new Map();
  if (system) files.set("plangolin/system.json", JSON.stringify(system));
  return {
    root: "/tmp/plangolin-plan-store",
    files,
    async read(file) { return files.get(file) ?? null; },
    async write(file, contents) { files.set(file, contents); },
    async exists(file) { return files.has(file); },
    async list() { return []; },
  };
}

function phases(states) {
  return states.map((state) => state.phase).filter((phase, index, all) =>
    phase && phase !== all[index - 1]);
}

function assertMonotonicRevisions(states) {
  assert.ok(states.length > 1);
  for (let index = 1; index < states.length; index++) {
    assert.equal(states[index].revision, states[index - 1].revision + 1);
  }
}

function recordingStore(dependencies = {}) {
  const states = [];
  const store = createPlanStore({
    ...dependencies,
    onPublish(state) { states.push(structuredClone(state)); },
  });
  return { store, states };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function drainMicrotasks(turns = 8) {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

test("warm review publishes the browser contract and legal phases", async () => {
  const { store, states } = recordingStore({
    impact: async () => readyResult(),
    adopt: async () => { throw new Error("warm review must not adopt"); },
  });
  const { id } = store.open({ plan: PLAN });
  await store.fill(memWs(SYSTEM));

  assert.deepEqual(Object.keys(store.forBrowser()).sort(), [
    "counts", "elapsedMs", "id", "impacts", "mapEdges", "note", "phase", "reach",
    "revision", "status", "steps",
  ]);
  assert.deepEqual(store.forBrowser(), {
    id,
    status: "ready",
    phase: "",
    revision: states.at(-1).revision,
    elapsedMs: states.at(-1).elapsedMs,
    counts: { files: 0, links: 1, components: 2, steps: 2 },
    steps: STEPS,
    impacts: [impact()],
    reach: [],
    mapEdges: [{ ...EDGES[0], origin: "user", operations: [] }],
    note: "",
  });
  assert.deepEqual(phases(states), ["loading_system_map", "matching_plan", "arranging_review"]);
  assertMonotonicRevisions(states);
  assert.ok(states.every((state) => state.status === "working" || state.phase === ""));
  assert.equal("plan" in store.forBrowser(), false);
  assert.equal("diagnostics" in store.forBrowser(), false);
  assert.equal("nodes" in store.forBrowser(), false);
});

test("prepared review uses loading, matching, and arranging phases", async () => {
  const moves = NODES.map((node) => ({ t: "addNode", node }));
  const { store, states } = recordingStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "a".repeat(64),
    readPreparation: async () => ({ moves, dropped: [], provider: "test", model: "test" }),
    impact: async () => readyResult(),
    adopt: async () => { throw new Error("prepared review must not adopt"); },
  });
  store.open({ plan: PLAN });
  await store.fill(memWs());

  assert.deepEqual(phases(states), ["loading_system_map", "matching_plan", "arranging_review"]);
  assertMonotonicRevisions(states);
  assert.equal(store.current().status, "ready");
  assert.equal(store.current().phase, "");
});

test("unprepared serial review reports every honest phase", async () => {
  const graph = {
    files: ["src/server.js", "src/store.js"],
    links: [{ from: "src/server.js", to: "src/store.js", kind: "import", names: ["read"] }],
    capped: false,
  };
  const discovery = {
    graph,
    groups: [],
    flatGroups: [{ id: "group:server", files: graph.files, allFiles: graph.files, parent: null }],
    dependencies: new Map(), excerpts: new Map(), dropped: [],
  };
  const described = { blocks: [], labels: new Map(), dropped: [], provider: "test", model: "test" };
  const moves = NODES.map((node) => ({ t: "addNode", node }));
  const { store, states } = recordingStore({
    buildGraph: async () => graph,
    fingerprintGraph: () => "b".repeat(64),
    readPreparation: async () => null,
    preparationStartup: async () => ({ live: false, ready: false }),
    discoverProject: async (_ws, { onProgress }) => {
      await onProgress({ phase: "mapping_project", counts: { files: 2, links: 1 } });
      await onProgress({ phase: "grouping_components", counts: { components: 1 } });
      return discovery;
    },
    nameProject: async (_discovery, { onProgress }) => {
      await onProgress({ phase: "naming_components", counts: { components: 1 } });
      return described;
    },
    movesFromDiscovery: () => ({ moves, idFor: new Map([["group:server", "server"]]) }),
    impact: async () => readyResult(),
  });
  store.open({ plan: PLAN });
  await store.fill(memWs());

  assert.deepEqual(phases(states), [
    "loading_system_map", "mapping_project", "grouping_components",
    "naming_components", "matching_plan", "arranging_review",
  ]);
  assertMonotonicRevisions(states);
  assert.deepEqual(store.forBrowser().counts, { files: 2, links: 1, components: 2, steps: 2 });
  assert.equal(store.forBrowser().status, "ready");
  assert.equal(store.forBrowser().phase, "");
});

test("validated complete and invalidated results become truthful outcomes", async () => {
  const readyStore = createPlanStore({ impact: async () => readyResult() });
  readyStore.open({ plan: PLAN });
  await readyStore.fill(memWs(SYSTEM));
  assert.equal(readyStore.current().status, "ready");

  const unresolved = impact({
    level: "unresolved", targetId: "", title: "Needs review", why: "Placement is unclear.", size: "",
  });
  const partialStore = createPlanStore({
    impact: async () => readyResult({ impacts: [unresolved], outcome: "partial" }),
  });
  partialStore.open({ plan: PLAN });
  await partialStore.fill(memWs(SYSTEM));
  assert.equal(partialStore.current().status, "partial");

  const invalidatedStore = createPlanStore({
    impact: async () => readyResult({
      diagnostics: { invalidOperations: 1, issues: [{ code: "invalid_connection" }] },
      outcome: "ready",
    }),
  });
  invalidatedStore.open({ plan: PLAN });
  await invalidatedStore.fill(memWs(SYSTEM));
  assert.equal(invalidatedStore.current().status, "partial");
});

test("browser counts are safe bounded integers and provider notes are normalized and bounded", async () => {
  const longMessage = `  Impact service\n unavailable   ${"private-detail ".repeat(100)}`;
  const cases = [
    {
      raw: { files: -3.5, links: Infinity, components: MAX_BROWSER_COUNT + 50_000 },
      expected: { files: 0, links: 0, components: MAX_BROWSER_COUNT, steps: 2 },
    },
    {
      raw: { files: 3.9, links: 2.1, components: 1.5 },
      expected: { files: 3, links: 2, components: 1, steps: 2 },
    },
  ];

  for (const { raw, expected } of cases) {
    const store = createPlanStore({
      buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
      fingerprintGraph: () => "9".repeat(64),
      readPreparation: async () => null,
      preparationStartup: async () => ({ live: false, ready: false }),
      discoverProject: async (_ws, { onProgress }) => {
        await onProgress({ phase: "mapping_project", counts: raw });
        const error = new Error(longMessage);
        error.userFacing = true;
        throw error;
      },
    });
    store.open({ plan: PLAN });
    await store.fill(memWs());
    const state = store.forBrowser();

    assert.deepEqual(state.counts, expected);
    assert.ok(Object.values(state.counts).every((value) =>
      Number.isSafeInteger(value) && value >= 0 && value <= MAX_BROWSER_COUNT));
    assert.equal(state.note.length, MAX_BROWSER_NOTE_LENGTH);
    assert.match(state.note, /^Impact service unavailable private-detail/);
    assert.doesNotMatch(state.note, /\s{2,}|\n/);
  }
});

test("call failures, malformed envelopes, and impact 404s stay errors with complete display coverage", async () => {
  const failures = [
    {
      name: "provider failure",
      impact: async () => { throw new Error("provider leaked detail"); },
      note: /review it by hand/i,
    },
    {
      name: "malformed envelope",
      impact: async () => ({ provider: "test", model: "test" }),
      note: /review it by hand/i,
    },
    {
      name: "unsupported impact endpoint",
      impact: async () => {
        const error = new Error("This Plangolin service does not support impact review yet. Retry after it updates, or skip this review.");
        error.userFacing = true;
        error.serviceVersion = true;
        throw error;
      },
      note: /does not support impact review/i,
    },
  ];

  for (const failure of failures) {
    const store = createPlanStore({ impact: failure.impact });
    const { id } = store.open({ plan: PLAN });
    await store.fill(memWs(SYSTEM));
    const state = store.forBrowser();
    assert.equal(state.id, id, failure.name);
    assert.equal(state.status, "error", failure.name);
    assert.equal(state.phase, "", failure.name);
    assert.match(state.note, failure.note, failure.name);
    assert.deepEqual(state.impacts.map(({ key, level, targetId, title, steps }) =>
      ({ key, level, targetId, title, steps })), [
      { key: "impact:1", level: "unresolved", targetId: "", title: "Needs review", steps: [1] },
      { key: "impact:2", level: "unresolved", targetId: "", title: "Needs review", steps: [2] },
    ], failure.name);
    assert.ok(state.impacts.every((entry) =>
      ["additions", "removals", "responsibilities", "connections", "disconnections"]
        .every((field) => Array.isArray(entry[field]) && entry[field].length === 0)), failure.name);
    assert.equal(store.resolve(id, { accepted: state.impacts.map((entry) => entry.key), nodes: NODES }), false);
    assert.equal(store.current().status, "error");
  }
});

test("partial review can be approved using only trusted impact keys", async () => {
  const kept = impact({
    level: "unresolved", targetId: "", title: "Confirm limiter placement", why: "The component is unclear.", size: "",
  });
  const store = createPlanStore({
    impact: async () => readyResult({ impacts: [kept], outcome: "partial" }),
  });
  const { id } = store.open({ plan: PLAN });
  await store.fill(memWs(SYSTEM));
  const waiting = store.wait(id, 5_000);

  assert.equal(store.resolve(id, {
    accepted: ["impact:1", "impact:unknown"],
    nodes: [{ id: "server", name: "Renamed Server" }, { id: "foreign", name: "Foreign" }],
  }), true);
  const result = await waiting;
  assert.equal(result.status, "resolved");
  assert.match(result.brief, /NEEDS REVIEW/);
  assert.match(result.brief, /Confirm limiter placement/);
  assert.match(result.brief, /Renamed Server/);
  assert.doesNotMatch(result.brief, /Foreign|impact:unknown/);
  assert.equal(store.current().phase, "");
});

test("skip releases the review from working, ready, partial, and error", async () => {
  const setups = [
    async (store) => store.open({ plan: PLAN }),
    async (store) => {
      const opened = store.open({ plan: PLAN });
      await store.fill(memWs(SYSTEM), { impact: async () => readyResult() });
      return opened;
    },
    async (store) => {
      const opened = store.open({ plan: PLAN });
      await store.fill(memWs(SYSTEM), {
        impact: async () => readyResult({ impacts: [impact({ level: "unresolved", targetId: "", size: "" })], outcome: "partial" }),
      });
      return opened;
    },
    async (store) => {
      const opened = store.open({ plan: PLAN });
      await store.fill(memWs(SYSTEM), { impact: async () => { throw new Error("down"); } });
      return opened;
    },
  ];

  for (const setup of setups) {
    const store = createPlanStore();
    const { id } = await setup(store);
    const waiting = store.wait(id, 5_000);
    assert.equal(store.resolve(id, { skipped: true }), true);
    assert.deepEqual(await waiting, { status: "skipped" });
    assert.equal(store.current().status, "skipped");
    assert.equal(store.current().phase, "");
  }
});

test("retry preserves review identity and starts exactly one fresh analysis", async () => {
  const calls = [];
  const store = createPlanStore({
    impact: async () => {
      calls.push(calls.length + 1);
      if (calls.length === 1) throw new Error("first attempt failed");
      return readyResult();
    },
  });
  const ws = memWs(SYSTEM);
  const { id } = store.open({ plan: PLAN });
  await store.fill(ws);
  const before = store.current();
  assert.equal(before.status, "error");
  const revision = before.revision;
  const steps = before.steps;
  before.accepted.add("stale-choice");

  assert.equal(store.retry(id, ws), true);
  assert.equal(store.current().id, id);
  assert.equal(store.current().plan, PLAN);
  assert.equal(store.current().steps, steps);
  assert.equal(store.current().status, "working");
  assert.ok(store.current().revision > revision);
  assert.deepEqual([...store.current().accepted], []);
  await store.current().analysis;

  assert.equal(store.current().status, "ready");
  assert.deepEqual(calls, [1, 2]);
  assert.equal(store.retry(id, ws), false);
});

test("warm map performs one impact call and no project-map work", async () => {
  let impacts = 0;
  let graphs = 0;
  let discoveries = 0;
  let adoptions = 0;
  const store = createPlanStore({
    impact: async (context) => {
      impacts++;
      assert.deepEqual(context.nodes, NODES);
      assert.deepEqual(context.edges, EDGES);
      return readyResult();
    },
    buildGraph: async () => { graphs++; throw new Error("must not build a graph"); },
    discoverProject: async () => { discoveries++; throw new Error("must not discover"); },
    adopt: async () => { adoptions++; throw new Error("must not adopt"); },
  });
  store.open({ plan: PLAN });
  await store.fill(memWs(SYSTEM));

  assert.deepEqual({ impacts, graphs, discoveries, adoptions }, {
    impacts: 1, graphs: 0, discoveries: 0, adoptions: 0,
  });
  assert.equal(store.takeScan(), null);
});

test("warm review restores and publishes missing code-backed map edges", async () => {
  const nodes = [
    { id: "app", name: "App", intent: "Uploads videos.", anchor: { paths: ["app/index.tsx"] } },
    { id: "api", name: "API", intent: "Analyses videos.", anchor: { paths: ["server/api.py"] } },
  ];
  const graph = {
    files: ["app/index.tsx", "server/api.py"],
    links: [{ from: "app/index.tsx", to: "server/api.py", kind: "http", names: ["/analyze/video"] }],
    capped: false,
  };
  let seen;
  const store = createPlanStore({
    buildGraph: async () => graph,
    impact: async (context) => {
      seen = context;
      return readyResult({ impacts: [impact({ targetId: "api" })] });
    },
  });
  store.open({ plan: PLAN });
  await store.fill(memWs({ version: 1, nodes, edges: [], notes: [], types: {}, dismissed: [] }));

  assert.equal(seen.edges.length, 1);
  assert.deepEqual(seen.edges[0], {
    id: "scan:app>api", from: "app", to: "api", label: "calls API", origin: "scan",
    operations: [{ name: "/analyze/video", sends: "", returns: "" }],
  });
  assert.deepEqual(store.forBrowser().mapEdges, seen.edges);
});

test("exact cached preparation is the one identity source for review, adoption, and brief", async () => {
  const moves = [
    { t: "addNode", node: { id: "prepared-server", name: "Prepared Server", intent: "Serves requests." } },
    { t: "addNode", node: { id: "prepared-store", name: "Prepared Store", intent: "Stores records." } },
    { t: "connect", from: "prepared-server", to: "prepared-store", label: "reads", origin: "scan", operations: [] },
  ];
  const fingerprint = "c".repeat(64);
  const preparation = { moves, dropped: [], provider: "prep-provider", model: "prep-model" };
  let impactCalls = 0;
  let discoveryCalls = 0;
  const ws = memWs();
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => fingerprint,
    readPreparation: async (root, expected) => {
      assert.equal(root, ws.root);
      assert.equal(expected, fingerprint);
      return preparation;
    },
    discoverProject: async () => { discoveryCalls++; throw new Error("cache hit must not discover"); },
    impact: async (context) => {
      impactCalls++;
      assert.deepEqual(context.nodes.map((node) => node.id), ["prepared-server", "prepared-store"]);
      assert.deepEqual(context.edges.map((edge) => [edge.from, edge.to]), [["prepared-server", "prepared-store"]]);
      return readyResult({ impacts: [impact({ targetId: "prepared-server" })] });
    },
  });
  const { id } = store.open({ plan: PLAN });
  await store.fill(ws);

  const firstOffer = store.takeScan();
  const secondOffer = store.takeScan();
  assert.equal(firstOffer, secondOffer);
  const [first, second] = await Promise.all([firstOffer, secondOffer]);
  assert.equal(first, second);
  assert.deepEqual(first, preparation);
  assert.deepEqual(store.current().nodes.map((node) => node.id), ["prepared-server", "prepared-store"]);
  const written = JSON.parse(ws.files.get("plangolin/system.json"));
  assert.deepEqual(written.nodes.map((node) => node.id), ["prepared-server", "prepared-store"]);
  assert.equal(impactCalls, 1);
  assert.equal(discoveryCalls, 0);

  assert.equal(store.resolve(id, {
    accepted: ["impact:1"],
    nodes: [{ id: "foreign", name: "Foreign" }],
  }), true);
  assert.match(store.current().brief, /Prepared Server/);
  assert.doesNotMatch(store.current().brief, /Foreign/);
  assert.equal(store.takeScan(), null);
});

test("prepared scan persistence cannot overwrite an ordinary save that wins after its empty read", async () => {
  const scanReadEntered = deferred();
  const finishScanRead = deferred();
  const files = new Map([
    ["plangolin/system.json", JSON.stringify(emptyDoc())],
    ["plangolin/layout.json", JSON.stringify({})],
  ]);
  let layoutReads = 0;
  const ws = {
    root: "/tmp/plangolin-plan-store-persistence-race",
    async read(file) {
      if (file === "plangolin/layout.json" && ++layoutReads === 2) {
        scanReadEntered.resolve();
        await finishScanRead.promise;
      }
      return files.get(file) ?? null;
    },
    async write(file, contents) { files.set(file, contents); },
    async exists(file) { return files.has(file); },
    async list() { return []; },
  };
  const moves = [{ t: "addNode", node: {
    id: "scan", name: "Scanned Server", intent: "Serves requests.",
  } }];
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "6".repeat(64),
    readPreparation: async () => ({ moves, dropped: [], provider: "prep", model: "prep" }),
    impact: async () => readyResult({ impacts: [impact({ targetId: "scan" })] }),
  });
  store.open({ plan: PLAN });
  const filling = store.fill(ws);
  await scanReadEntered.promise;

  const browserDoc = {
    ...emptyDoc(),
    nodes: [{ id: "browser", name: "Browser Server", kind: "", intent: "User-owned.", details: "" }],
    layout: { browser: { x: 91, y: 92 } },
  };
  const browserSave = saveDoc(ws, browserDoc);
  finishScanRead.resolve();
  await Promise.all([browserSave, filling]);

  const { doc } = await loadDoc(ws);
  assert.deepEqual(doc.nodes.map((node) => node.id), ["browser"]);
  assert.deepEqual(doc.layout, { browser: { x: 91, y: 92 } });
  assert.deepEqual(store.current().nodes.map((node) => node.id), ["scan"],
    "the in-memory review identity stays on its prepared moves");
});

test("a preparation completed after the initial miss wins before cold discovery", async () => {
  const startupEntered = deferred();
  const finishStartup = deferred();
  const moves = [{ t: "addNode", node: {
    id: "handoff-server", name: "Handoff Server", intent: "Serves requests.",
  } }];
  const prepared = { moves, dropped: [], provider: "prep", model: "prep" };
  let available = null;
  let reads = 0;
  let discoveries = 0;
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "7".repeat(64),
    readPreparation: async () => { reads++; return available; },
    preparationStartup: async () => {
      startupEntered.resolve();
      await finishStartup.promise;
      return { live: false, ready: true };
    },
    discoverProject: async () => { discoveries++; throw new Error("must not start cold discovery"); },
    impact: async (context) => {
      assert.deepEqual(context.nodes.map((node) => node.id), ["handoff-server"]);
      return readyResult({ impacts: [impact({ targetId: "handoff-server" })] });
    },
  });
  store.open({ plan: PLAN });
  const filling = store.fill(memWs());
  await startupEntered.promise;
  available = prepared;
  finishStartup.resolve();
  await filling;

  assert.equal(store.current().status, "ready");
  assert.equal(reads, 2);
  assert.equal(discoveries, 0);
  assert.deepEqual((await store.takeScan()).moves, moves);
});

test("a preparation completed after a null follow wins before cold discovery", async () => {
  const followEntered = deferred();
  const finishFollow = deferred();
  const coldDecision = deferred();
  const publishCompletion = deferred();
  const moves = [{ t: "addNode", node: {
    id: "followed-server", name: "Followed Server", intent: "Serves requests.",
  } }];
  const prepared = { moves, dropped: [], provider: "prep", model: "prep" };
  let reads = 0;
  let discoveries = 0;
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "8".repeat(64),
    readPreparation: async () => {
      reads++;
      if (reads === 1) return null;
      coldDecision.resolve("exact-read");
      await publishCompletion.promise;
      return prepared;
    },
    preparationStartup: async () => ({ live: true, ready: true }),
    followPreparation: async () => {
      followEntered.resolve();
      await finishFollow.promise;
      return null;
    },
    discoverProject: async () => {
      discoveries++;
      coldDecision.resolve("cold-discovery");
      return {
        graph: { files: ["src/server.js"], links: [], capped: false },
        groups: [], flatGroups: [], dependencies: new Map(), excerpts: new Map(), dropped: [],
      };
    },
    nameProject: async () => ({
      blocks: [], labels: new Map(), dropped: [], provider: "cold", model: "cold",
    }),
    movesFromDiscovery: () => ({ moves, idFor: new Map() }),
    impact: async (context) => {
      assert.deepEqual(context.nodes.map((node) => node.id), ["followed-server"]);
      return readyResult({ impacts: [impact({ targetId: "followed-server" })] });
    },
  });
  store.open({ plan: PLAN });
  const filling = store.fill(memWs());
  await followEntered.promise;
  finishFollow.resolve();
  const handoff = await coldDecision.promise;
  if (handoff === "exact-read") publishCompletion.resolve();
  await filling;

  assert.equal(handoff, "exact-read");
  assert.equal(store.current().status, "ready");
  assert.equal(reads, 2);
  assert.equal(discoveries, 0);
  assert.deepEqual((await store.takeScan()).moves, moves);
});

test("a matching live preparation is followed with progress and no duplicate adoption", async () => {
  const fingerprint = "d".repeat(64);
  const moves = NODES.map((node) => ({ t: "addNode", node }));
  let follows = 0;
  let discoveries = 0;
  let adoptions = 0;
  const { store, states } = recordingStore({
    buildGraph: async () => ({ files: ["src/server.js", "src/store.js"], links: [], capped: false }),
    fingerprintGraph: () => fingerprint,
    readPreparation: async () => null,
    preparationStartup: async () => ({ live: true, ready: true }),
    followPreparation: async (root, expected, { onProgress }) => {
      follows++;
      assert.equal(root, "/tmp/plangolin-plan-store");
      assert.equal(expected, fingerprint);
      await onProgress({ phase: "mapping_project", revision: 1, elapsed: 10, counts: { files: 2, links: 0 } });
      await onProgress({ phase: "grouping_components", revision: 2, elapsed: 20, counts: { components: 2 } });
      await onProgress({ phase: "naming_components", revision: 3, elapsed: 30, counts: { components: 2 } });
      return { moves, dropped: [], provider: "prep", model: "prep" };
    },
    discoverProject: async () => { discoveries++; throw new Error("must follow live preparation"); },
    adopt: async () => { adoptions++; throw new Error("must not adopt twice"); },
    impact: async () => readyResult(),
  });
  store.open({ plan: PLAN });
  await store.fill(memWs());

  assert.equal(follows, 1);
  assert.equal(discoveries, 0);
  assert.equal(adoptions, 0);
  assert.deepEqual(phases(states), [
    "loading_system_map", "mapping_project", "grouping_components",
    "naming_components", "matching_plan", "arranging_review",
  ]);
  assert.equal(states.find((state) => state.phase === "mapping_project").elapsedMs, 10);
  assert.equal(states.find((state) => state.phase === "grouping_components").elapsedMs, 20);
  assert.equal(states.find((state) => state.phase === "naming_components").elapsedMs, 30);
  for (let index = 1; index < states.length; index++) {
    assert.ok(states[index].elapsedMs >= states[index - 1].elapsedMs);
  }
  assertMonotonicRevisions(states);
  assert.deepEqual((await store.takeScan()).moves, moves);
});

test("a live preparation past the lease TTL hands off without a duplicate cold adoption", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "plangolin-plan-follow-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project");
  const cacheRoot = path.join(temp, "cache");
  await fs.mkdir(root);
  const paths = preparationPaths(root, { cacheRoot });
  await fs.mkdir(paths.dir, { recursive: true });
  const owner = "11111111-1111-4111-8111-111111111111";
  const generation = "000000000001";
  const fingerprint = "d".repeat(64);
  let now = 1_000;
  let heartbeatSequence = 1;
  await fs.mkdir(path.join(paths.dir, `lease-${generation}.claim`));
  await fs.mkdir(path.join(paths.dir, `lease-${generation}.claim`, `${owner}-${process.pid}-${now}.owner`));
  await fs.mkdir(path.join(paths.dir, `heartbeat-${generation}-${owner}-000000000001-${now}.beat`));
  await fs.writeFile(path.join(paths.dir, `progress-${generation}-${owner}.json`), JSON.stringify({
    owner, generation: 1, phase: "starting", revision: 1, elapsed: 0, updatedAt: now, counts: {},
  }));

  const moves = NODES.map((node) => ({ t: "addNode", node }));
  const record = {
    version: 1, rootHash: paths.rootHash, fingerprint, createdAt: 17_000,
    moves, dropped: [], provider: "prep", model: "prep",
  };
  const sleep = async () => {
    now += 1_000;
    heartbeatSequence += 1;
    await fs.mkdir(path.join(paths.dir,
      `heartbeat-${generation}-${owner}-${String(heartbeatSequence).padStart(12, "0")}-${now}.beat`));
    if (now === 17_000) {
      await fs.writeFile(path.join(paths.dir, `result-${generation}-${owner}.json`), JSON.stringify(record));
      await fs.mkdir(path.join(paths.dir, `complete-${generation}-${owner}.done`));
    }
  };
  const leaseOptions = { cacheRoot, now: () => now, processAlive: () => true };
  let discoveries = 0;
  let namings = 0;
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => fingerprint,
    readPreparation: (workspace, expected) =>
      readPreparedLease(workspace, expected, leaseOptions),
    preparationStartup: (workspace) => inspectPreparationStartup(workspace, leaseOptions),
    followPreparation: (workspace, expected, { onProgress }) => followPreparedLease(workspace, expected, {
      ...leaseOptions, pollMs: 1_000, sleep, onProgress,
    }),
    discoverProject: async () => { discoveries += 1; throw new Error("must keep following the live lease"); },
    nameProject: async () => { namings += 1; throw new Error("must not duplicate naming"); },
    impact: async () => readyResult(),
  });
  const ws = memWs();
  ws.root = root;
  store.open({ plan: PLAN });
  await store.fill(ws);

  assert.ok(now > 1_000 + 15_000, "the handoff completes after the old absolute follower timeout");
  assert.equal(discoveries, 0);
  assert.equal(namings, 0);
  assert.equal(store.current().status, "ready");
  assert.deepEqual((await store.takeScan()).moves, moves);
});

test("the cold concurrency quality gate defaults off and keeps matching serial", async () => {
  assert.equal(COLD_IMPACT_CONCURRENCY, false);
  const naming = deferred();
  const nameStarted = deferred();
  const events = [];
  const graph = { files: ["src/server.js"], links: [], capped: false };
  const discovery = {
    graph, groups: [],
    flatGroups: [{ id: "group:server", files: graph.files, allFiles: graph.files, parent: null }],
    dependencies: new Map(), excerpts: new Map(), dropped: [],
  };
  const store = createPlanStore({
    buildGraph: async () => graph,
    fingerprintGraph: () => "e".repeat(64),
    readPreparation: async () => null,
    preparationStartup: async () => ({ live: false, ready: false }),
    discoverProject: async () => discovery,
    nameProject: async () => {
      events.push("name:start");
      nameStarted.resolve();
      return naming.promise;
    },
    movesFromDiscovery: () => ({
      moves: [{ t: "addNode", node: NODES[0] }],
      idFor: new Map([["group:server", "server"]]),
    }),
    impact: async (_context, _steps, options) => {
      events.push("impact:start");
      assert.equal(options, undefined);
      return readyResult();
    },
  });
  store.open({ plan: PLAN });
  const filling = store.fill(memWs());
  await nameStarted.promise;
  assert.deepEqual(events, ["name:start"]);

  naming.resolve({ blocks: [], labels: new Map(), dropped: [], provider: "test", model: "test" });
  await filling;
  assert.deepEqual(events, ["name:start", "impact:start"]);
  assert.equal(store.current().status, "ready");
});

test("enabled cold concurrency has call depth group then max of naming and provisional matching", async () => {
  const naming = deferred();
  const matching = deferred();
  const matchingStarted = deferred();
  const events = [];
  const graph = { files: ["src/server.js"], links: [], capped: false };
  const discovery = {
    graph, groups: [],
    flatGroups: [{
      id: "group:server", files: graph.files, allFiles: graph.files,
      parent: null, rationale: "handles requests",
    }],
    dependencies: new Map([["group:server", []]]), excerpts: new Map(), dropped: [],
  };
  let impactCalls = 0;
  let reportNamingProgress;
  const { store, states } = recordingStore({
    coldImpactConcurrency: true,
    buildGraph: async () => graph,
    fingerprintGraph: () => "f".repeat(64),
    readPreparation: async () => null,
    preparationStartup: async () => ({ live: false, ready: false }),
    discoverProject: async () => { events.push("group:done"); return discovery; },
    nameProject: async (_discovery, { onProgress }) => {
      events.push("name:start");
      reportNamingProgress = onProgress;
      return naming.promise;
    },
    movesFromDiscovery: () => ({
      moves: [{ t: "addNode", node: NODES[0] }],
      idFor: new Map([["group:server", "server"]]),
    }),
    impact: async (context, _steps, options) => {
      impactCalls++;
      events.push("match:start");
      matchingStarted.resolve();
      assert.equal(store.current().phase, "matching_plan");
      assert.equal(options.deferValidation, true);
      assert.equal(context.nodes.length, 0);
      assert.equal(context.groups[0].ref, "group:server");
      return matching.promise;
    },
  });
  store.open({ plan: PLAN });
  const filling = store.fill(memWs());
  await matchingStarted.promise;

  assert.deepEqual(events, ["group:done", "name:start", "match:start"]);
  assert.equal(store.current().status, "working");
  matching.resolve({
    raw: { impacts: [impact({ targetId: "group:server" })] },
    provider: "test-provider",
    model: "test-model",
  });
  await matching.promise;
  assert.equal(store.current().status, "working", "naming remains on the critical path");
  await reportNamingProgress({ phase: "naming_and_matching", counts: { components: 1 } });
  assert.equal(store.current().phase, "matching_plan", "late naming progress cannot move the phase backward");

  naming.resolve({
    blocks: [{ groupId: "group:server", id: "server", name: "Server", kind: "", intent: "Serves.", details: "" }],
    labels: new Map(), dropped: [], provider: "test-provider", model: "test-model",
  });
  await filling;

  assert.equal(impactCalls, 1, "the provisional match is the only impact call");
  assert.equal(store.current().status, "ready");
  assert.equal(store.current().impacts[0].targetId, "server");
  assert.deepEqual(store.current().nodes.map((node) => node.id), ["server"]);
  assert.deepEqual(phases(states), [
    "loading_system_map", "naming_and_matching", "matching_plan", "arranging_review",
  ]);
});

test("stale progress and completion from a failed attempt cannot overwrite its retry", async () => {
  const callbacks = [];
  const retryImpact = deferred();
  const graph = { files: ["src/server.js"], links: [], capped: false };
  const discovery = {
    graph, groups: [],
    flatGroups: [{ id: "group:server", files: graph.files, allFiles: graph.files, parent: null }],
    dependencies: new Map(), excerpts: new Map(), dropped: [],
  };
  let impactCalls = 0;
  const ws = memWs();
  const store = createPlanStore({
    buildGraph: async () => graph,
    fingerprintGraph: () => "1".repeat(64),
    readPreparation: async () => null,
    preparationStartup: async () => ({ live: false, ready: false }),
    discoverProject: async (_ws, { onProgress }) => { callbacks.push(onProgress); return discovery; },
    nameProject: async () => ({ blocks: [], labels: new Map(), dropped: [], provider: "test", model: "test" }),
    movesFromDiscovery: () => ({
      moves: [{ t: "addNode", node: NODES[0] }],
      idFor: new Map([["group:server", "server"]]),
    }),
    impact: async () => {
      impactCalls++;
      if (impactCalls === 1) throw new Error("attempt one failed");
      return retryImpact.promise;
    },
  });
  const { id } = store.open({ plan: PLAN });
  await store.fill(ws);
  assert.equal(store.current().status, "error");
  const sharedScan = store.takeScan();

  assert.equal(store.retry(id, ws), true);
  await drainMicrotasks();
  assert.equal(store.current().phase, "matching_plan");
  const revision = store.current().revision;
  await callbacks[0]({ phase: "mapping_project", counts: { files: 999 } });
  assert.equal(store.current().phase, "matching_plan");
  assert.equal(store.current().revision, revision);
  assert.equal(store.takeScan(), sharedScan);

  const newest = impact({ title: "Newest result" });
  retryImpact.resolve(readyResult({ impacts: [newest] }));
  await store.current().analysis;
  assert.equal(store.current().status, "ready");
  assert.equal(store.current().impacts[0].title, "Newest result");
  assert.equal(impactCalls, 2);
});

test("one-review busy limit releases only after resolve or skip", async () => {
  const store = createPlanStore({ impact: async () => readyResult() });
  const first = store.open({ plan: PLAN });
  assert.deepEqual(store.open({ plan: "1. A different plan\n" }), { busy: true, id: first.id });
  await store.fill(memWs(SYSTEM));
  assert.deepEqual(store.open({ plan: "1. Still different\n" }), { busy: true, id: first.id });
  assert.equal(store.resolve(first.id, { accepted: [], nodes: NODES }), true);

  const second = store.open({ plan: "1. A different plan\n" });
  assert.notEqual(second.id, first.id);
  assert.equal(store.resolve(second.id, { skipped: true }), true);
  const third = store.open({ plan: "1. A third plan\n" });
  assert.notEqual(third.id, second.id);
});

test("wait returns gone, pending, and an already released decision deterministically", async () => {
  let timeoutCallback;
  const cleared = [];
  const store = createPlanStore({
    setTimeout(callback) { timeoutCallback = callback; return 17; },
    clearTimeout(timer) { cleared.push(timer); },
    impact: async () => readyResult(),
  });
  assert.deepEqual(await store.wait("missing", 25), { status: "gone" });
  const { id } = store.open({ plan: PLAN });
  const pending = store.wait(id, 25);
  assert.equal(typeof timeoutCallback, "function");
  timeoutCallback();
  assert.deepEqual(await pending, { status: "pending" });

  await store.fill(memWs(SYSTEM));
  assert.equal(store.resolve(id, { accepted: [], nodes: NODES }), true);
  assert.deepEqual(await store.wait(id, 25), {
    status: "resolved",
    brief: store.current().brief,
  });
  assert.deepEqual(cleared, []);
});

test("skip fences a model completion already in flight", async () => {
  const matching = deferred();
  const store = createPlanStore({ impact: async () => matching.promise });
  const { id } = store.open({ plan: PLAN });
  const filling = store.fill(memWs(SYSTEM));
  await drainMicrotasks();
  const revision = store.current().revision;

  assert.equal(store.resolve(id, { skipped: true }), true);
  assert.equal(store.current().revision, revision + 1);
  matching.resolve(readyResult());
  await filling;
  assert.equal(store.current().status, "skipped");
  assert.equal(store.current().phase, "");
});

const LONG_PLAN = Array.from({ length: 200 }, (_, index) =>
  `${index + 1}. do thing ${index + 1}`).join("\n");

test("truncation stays visible in browser state and the accepted brief", async () => {
  const numbers = Array.from({ length: 60 }, (_, index) => index + 1);
  const store = createPlanStore({
    impact: async () => readyResult({
      impacts: [impact({ level: "support", targetId: "", size: "", steps: numbers })],
      coverage: { claimed: 60, total: 60 },
    }),
  });
  const { id } = store.open({ plan: LONG_PLAN });
  assert.equal(store.current().steps.length, 60);
  assert.match(store.forBrowser().note, /only the first 60 steps/i);
  await store.fill(memWs(SYSTEM));
  assert.match(store.forBrowser().note, /only the first 60 steps/i);
  assert.equal(store.resolve(id, { accepted: ["impact:1"], nodes: NODES }), true);
  assert.match(store.current().brief, /only the first 60 steps/i);
});

test("observer failures and an unwritable scan cannot abort review work", async () => {
  let publications = 0;
  const moves = NODES.map((node) => ({ t: "addNode", node }));
  const ws = memWs();
  ws.write = async () => { throw new Error("read-only volume"); };
  const store = createPlanStore({
    onPublish() {
      publications++;
      if (publications % 2) throw new Error("observer failed");
      return Promise.reject(new Error("observer rejected"));
    },
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "2".repeat(64),
    readPreparation: async () => ({ moves, dropped: [], provider: "test", model: "test" }),
    impact: async () => readyResult(),
  });
  store.open({ plan: PLAN });
  await store.fill(ws);

  assert.ok(publications > 1);
  assert.equal(store.current().status, "ready");
  assert.deepEqual(store.current().nodes.map((node) => node.id), ["server", "store"]);
});

test("an empty prepared map leaves no persisted diagram behind", async () => {
  const ws = memWs();
  const store = createPlanStore({
    buildGraph: async () => ({ files: [], links: [], capped: false }),
    fingerprintGraph: () => "3".repeat(64),
    readPreparation: async () => ({ moves: [], dropped: [], provider: null, model: null }),
    impact: async () => readyResult(),
  });
  store.open({ plan: PLAN });
  await store.fill(ws);

  assert.equal(ws.files.size, 0);
  assert.deepEqual((await store.takeScan()).moves, []);
  assert.equal(store.current().status, "ready");
});

test("retry reuses an unwritable prepared map and its shared scan identity", async () => {
  const moves = NODES.map((node) => ({ t: "addNode", node }));
  const ws = memWs();
  ws.write = async () => { throw new Error("read-only volume"); };
  let preparations = 0;
  let impacts = 0;
  const store = createPlanStore({
    buildGraph: async () => ({ files: ["src/server.js"], links: [], capped: false }),
    fingerprintGraph: () => "4".repeat(64),
    readPreparation: async () => {
      preparations++;
      return { moves, dropped: [], provider: "test", model: "test" };
    },
    impact: async () => {
      impacts++;
      if (impacts === 1) throw new Error("provider down");
      return readyResult();
    },
  });
  const { id } = store.open({ plan: PLAN });
  await store.fill(ws);
  const shared = store.takeScan();
  assert.equal(store.current().status, "error");

  assert.equal(store.retry(id, ws), true);
  await store.current().analysis;
  assert.equal(store.current().status, "ready");
  assert.equal(preparations, 1);
  assert.equal(store.takeScan(), shared);
  assert.deepEqual(store.current().nodes.map((node) => node.id), ["server", "store"]);
});

test("a skipped review's late attempt cannot complete a newer review", async () => {
  const firstImpact = deferred();
  const secondImpact = deferred();
  let calls = 0;
  const store = createPlanStore({
    impact: async () => (++calls === 1 ? firstImpact.promise : secondImpact.promise),
  });
  const first = store.open({ plan: PLAN });
  const firstFill = store.fill(memWs(SYSTEM));
  await drainMicrotasks();
  assert.equal(store.resolve(first.id, { skipped: true }), true);

  const second = store.open({ plan: "1. Replace the limiter\n" });
  const secondFill = store.fill(memWs(SYSTEM));
  await drainMicrotasks();
  const revision = store.current().revision;
  firstImpact.resolve(readyResult({ impacts: [impact({ title: "Stale first review" })] }));
  await firstFill;

  assert.equal(store.current().id, second.id);
  assert.equal(store.current().status, "working");
  assert.equal(store.current().revision, revision);
  assert.deepEqual(store.current().impacts, []);

  secondImpact.resolve(readyResult({
    impacts: [impact({ title: "Current second review", steps: [1] })],
    coverage: { claimed: 1, total: 1 },
  }));
  await secondFill;
  assert.equal(store.current().status, "ready");
  assert.equal(store.current().impacts[0].title, "Current second review");
});
