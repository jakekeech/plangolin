import { test } from "node:test";
import assert from "node:assert/strict";
import { groupChanges } from "../src/changesets.js";

const ids = (groups) => groups.map((g) => g.blocks);

test("blocks that reference each other are one change", () => {
  // The ClusterChanges finding, in graph terms: things that changed together
  // and refer to each other were almost certainly changed for one reason.
  const got = groupChanges(["a", "b"], [{ from: "a", to: "b" }]);
  assert.deepEqual(ids(got), [["a", "b"]]);
});

test("blocks with nothing between them are separate changes", () => {
  const got = groupChanges(["a", "b"], []);
  assert.deepEqual(ids(got), [["a"], ["b"]]);
});

test("a chain is one change, however long", () => {
  const got = groupChanges(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]);
  assert.deepEqual(ids(got), [["a", "b", "c"]]);
});

test("direction doesn't matter — a change is not a dependency", () => {
  const got = groupChanges(["a", "b"], [{ from: "b", to: "a" }]);
  assert.deepEqual(ids(got), [["a", "b"]]);
});

test("a line to a block that didn't change joins nothing", () => {
  // Otherwise a shared hub would drag every change in the project into one
  // group, which is the failure mode that makes decomposition useless.
  const got = groupChanges(["a", "c"], [{ from: "a", to: "hub" }, { from: "c", to: "hub" }]);
  assert.deepEqual(ids(got), [["a"], ["c"]]);
});

test("two separate changes stay separate", () => {
  const got = groupChanges(["a", "b", "x", "y"],
    [{ from: "a", to: "b" }, { from: "x", to: "y" }]);
  assert.deepEqual(ids(got), [["a", "b"], ["x", "y"]]);
});

test("the biggest change comes first, and everything is sorted so two runs agree", () => {
  // Size first because the largest group is usually the thing the commit was
  // actually for; the singletons are what came along with it.
  const got = groupChanges(["z", "b", "a"], [{ from: "z", to: "b" }]);
  assert.deepEqual(ids(got), [["b", "z"], ["a"]]);
  assert.deepEqual(ids(groupChanges(["a", "z", "b"], [{ from: "b", to: "z" }])), ids(got));
});

test("nothing changed is no groups at all", () => {
  assert.deepEqual(groupChanges([], [{ from: "a", to: "b" }]), []);
});

test("each group carries how many blocks it holds", () => {
  const got = groupChanges(["a", "b", "c"], [{ from: "a", to: "b" }]);
  assert.deepEqual(got.map((g) => g.n), [2, 1]);
  assert.deepEqual(ids(got), [["a", "b"], ["c"]]);
});
