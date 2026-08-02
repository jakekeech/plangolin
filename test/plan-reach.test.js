import { test } from "node:test";
import assert from "node:assert/strict";
import { planReach } from "../src/plan-reach.js";

test("a chain returns only the block one directed hop upstream", () => {
  const edges = [
    { from: "entry", to: "router", label: "calls into" },
    { from: "router", to: "store", label: "queries" },
  ];

  assert.deepEqual(planReach(edges, ["store"]), [
    { id: "router", via: "store", label: "queries" },
  ]);
});

test("a diamond returns both direct users and no block beyond them", () => {
  const edges = [
    { from: "entry", to: "left", label: "calls into" },
    { from: "entry", to: "right", label: "calls into" },
    { from: "left", to: "core", label: "asks for" },
    { from: "right", to: "core", label: "checks with" },
  ];

  assert.deepEqual(planReach(edges, new Set(["core"])), [
    { id: "left", via: "core", label: "asks for" },
    { id: "right", via: "core", label: "checks with" },
  ]);
});

test("a cycle still stops after the incoming edge", () => {
  const edges = [
    { from: "a", to: "b", label: "calls into" },
    { from: "b", to: "a", label: "hands off" },
  ];

  assert.deepEqual(planReach(edges, ["a"]), [
    { id: "b", via: "a", label: "hands off" },
  ]);
});

test("a block with no users returns nothing", () => {
  assert.deepEqual(planReach([{ from: "a", to: "b", label: "calls into" }], ["a"]), []);
});

test("an edge pointing out of the changed block is not upstream", () => {
  const edges = [{ from: "changed", to: "dependency", label: "queries" }];
  assert.deepEqual(planReach(edges, ["changed"]), []);
});
