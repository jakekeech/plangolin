import { test } from "node:test";
import assert from "node:assert/strict";
import { louvain, chooseGroups, folderBuckets, shouldCluster } from "../src/cluster.js";

const flat = (groups) => groups.flatMap((g) => [...g.files, ...flat(g.children)]);

test("folderBuckets groups by the first segment below the common prefix", () => {
  assert.deepEqual(folderBuckets(["src/a.js", "src/b.js", "app/c.js"]), [
    ["app/c.js"], ["src/a.js", "src/b.js"],
  ]);
});

test("folderBuckets puts files with no folder of their own in one bucket", () => {
  assert.deepEqual(folderBuckets(["main.go", "db/conn.go"]), [["main.go"], ["db/conn.go"]]);
});

test("shouldCluster fires only when there is nothing to split on", () => {
  assert.equal(shouldCluster([["a", "b", "c"]]), true);     // one bucket
  assert.equal(shouldCluster([]), true);                     // no buckets
  assert.equal(shouldCluster([["a", "b"], ["c", "d"]]), false);
});

test("a folder holding most of the repo is recursed into, not rejected", () => {
  // fastify's shape: 226 of 297 files under test/. Rejecting the folder
  // partition because one bucket is large gave a single block for the whole
  // project — the dominant folder is what recursion is for.
  const big = Array.from({ length: 20 }, (_, i) => `test/t${String(i).padStart(2, "0")}.js`);
  const rest = ["lib/a.js", "lib/b.js", "examples/e.js", "scripts/s.js"];
  const files = [...big, ...rest];
  assert.equal(shouldCluster(folderBuckets(files)), false);
  const groups = chooseGroups(louvain(files, []), files);
  assert.ok(groups.length >= 3, `expected the folders to survive, got ${groups.length} group(s)`);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("falls back to the coarsest level, not the most fragmented", () => {
  // hono's shape: no clustering level lands within the cap, so the fallback
  // decides everything. Twenty tight triangles joined in pairs aggregate
  // 20 -> 10, and neither fits a cap of six. Taking the finest level, as
  // this once did, hands back the most fragmented partition available —
  // that is how hono produced ninety top-level blocks.
  const files = [];
  const edges = [];
  for (let t = 0; t < 20; t++) {
    const n = [0, 1, 2].map((i) => `src/t${String(t).padStart(2, "0")}_${i}.js`);
    files.push(...n);
    edges.push({ from: n[0], to: n[1] }, { from: n[1], to: n[2] }, { from: n[2], to: n[0] });
  }
  for (let t = 0; t < 20; t += 2) {
    edges.push({
      from: `src/t${String(t).padStart(2, "0")}_0.js`,
      to: `src/t${String(t + 1).padStart(2, "0")}_0.js`,
    });
  }
  const groups = chooseGroups(louvain(files, edges), files, { maxPerLevel: 6 });
  assert.equal(groups.length, 10, `expected the coarsest level (10), got ${groups.length}`);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("a tidy repo keeps its folder names as groups", () => {
  const files = ["routes/a.js", "routes/b.js", "models/c.js", "models/d.js"];
  const groups = chooseGroups(louvain(files, []), files);
  assert.deepEqual(groups.map((g) => g.files), [
    ["models/c.js", "models/d.js"], ["routes/a.js", "routes/b.js"],
  ]);
});

test("every file lands in exactly one group", () => {
  const files = ["a1", "a2", "a3", "b1", "b2"];
  const edges = [
    { from: "a1", to: "a2" }, { from: "a2", to: "a3" }, { from: "b1", to: "b2" },
  ];
  const groups = chooseGroups(louvain(files, edges), files);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("splits a large group into children", () => {
  const files = Array.from({ length: 14 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  const edges = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (i !== j) {
    edges.push({ from: files[i], to: files[j] });
  }
  for (let i = 7; i < 14; i++) for (let j = 7; j < 14; j++) if (i !== j) {
    edges.push({ from: files[i], to: files[j] });
  }
  const groups = chooseGroups(louvain(files, edges), files);
  assert.equal(groups.length, 2);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("emits more than the cap rather than forcing a merge", () => {
  // Eight genuine pairs. Each is a real group; merging any two of them
  // would invent a parent that means nothing, so all eight are emitted
  // even though the cap is six.
  const files = [];
  const edges = [];
  for (let i = 0; i < 8; i++) {
    const a = `pair${i}/a.ex`;
    const b = `pair${i}/b.ex`;
    files.push(a, b);
    edges.push({ from: a, to: b });
  }
  const groups = chooseGroups(louvain(files, edges), files, { maxPerLevel: 6 });
  assert.ok(groups.length > 6, `expected more than 6 groups, got ${groups.length}`);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("files with no relationships at all stay in one honest group", () => {
  // Nothing links these, so nothing can be said about how they divide.
  // One block admitting that beats sixteen blocks pretending otherwise.
  const files = Array.from({ length: 16 }, (_, i) => `f${String(i).padStart(2, "0")}.ex`);
  const groups = chooseGroups(louvain(files, []), files, { maxPerLevel: 6 });
  assert.equal(groups.length, 1);
  assert.deepEqual(flat(groups).sort(), [...files].sort());
});

test("stops at the depth limit", () => {
  const files = Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  const groups = chooseGroups(louvain(files, []), files, { maxDepth: 2 });
  const depth = (gs, d = 1) =>
    Math.max(d, ...gs.map((g) => (g.children.length ? depth(g.children, d + 1) : d)));
  assert.ok(depth(groups) <= 2);
});

test("refuses a split that is mostly single files", () => {
  // Twelve files that barely reference each other. Clustering would happily
  // hand back a dozen one-file groups; that is a list, not an explanation.
  const files = Array.from({ length: 12 }, (_, i) => `lib/f${String(i).padStart(2, "0")}.ex`);
  const edges = [{ from: files[0], to: files[1] }];
  const groups = chooseGroups(louvain(files, edges), files);
  const singletons = groups.filter((g) => g.files.length === 1).length;
  assert.ok(singletons <= groups.length / 2, `${singletons} of ${groups.length} were singletons`);
});

test("a small group is never split", () => {
  const files = ["a", "b", "c"];
  const groups = chooseGroups(louvain(files, [{ from: "a", to: "b" }]), files);
  for (const g of groups) assert.deepEqual(g.children, []);
});
