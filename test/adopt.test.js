import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDeps, rollUpEdges, fallbackName } from "../src/adopt.js";

const GROUPS = [
  { id: "g1", files: ["src/cli.js", "src/boot.js"], children: [] },
  { id: "g2", files: ["src/llm.js"], children: [] },
];

test("rolls file links up into group dependencies", () => {
  const links = [
    { from: "src/boot.js", to: "src/llm.js", kind: "import" },
    { from: "src/cli.js", to: "src/boot.js", kind: "import" },
  ];
  assert.deepEqual(groupDeps(GROUPS, links).get("g1"), ["g2"]);
  assert.deepEqual(groupDeps(GROUPS, links).get("g2"), []);
});

test("rolls many file links into one edge per pair", () => {
  const links = [
    { from: "src/boot.js", to: "src/llm.js", kind: "import" },
    { from: "src/cli.js", to: "src/llm.js", kind: "import" },
  ];
  const edges = rollUpEdges(GROUPS, links);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { from: "g1", to: "g2", kinds: ["import"], names: [] });
});

test("ignores links that stay inside one group", () => {
  const links = [{ from: "src/cli.js", to: "src/boot.js", kind: "import" }];
  assert.deepEqual(rollUpEdges(GROUPS, links), []);
});

test("records that an edge is only backed by name matching", () => {
  const links = [{ from: "src/boot.js", to: "src/llm.js", kind: "name" }];
  assert.deepEqual(rollUpEdges(GROUPS, links)[0].kinds, ["name"]);
});

test("a child's links are drawn from the child, not its parent", () => {
  const nested = [
    { id: "g1", files: [], children: [{ id: "g1.1", files: ["src/boot.js"], children: [] }] },
    { id: "g2", files: ["src/llm.js"], children: [] },
  ];
  const links = [{ from: "src/boot.js", to: "src/llm.js", kind: "import" }];
  assert.deepEqual(rollUpEdges(nested, links).map((e) => [e.from, e.to]), [["g1.1", "g2"]]);
});

test("fallbackName is used when the model gives nothing", () => {
  assert.equal(fallbackName(["src/llm.js", "src/env.js"]), "Llm");
  assert.equal(fallbackName([]), "Group");
});
