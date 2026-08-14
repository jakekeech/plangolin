import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanStore } from "../src/plan-store.js";

const PLAN = "1. Add a limiter\n2. Wire it up\n";
const NODES = [{ id: "server", name: "Server", intent: "Serves the app." }];
const DELTA = {
  additions: [{ id: "limiter", name: "Limiter", kind: "", intent: "Refuses.", dir: "src/limit", steps: [1] }],
  touches: [], connections: [], unplaced: [{ steps: [2], why: "detail" }],
};

test("opening a plan gives it an id and splits its steps", () => {
  const s = createPlanStore();
  const r = s.open({ plan: PLAN });
  assert.ok(r.id);
  assert.equal(r.busy, undefined);
  assert.equal(s.current().status, "thinking");
  assert.equal(s.current().steps.length, 2);
});

test("the delta arrives and the review becomes ready", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  assert.equal(s.current().status, "ready");
  assert.equal(s.current().delta.additions.length, 1);
});

test("fill sends the browser one-hop users from the sheet used for the delta", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const system = {
    version: 1,
    nodes: [
      { id: "entry", name: "Package Entry", intent: "Exports the API." },
      { id: "server", name: "Server", intent: "Serves the app." },
    ],
    edges: [{ id: "entry__server", from: "entry", to: "server", label: "exports API" }],
  };
  const ws = {
    root: "/tmp/x",
    async read(path) { return path === "plangolin/system.json" ? JSON.stringify(system) : null; },
    async write() {}, async exists() { return false; }, async list() { return []; },
  };

  await s.fill(ws, {
    delta: async () => ({
      delta: {
        additions: [], touches: [{ id: "server", why: "rewrites dispatch", size: "substantial", steps: [1] }],
        connections: [], unplaced: [{ steps: [2], why: "detail" }],
      },
      dropped: [],
    }),
  });

  assert.deepEqual(s.forBrowser().reach, [
    { id: "entry", via: "server", label: "exports API" },
  ]);
  assert.equal(s.current().id, id);
});

test("a waiter is released by a resolve and gets the brief", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  const waiting = s.wait(id, 5000);
  s.resolve(id, { accepted: ["add:limiter"], nodes: NODES });
  const out = await waiting;
  assert.equal(out.status, "resolved");
  assert.match(out.brief, /BUILD/);
  assert.match(out.brief, /Limiter/);
});

test("resolving before anyone waits still answers the next waiter", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  s.resolve(id, { accepted: ["add:limiter"], nodes: NODES });
  const out = await s.wait(id, 5000);
  assert.equal(out.status, "resolved");
  assert.match(out.brief, /Limiter/);
});

test("a waiter that outlives its window returns pending, not an answer", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  assert.equal((await s.wait(id, 20)).status, "pending");
});

test("skipping resolves the waiter with no brief", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const waiting = s.wait(id, 5000);
  s.resolve(id, { skipped: true, nodes: NODES });
  assert.equal((await waiting).status, "skipped");
});

// One review at a time is a deliberate limit. Silently replacing a live one
// would pull the sheet out from under somebody mid-decision.
test("a second plan while one is undecided is refused, naming the live one", () => {
  const s = createPlanStore();
  const first = s.open({ plan: PLAN });
  const second = s.open({ plan: "1. Something else\n" });
  assert.equal(second.busy, true);
  assert.equal(second.id, first.id);
  assert.equal(s.current().id, first.id);
});

test("once decided, the next plan opens normally", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  s.resolve(id, { accepted: [], nodes: NODES });
  const next = s.open({ plan: "1. Something else\n" });
  assert.equal(next.busy, undefined);
  assert.notEqual(next.id, id);
});

test("resolving an id that is not the live one changes nothing", () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  assert.equal(s.resolve("nonsense", { accepted: [], nodes: NODES }), false);
  assert.equal(s.current().status, "thinking");
});

test("waiting on a review that was never opened reports it gone", async () => {
  const s = createPlanStore();
  assert.equal((await s.wait("nope", 5000)).status, "gone");
});

test("setDelta on a stale id is ignored", () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  assert.equal(s.setDelta("nonsense", { delta: DELTA, dropped: [] }), false);
  assert.equal(s.current().status, "thinking");
});

// Approve during the spinner used to build the brief from the empty
// placeholder delta and then silently discard the model's reply when it landed.
test("a review cannot be approved while the model is still thinking", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  assert.equal(s.resolve(id, { accepted: [], nodes: NODES }), false);
  assert.equal(s.current().status, "thinking");
});

// Skipping is the exception, and has to stay one: a user who gives up on the
// spinner would otherwise leave the blocked command waiting out its timeout.
test("skipping is still allowed while the model is thinking", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const waiting = s.wait(id, 5000);
  assert.equal(s.resolve(id, { skipped: true }), true);
  assert.equal((await waiting).status, "skipped");
});

// A bad request must fail the request, never the waiter. A throw here 500s the
// route and strands the blocked CLI for its full ten minutes.
test("a malformed resolve still releases the waiter", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  const waiting = s.wait(id, 5000);
  assert.equal(s.resolve(id, { accepted: {}, nodes: [null] }), true);
  assert.equal((await waiting).status, "resolved");
});

const LONG_PLAN = Array.from({ length: 200 }, (_, i) => `${i + 1}. do thing ${i + 1}`).join("\n");

test("a plan longer than plangolin reads says so in the review", () => {
  const s = createPlanStore();
  s.open({ plan: LONG_PLAN });
  assert.match(s.current().note, /only the first 60 steps/i);
});

test("a plan that fits says nothing about truncation", () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  assert.equal(s.current().note, "");
});

test("the truncation notice survives the delta arriving", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: LONG_PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  assert.match(s.current().note, /only the first 60 steps/i);
});

test("the brief says when only part of the plan was reviewed", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: LONG_PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  s.resolve(id, { accepted: [], nodes: NODES });
  assert.match(s.current().brief, /only the first 60 steps/i);
});

test("a plan that fits leaves the brief silent about coverage", () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  s.setDelta(id, { delta: DELTA, dropped: [] });
  s.resolve(id, { accepted: [], nodes: NODES });
  assert.doesNotMatch(s.current().brief, /only the first/i);
});

// Never a dead end: the model call failing must still leave a usable review
// with every step accounted for, not an empty one.
test("fill survives a model call that throws, and says so", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const ws = { root: "/tmp/x", async read() { return null; }, async write() {}, async exists() { return false; }, async list() { return []; } };
  await s.fill(ws, { delta: async () => { throw new Error("model down"); }, scan: async () => ({ moves: [] }) });
  const c = s.current();
  assert.equal(c.status, "ready");
  assert.equal(c.delta.additions.length, 0);
  assert.deepEqual(c.delta.unplaced[0].steps, [1, 2]);
  assert.match(c.note, /hand/i);
  assert.equal(id, c.id);
});

// The first-run path, and the one that made this critical: a browser that has
// not drawn the scan yet posts an empty sheet, and the brief used to come back
// naming `undefined` with nothing to protect.
test("a review filled from a scan still names its blocks when the browser posts nothing", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const ws = { root: "/tmp/x", async read() { return null; }, async write() {}, async exists() { return false; }, async list() { return []; } };
  const scanned = [{ id: "server", name: "Server" }, { id: "schema", name: "Schema" }];
  await s.fill(ws, {
    scan: async () => ({ moves: scanned.map((node) => ({ t: "addNode", node })) }),
    delta: async () => ({
      delta: {
        additions: [], touches: [{ id: "server", why: "gains a check", steps: [1] }],
        connections: [], unplaced: [],
      }, dropped: [],
    }),
  });
  const waiting = s.wait(id, 5000);
  s.resolve(id, { accepted: ["touch:server"], nodes: [] });
  const out = await waiting;
  assert.match(out.brief, /Server — gains a check/);
  assert.doesNotMatch(out.brief, /undefined/);
  assert.match(out.brief, /DO NOT TOUCH\n\s*Schema/);
});

/* The greenfield path, and the one that made this critical. fill() scans
   because there is no sheet on disk; the browser opens on the same unscanned
   project and runs its own scan, and two runs of a model pipeline do not agree
   about ids. Preferring the posted list threw away the only node list that
   could resolve the delta's ids: raw slugs under UPDATE, and the very block
   being updated also listed under DO NOT TOUCH. */
test("the brief describes the nodes the delta was computed against, not a foreign posted sheet", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const ws = { root: "/tmp/x", async read() { return null; }, async write() {}, async exists() { return false; }, async list() { return []; } };
  await s.fill(ws, {
    scan: async () => ({ moves: [
      { t: "addNode", node: { id: "a", name: "Server" } },
      { t: "addNode", node: { id: "b", name: "Schema" } },
    ] }),
    delta: async () => ({
      delta: {
        additions: [], touches: [{ id: "a", why: "gains a check", steps: [1] }],
        connections: [], unplaced: [],
      }, dropped: [],
    }),
  });
  s.resolve(id, { accepted: ["touch:a"], nodes: [{ id: "x", name: "Router" }, { id: "y", name: "Store" }] });
  const brief = s.current().brief;
  assert.match(brief, /Server — gains a check/);
  assert.doesNotMatch(brief, /\ba — gains/);
  assert.doesNotMatch(brief, /Router|Store/);
  assert.match(brief, /DO NOT TOUCH\n\s*Schema/);
  // A brief that says update Server and leave Server alone is worse than none.
  assert.doesNotMatch(brief.split("DO NOT TOUCH")[1], /Server/);
});

// The live sheet still names the blocks — the user can rename one while the
// review is open — but it never decides which blocks exist.
test("a posted sheet renames the nodes the delta was computed against", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const ws = { root: "/tmp/x", async read() { return null; }, async write() {}, async exists() { return false; }, async list() { return []; } };
  await s.fill(ws, {
    scan: async () => ({ moves: [{ t: "addNode", node: { id: "server", name: "Scanned name" } }] }),
    delta: async () => ({
      delta: {
        additions: [], touches: [{ id: "server", why: "gains a check", steps: [1] }],
        connections: [], unplaced: [],
      }, dropped: [],
    }),
  });
  s.resolve(id, { accepted: ["touch:server"], nodes: [{ id: "server", name: "Renamed since" }] });
  assert.match(s.current().brief, /Renamed since — gains a check/);
});

/* One cold start, one scan. The browser opening on the same unscanned project
   used to run a second one, and the two disagreed — measured on `requests`,
   seven blocks against six, with different ids for the same files. The brief
   is built from the delta's own graph, so those ids named blocks the sheet on
   screen had never heard of. */

const memWs = () => {
  const files = new Map();
  return {
    root: "/tmp/x",
    files,
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, c) { files.set(p, c); },
    async exists(p) { return files.has(p); },
    async list() { return []; },
  };
};

const SCAN = {
  moves: [
    { t: "addNode", node: { id: "server", name: "Server", anchor: { paths: ["src/s.js"] } } },
    { t: "addNode", node: { id: "store", name: "Store" } },
    { t: "connect", from: "server", to: "store", label: "reads", origin: "scan", operations: [] },
  ],
};

const idle = async () => ({
  delta: { additions: [], touches: [], connections: [], unplaced: [] }, dropped: [],
});

test("a cold-start scan is written to the sheet, so the brief and the sheet agree", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  await s.fill(ws, { scan: async () => SCAN, delta: idle });

  const written = JSON.parse(ws.files.get("plangolin/system.json"));
  assert.deepEqual(written.nodes.map((n) => n.id), ["server", "store"]);
  assert.deepEqual(written.edges.map((e) => e.id), ["server__store"]);
  // Same ids the delta was computed against — the whole point.
  assert.deepEqual(s.current().nodes.map((n) => n.id), written.nodes.map((n) => n.id));
  // Coordinates are the browser's; an empty layout is written, never omitted.
  assert.deepEqual(JSON.parse(ws.files.get("plangolin/layout.json")), {});
});

test("a sheet that already exists is read, never scanned over", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  const existing = { version: 1, nodes: [{ id: "mine", name: "Mine" }], edges: [] };
  ws.files.set("plangolin/system.json", JSON.stringify(existing));
  await s.fill(ws, { scan: async () => { throw new Error("should not scan"); }, delta: idle });

  assert.deepEqual(JSON.parse(ws.files.get("plangolin/system.json")), existing);
  assert.deepEqual(s.current().nodes.map((n) => n.id), ["mine"]);
});

// The browser can finish its own first sheet while the scan is still out. It
// has coordinates and we do not, so the first writer wins and this stands down.
test("a sheet that appeared during the scan is not overwritten", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  const theirs = JSON.stringify({ version: 1, nodes: [{ id: "theirs", name: "Theirs" }], edges: [] });
  await s.fill(ws, {
    scan: async () => { ws.files.set("plangolin/system.json", theirs); return SCAN; },
    delta: idle,
  });
  assert.equal(ws.files.get("plangolin/system.json"), theirs);
  // The review still reads against what it scanned — those are the delta's ids.
  assert.deepEqual(s.current().nodes.map((n) => n.id), ["server", "store"]);
});

// A project that cannot be written to still gets its review.
test("a sheet that will not save does not take the review down with it", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  ws.write = async () => { throw new Error("read-only volume"); };
  await s.fill(ws, { scan: async () => SCAN, delta: idle });
  assert.equal(s.current().status, "ready");
  assert.deepEqual(s.current().nodes.map((n) => n.id), ["server", "store"]);
});

/* fill() reads the sheet before it decides to scan, so the offer appears one
   turn in. Nothing races it in life: review-command fires the browser and
   calls fill() in the same tick, and a real browser takes far longer than
   that to load a page and read /api/doc before it can ask for a scan. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test("the browser is handed the scan already in flight", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  let runs = 0;
  let release;
  const filling = s.fill(ws, {
    scan: async () => { runs++; await new Promise((r) => { release = r; }); return SCAN; },
    delta: idle,
  });
  await settle();

  const shared = s.takeScan();
  assert.ok(shared, "a scan is on offer while fill is running");
  release();
  assert.deepEqual((await shared).moves, SCAN.moves);
  await filling;
  assert.equal(runs, 1);
});

// fill() consuming the scan for its own delta does not spend the offer — a
// caller that only reaches /api/adopt after fill is already done (a real
// scan settles well before a browser could ask twice, so this is the common
// case, not the rare one) still gets it. Only the review being decided ends
// the offer; see the next test.
test("the offer survives fill's own consumption, until the review is decided", async () => {
  const s = createPlanStore();
  const { id } = s.open({ plan: PLAN });
  const ws = memWs();
  await s.fill(ws, { scan: async () => SCAN, delta: idle });

  const again = await s.takeScan();
  assert.deepEqual(again.moves, SCAN.moves);

  s.resolve(id, { accepted: [], nodes: NODES });
  // "Scan again" is a deliberate ask for a fresh reading, and this review is
  // done deciding — the cached answer must not outlive it.
  assert.equal(s.takeScan(), null);
});

// The bug this machinery exists to close: a second caller inside the same
// cold-start window used to find the offer already taken and run its own,
// separate scan — two browser tabs (or a reload) drawing different ids for
// the same files.
test("two concurrent callers during one cold start are handed the identical scan", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  let runs = 0;
  let release;
  const filling = s.fill(ws, {
    scan: async () => { runs++; await new Promise((r) => { release = r; }); return SCAN; },
    delta: idle,
  });
  await settle();

  // Two callers, standing in for /api/adopt: `plans.takeScan() || adopt(ws)`.
  const first = s.takeScan();
  const second = s.takeScan();
  assert.ok(first && second, "both callers find a scan on offer");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.moves.map((m) => m.node?.id), b.moves.map((m) => m.node?.id));
  assert.equal(a, b, "the very same result, not two separately-scanned ones");
  await filling;
  assert.equal(runs, 1, "one scan served both callers");
});

// scanning used to be cleared only by takeScan()'s first call. A review that
// never had a browser ask for its scan — skipped mid-spinner, or simply never
// polled — left the settled promise sitting there for the *next* review to
// stumble into, handing out a graph that belongs to a project state that no
// longer exists.
test("a scan does not leak from one review into the next", async () => {
  const s = createPlanStore();
  const { id: first } = s.open({ plan: PLAN });
  const ws = memWs();
  await s.fill(ws, { scan: async () => SCAN, delta: idle });
  // Nobody ever called takeScan() for this review.
  s.resolve(first, { skipped: true });

  const { id: second } = s.open({ plan: "1. Something else\n" });
  assert.equal(s.takeScan(), null, "nothing left over from the last review");

  const ws2 = memWs();
  const SCAN2 = { moves: [{ t: "addNode", node: { id: "other", name: "Other" } }] };
  await s.fill(ws2, { scan: async () => SCAN2, delta: idle });
  assert.deepEqual(s.current().nodes.map((n) => n.id), ["other"]);
  assert.equal(second, s.current().id);
});

test("no scan is on offer when the sheet was already there", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  ws.files.set("plangolin/system.json", JSON.stringify({ version: 1, nodes: [{ id: "mine" }], edges: [] }));
  await s.fill(ws, { scan: async () => SCAN, delta: idle });
  assert.equal(s.takeScan(), null);
});

// The sheet is on disk before the browser is told what to draw, so the
// browser's own save — which carries the coordinates — lands strictly after.
test("the shared scan settles only once the sheet has been written", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  const filling = s.fill(ws, { scan: async () => SCAN, delta: idle });
  await settle();
  await s.takeScan();
  assert.ok(ws.files.has("plangolin/system.json"));
  await filling;
});

test("a scan that found nothing leaves no sheet behind", async () => {
  const s = createPlanStore();
  s.open({ plan: PLAN });
  const ws = memWs();
  await s.fill(ws, { scan: async () => ({ moves: [] }), delta: idle });
  assert.equal(ws.files.size, 0);
});
