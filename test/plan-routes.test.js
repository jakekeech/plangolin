import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { createPlanStore } from "../src/plan-store.js";

// A workspace with no disk behind it. These routes never write.
function fakeWs(system) {
  const files = new Map([["plangolin/system.json", JSON.stringify(system)]]);
  return {
    root: "/tmp/fake-project",
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, c) { files.set(p, c); },
    async exists(p) { return files.has(p); },
    async list() { return []; },
  };
}

const SHEET = {
  version: 1, nodes: [{ id: "server", name: "Server", intent: "Serves the app." }],
  edges: [], notes: [], types: {}, dismissed: [],
};

async function listen(plans) {
  const server = createServer(fakeWs(SHEET), plans);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

test("the browser can read the live review", async () => {
  const plans = createPlanStore();
  plans.open({ plan: "1. Add a limiter\n" });
  const s = await listen(plans);
  try {
    const { review } = await fetch(s.base + "/api/plan").then((r) => r.json());
    assert.equal(review.steps.length, 1);
    assert.equal(review.status, "thinking");
  } finally { await s.close(); }
});

test("the route ships only what the panel reads, not the whole review", async () => {
  const plans = createPlanStore();
  plans.open({ plan: "1. Add a limiter\n" });
  const s = await listen(plans);
  try {
    const { review } = await fetch(s.base + "/api/plan").then((r) => r.json());
    assert.deepEqual(Object.keys(review).sort(), ["delta", "id", "note", "reach", "status", "steps"]);
    assert.equal("nodes" in review, false);
    assert.equal("plan" in review, false);
  } finally { await s.close(); }
});

test("with nothing live the browser is told so, not given an error", async () => {
  const s = await listen(createPlanStore());
  try {
    const out = await fetch(s.base + "/api/plan").then((r) => r.json());
    assert.equal(out.review, null);
  } finally { await s.close(); }
});

test("a resolve releases a waiting result and returns the brief", async () => {
  const plans = createPlanStore();
  const { id } = plans.open({ plan: "1. Add a limiter\n" });
  plans.setDelta(id, { delta: { additions: [], touches: [], connections: [], unplaced: [] }, dropped: [] });
  const s = await listen(plans);
  try {
    const waiting = fetch(`${s.base}/api/plan/result?id=${id}`).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 50));   // let the long-poll park
    const out = await post(s.base, "/api/plan/resolve", { id, accepted: [], nodes: SHEET.nodes });
    assert.equal(out.ok, true);
    const result = await waiting;
    assert.equal(result.status, "resolved");
    assert.match(result.brief, /Reviewed in plangolin/);
  } finally { await s.close(); }
});

test("a cut remark reaches the resolved brief", async () => {
  const plans = createPlanStore();
  const { id } = plans.open({ plan: "1. Add calendar support\n" });
  plans.setDelta(id, {
    delta: {
      additions: [{ id: "calendar", name: "Calendar", intent: "Reads busy times.", steps: [1] }],
      touches: [], connections: [], unplaced: [],
    },
    dropped: [],
  });
  const s = await listen(plans);
  try {
    const out = await post(s.base, "/api/plan/resolve", {
      id,
      accepted: [],
      remarks: { "add:calendar": "Keep this change local-only." },
      nodes: SHEET.nodes,
    });
    assert.equal(out.ok, true);
    const result = await fetch(`${s.base}/api/plan/result?id=${id}`).then((r) => r.json());
    assert.match(result.brief, /User's reason: Keep this change local-only\./);
  } finally { await s.close(); }
});

test("asking for a result with no review reports it gone", async () => {
  const s = await listen(createPlanStore());
  try {
    const out = await fetch(`${s.base}/api/plan/result?id=nope`).then((r) => r.json());
    assert.equal(out.status, "gone");
  } finally { await s.close(); }
});

test("createServer still works with no store passed", async () => {
  const server = createServer(fakeWs(SHEET));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const out = await fetch(`http://127.0.0.1:${server.address().port}/api/plan`).then((r) => r.json());
    assert.equal(out.review, null);
  } finally { await new Promise((r) => server.close(r)); }
});

/* The cold-start path: a review opened on a project with no sheet is already
   scanning, and the browser must draw that scan rather than a second one whose
   ids the brief has never heard of. */

const emptyWs = () => {
  const files = new Map();
  return {
    root: "/tmp/fresh-project",
    files,
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, c) { files.set(p, c); },
    async exists(p) { return files.has(p); },
    async list() { return []; },
  };
};

const SCANNED = {
  moves: [
    { t: "addNode", node: { id: "server", name: "Server" } },
    { t: "addNode", node: { id: "store", name: "Store" } },
    { t: "connect", from: "server", to: "store", label: "reads", origin: "scan", operations: [] },
  ],
  dropped: [], provider: "test", model: "test",
};

test("the browser's first scan is answered with the one the review is running", async () => {
  const plans = createPlanStore();
  plans.open({ plan: "1. Add a limiter\n" });
  const ws = emptyWs();
  const server = createServer(ws, plans);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let runs = 0;
    const filling = plans.fill(ws, {
      scan: async () => { runs++; return SCANNED; },
      delta: async () => ({ delta: { additions: [], touches: [], connections: [], unplaced: [] }, dropped: [] }),
    });
    await new Promise((r) => setTimeout(r, 0));   // fill reads the sheet before it offers the scan

    const out = await post(base, "/api/adopt", {});
    assert.deepEqual(out.moves, SCANNED.moves);
    await filling;
    // One scan, and the sheet on disk is the one the review read.
    assert.equal(runs, 1);
    const written = JSON.parse(ws.files.get("plangolin/system.json"));
    assert.deepEqual(written.nodes.map((n) => n.id), ["server", "store"]);
    assert.deepEqual(plans.current().nodes.map((n) => n.id), written.nodes.map((n) => n.id));
  } finally { await new Promise((r) => server.close(r)); }
});
