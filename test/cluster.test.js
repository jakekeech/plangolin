import { test } from "node:test";
import assert from "node:assert/strict";
import { louvain, folderBuckets } from "../src/cluster.js";

/** Two tight triangles joined by a single edge — the textbook case. */
const NODES = ["a1", "a2", "a3", "b1", "b2", "b3"];
const EDGES = [
  { from: "a1", to: "a2" }, { from: "a2", to: "a3" }, { from: "a3", to: "a1" },
  { from: "b1", to: "b2" }, { from: "b2", to: "b3" }, { from: "b3", to: "b1" },
  { from: "a1", to: "b1" },
];

test("separates two obvious communities", () => {
  const levels = louvain(NODES, EDGES);
  const top = levels[levels.length - 1];
  assert.equal(top.get("a1"), top.get("a2"));
  assert.equal(top.get("a2"), top.get("a3"));
  assert.equal(top.get("b1"), top.get("b2"));
  assert.notEqual(top.get("a1"), top.get("b1"));
});

test("is deterministic across runs", () => {
  const a = louvain(NODES, EDGES);
  const b = louvain(NODES, EDGES);
  assert.equal(JSON.stringify(a.map((m) => [...m].sort())),
               JSON.stringify(b.map((m) => [...m].sort())));
});

test("is insensitive to input order", () => {
  const a = louvain(NODES, EDGES);
  const b = louvain([...NODES].reverse(), [...EDGES].reverse());
  const key = (levels) => {
    const top = levels[levels.length - 1];
    const groups = new Map();
    for (const [n, c] of top) {
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(n);
    }
    return JSON.stringify([...groups.values()].map((g) => g.sort()).sort());
  };
  assert.equal(key(a), key(b));
});

test("every node appears in every level", () => {
  for (const level of louvain(NODES, EDGES)) {
    assert.deepEqual([...level.keys()].sort(), [...NODES].sort());
  }
});

test("an isolated node gets its own community", () => {
  const levels = louvain([...NODES, "lonely"], EDGES);
  const top = levels[levels.length - 1];
  for (const n of NODES) assert.notEqual(top.get("lonely"), top.get(n));
});

test("an empty graph produces one level with each node alone", () => {
  const levels = louvain(["x", "y"], []);
  assert.equal(levels.length, 1);
  assert.notEqual(levels[0].get("x"), levels[0].get("y"));
});

// A common repo shape: source lives one folder down, and that folder also
// holds loose root-level files (configs) alongside real subfolders. The
// common-prefix trim used to give up entirely here (the shared root has no
// "/" inside it) and bucket every file together, which then also failed to
// split under clustering — the exact one-node result this guards against.
test("buckets by subfolder when everything shares a one-segment root", () => {
  const files = [
    "app/root/config.ts",
    "app/root/sub/a.ts",
    "app/root/sub/b.ts",
    "app/root/other/c.ts",
  ];
  const buckets = folderBuckets(files);
  assert.equal(buckets.length, 3);
  const byFirst = buckets.map((b) => b[0]);
  assert.ok(byFirst.includes("app/root/config.ts"));
  assert.ok(buckets.some((b) => b.includes("app/root/sub/a.ts") && b.includes("app/root/sub/b.ts")));
  assert.ok(buckets.some((b) => b.includes("app/root/other/c.ts")));
});
