import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDelta } from "../src/delta.js";

const doc = (over) => ({ nodes: [], edges: [], ...over });
const types = (d) => d.changes.map((c) => c.type).sort();

test("a deleted file leaves its block", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js", "src/gone.js"] } }] }),
    { files: ["src/x.js"], links: [] },
  );
  const c = d.changes.find((x) => x.type === "file-removed");
  assert.deepEqual(c, { type: "file-removed", block: "a", file: "src/gone.js" });
});

test("a new file whose links point into one block is proposed for it", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js"] } }] }),
    { files: ["src/x.js", "src/new.js"], links: [{ from: "src/new.js", to: "src/x.js", kind: "import" }] },
  );
  const c = d.changes.find((x) => x.type === "file-added");
  assert.deepEqual(c, { type: "file-added", block: "a", file: "src/new.js" });
});

test("a new file with no links stays unmapped", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js"] } }] }),
    { files: ["src/x.js", "src/lonely.js"], links: [] },
  );
  assert.ok(types(d).includes("file-unmapped"));
});

test("a new link between two blocks becomes an edge", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { paths: ["src/a.js"] } },
        { id: "b", anchor: { paths: ["src/b.js"] } },
      ],
    }),
    { files: ["src/a.js", "src/b.js"], links: [{ from: "src/a.js", to: "src/b.js", kind: "import" }] },
  );
  const c = d.changes.find((x) => x.type === "edge-added");
  assert.deepEqual(c, { type: "edge-added", from: "a", to: "b", kind: "import" });
});

test("a scan-drawn edge that loses its backing is removed", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { paths: ["src/a.js"] } },
        { id: "b", anchor: { paths: ["src/b.js"] } },
      ],
      edges: [{ id: "a__b", from: "a", to: "b", origin: "scan" }],
    }),
    { files: ["src/a.js", "src/b.js"], links: [] },
  );
  assert.ok(types(d).includes("edge-lost"));
});

test("a user-drawn edge that loses its backing is flagged, not removed", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { paths: ["src/a.js"] } },
        { id: "b", anchor: { paths: ["src/b.js"] } },
      ],
      edges: [{ id: "a__b", from: "a", to: "b", origin: "user" }],
    }),
    { files: ["src/a.js", "src/b.js"], links: [] },
  );
  const c = d.changes.find((x) => x.type === "edge-contradicted");
  assert.deepEqual(c, { type: "edge-contradicted", edgeId: "a__b", from: "a", to: "b" });
});

test("summary counts confirmed, unverified and contradicted lines", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { paths: ["src/a.js"] } },
        { id: "b", anchor: { paths: ["lib/b.ex"] } },
        { id: "c", anchor: { paths: ["src/c.js"] } },
      ],
      edges: [
        { id: "a__b", from: "a", to: "b", origin: "scan" },
        { id: "a__c", from: "a", to: "c", origin: "user" },
      ],
    }),
    {
      files: ["src/a.js", "lib/b.ex", "src/c.js"],
      links: [{ from: "src/a.js", to: "lib/b.ex", kind: "name" }],
    },
  );
  assert.deepEqual(d.summary, { confirmed: 0, unverified: 1, contradicted: 1 });
});

test("an unchanged sheet produces no changes", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { paths: ["src/a.js"] } },
        { id: "b", anchor: { paths: ["src/b.js"] } },
      ],
      edges: [{ id: "a__b", from: "a", to: "b", origin: "scan" }],
    }),
    { files: ["src/a.js", "src/b.js"], links: [{ from: "src/a.js", to: "src/b.js", kind: "import" }] },
  );
  assert.deepEqual(d.changes, []);
});

test("a changed file in a block the sheet owns reports the block as changed inside", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js", "src/y.js"] } }] }),
    { files: ["src/x.js", "src/y.js"], links: [] },
    new Set(["src/y.js"]),
  );
  const c = d.changes.find((x) => x.type === "block-changed-inside");
  assert.deepEqual(c, { type: "block-changed-inside", block: "a", files: ["src/y.js"] });
});

test("without a baseline the sheet says nothing about content", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js"] } }] }),
    { files: ["src/x.js"], links: [] },
  );
  assert.ok(!types(d).includes("block-changed-inside"));
});

test("a changed file the graph does not carry is ignored", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js"] } }] }),
    { files: ["src/x.js"], links: [] },
    new Set(["package-lock.json"]),
  );
  assert.ok(!types(d).includes("block-changed-inside"));
});

test("a changed file no block owns does not report against any block", () => {
  const d = computeDelta(
    doc({ nodes: [{ id: "a", anchor: { paths: ["src/x.js"] } }] }),
    { files: ["src/x.js", "src/loose.js"], links: [] },
    new Set(["src/loose.js"]),
  );
  assert.ok(!types(d).includes("block-changed-inside"));
});

test("each block reports only its own changed files, sorted", () => {
  const d = computeDelta(
    doc({
      nodes: [
        { id: "a", anchor: { dir: "src/a" } },
        { id: "b", anchor: { dir: "src/b" } },
      ],
    }),
    { files: ["src/a/one.js", "src/a/two.js", "src/b/three.js"], links: [] },
    new Set(["src/a/two.js", "src/a/one.js", "src/b/three.js"]),
  );
  const found = d.changes
    .filter((x) => x.type === "block-changed-inside")
    .map((x) => [x.block, x.files]);
  assert.deepEqual(found, [
    ["a", ["src/a/one.js", "src/a/two.js"]],
    ["b", ["src/b/three.js"]],
  ]);
});
