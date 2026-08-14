import { test } from "node:test";
import assert from "node:assert/strict";
import { generatedPositions, layeredPositions } from "../app/graph-layout.js";

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

test("a long chain wraps after five dependency columns", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  assert.deepEqual(Object.fromEntries(layeredPositions(ids, edges)), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 750, y: 0 }, e: { x: 1000, y: 0 }, f: { x: 0, y: 138 },
  });
});
