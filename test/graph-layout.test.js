import { test } from "node:test";
import assert from "node:assert/strict";
import * as graphLayout from "../app/graph-layout.js";

const { generatedPositions, layeredPositions } = graphLayout;

test("the shared full layout is deterministic and wraps a directed run", () => {
  assert.equal(typeof graphLayout.layoutGraph, "function");
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ];
  const want = {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 500, y: 138 },
  };

  assert.deepEqual(Object.fromEntries(graphLayout.layoutGraph(nodes, edges)), want);
  assert.deepEqual(Object.fromEntries(graphLayout.layoutGraph(nodes, edges)), want);
});

test("generated branches follow connections instead of move order", () => {
  const moves = [
    { t: "addNode", node: { id: "web" } },
    { t: "addNode", node: { id: "api" } },
    { t: "addNode", node: { id: "db" } },
    { t: "addNode", node: { id: "worker" } },
    { t: "connect", from: "web", to: "api" },
    { t: "connect", from: "api", to: "db" },
    { t: "connect", from: "worker", to: "db" },
  ];

  assert.deepEqual(Object.fromEntries(generatedPositions(moves)), {
    web: { x: 0, y: 0 },
    worker: { x: 0, y: 138 },
    api: { x: 250, y: 69 },
    db: { x: 500, y: 69 },
  });
});

test("disconnected generated nodes use the compact grid", () => {
  const moves = ["a", "b", "c", "d", "e"].map((id) => ({ t: "addNode", node: { id } }));
  assert.deepEqual(Object.fromEntries(generatedPositions(moves)), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 750, y: 0 }, e: { x: 0, y: 138 },
  });
});

test("a cycle-closing edge does not keep increasing dependency depth", () => {
  assert.deepEqual(Object.fromEntries(layeredPositions(
    ["a", "b", "c"],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
  )), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
  });
});

test("a long chain wraps after three dependency columns", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  assert.deepEqual(Object.fromEntries(layeredPositions(ids, edges)), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 500, y: 138 }, e: { x: 250, y: 138 }, f: { x: 0, y: 138 },
  });
});

const overlaps = (a, b, aWidth = 198, aHeight = 220, bWidth = 198, bHeight = 220) =>
  a.x < b.x + bWidth && a.x + aWidth > b.x &&
  a.y < b.y + bHeight && a.y + aHeight > b.y;

test("incremental layout preserves fixed positions and follows proposal edges", () => {
  const nodes = [
    { id: "api", x: 37, y: 19, width: 198, height: 80, fixed: true },
    { id: "worker" },
    { id: "queue" },
  ];
  const edges = [
    { from: "api", to: "worker" },
    { from: "worker", to: "queue" },
  ];
  const at = graphLayout.layoutGraph(nodes, edges, {
    mode: "incremental", nodeWidth: 198, nodeHeight: 220,
  });

  assert.deepEqual(at.get("api"), { x: 37, y: 19 });
  assert.equal(overlaps(at.get("api"), at.get("worker"), 198, 80), false);
  assert.equal(overlaps(at.get("worker"), at.get("queue")), false);
  const workerDistance = Math.hypot(at.get("worker").x - 37, at.get("worker").y - 19);
  const queueDistance = Math.hypot(at.get("queue").x - 37, at.get("queue").y - 19);
  assert.ok(workerDistance < queueDistance, "the directly connected proposal stays closest to its anchor");
});

test("an incremental proposal uses all fixed neighbours instead of the first edge", () => {
  const nodes = [
    { id: "left", x: 0, y: 0, fixed: true },
    { id: "right", x: 750, y: 0, fixed: true },
    { id: "hub" },
  ];
  const at = graphLayout.layoutGraph(nodes, [
    { from: "left", to: "hub" },
    { from: "right", to: "hub" },
  ], { mode: "incremental", nodeWidth: 198, nodeHeight: 220 });

  assert.ok(at.get("hub").x > at.get("left").x);
  assert.ok(at.get("hub").x < at.get("right").x);
});

test("an incremental proposal chain wraps and a dragged proposal remains fixed", () => {
  const nodes = [
    { id: "existing", x: 0, y: 0, fixed: true },
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    { id: "dragged", x: 1111, y: 777, fixed: true },
  ];
  const edges = [
    { from: "existing", to: "a" },
    { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" },
  ];
  const options = { mode: "incremental", nodeWidth: 198, nodeHeight: 220 };
  const first = graphLayout.layoutGraph(nodes, edges, options);
  const second = graphLayout.layoutGraph(nodes, edges, options);

  assert.deepEqual(first.get("dragged"), { x: 1111, y: 777 });
  assert.ok(new Set(["a", "b", "c", "d"].map((id) => first.get(id).y)).size > 1);
  assert.deepEqual(Object.fromEntries(first), Object.fromEntries(second));
  const movable = ["a", "b", "c", "d"].map((id) => first.get(id));
  for (let i = 0; i < movable.length; i++) {
    for (let j = i + 1; j < movable.length; j++) assert.equal(overlaps(movable[i], movable[j]), false);
  }
});

test("proposal positions adapt real, connected and dragged nodes into incremental layout", () => {
  assert.equal(typeof graphLayout.proposalPositions, "function");
  const first = graphLayout.proposalPositions({
    realNodes: [{ id: "api", x: 37, y: 19, width: 198, height: 80 }],
    additions: ["a", "b", "c", "d", "dragged"].map((id) => ({ id })),
    edges: [
      { from: "api", to: "a" },
      { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" },
    ],
    moved: new Map([["dragged", { x: 1111, y: 777 }]]),
    options: { nodeWidth: 198, nodeHeight: 220 },
  });

  assert.deepEqual([...first.keys()], ["a", "b", "c", "d", "dragged"]);
  assert.deepEqual(first.get("dragged"), { x: 1111, y: 777 });
  assert.ok(new Set(["a", "b", "c", "d"].map((id) => first.get(id).y)).size > 1);
  const aDistance = Math.hypot(first.get("a").x - 37, first.get("a").y - 19);
  const dDistance = Math.hypot(first.get("d").x - 37, first.get("d").y - 19);
  assert.ok(aDistance < dDistance, "the proposal directly connected to the real node stays closest");
});

test("disconnected proposals on an empty level use a compact non-negative grid", () => {
  const at = graphLayout.proposalPositions({
    additions: [{ id: "a" }, { id: "b" }, { id: "c" }],
  });

  assert.deepEqual(Object.fromEntries(at), {
    a: { x: 0, y: 0 },
    b: { x: 250, y: 0 },
    c: { x: 500, y: 0 },
  });
});
