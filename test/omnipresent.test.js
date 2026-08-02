import { test } from "node:test";
import assert from "node:assert/strict";
import { omnipresent, groupFiles } from "../src/cluster.js";

const link = (from, to) => ({ from, to });

/** n files, all importing `shared` — the shape this exists to catch. */
const withSharedCore = (n) => {
  const files = ["shared.py", ...Array.from({ length: n }, (_, i) => `w${i}.py`)];
  const links = files.slice(1).map((f) => link(f, "shared.py"));
  return { files, links };
};

test("finds a file nearly everything imports", () => {
  const { files, links } = withSharedCore(8);
  assert.deepEqual([...omnipresent(files, links)], ["shared.py"]);
});

test("ignores a file only a few import", () => {
  const files = ["a.py", "b.py", "c.py", "d.py", "e.py", "f.py", "g.py"];
  const links = [link("a.py", "g.py"), link("b.py", "g.py")];
  assert.deepEqual([...omnipresent(files, links)], []);
});

test("says nothing about a graph too small to have a ratio", () => {
  const { files, links } = withSharedCore(3);   // 4 files, under minForHubs
  assert.deepEqual([...omnipresent(files, links)], []);
});

// A file importing many others is an entry point — main.py, cli.js, index.ts —
// and it is the single most useful block on the sheet. Counting out-degree
// would delete it from the diagram it is supposed to anchor.
test("an entry point that imports everything is not a hub", () => {
  const files = ["main.py", "a.py", "b.py", "c.py", "d.py", "e.py", "f.py"];
  const links = files.slice(1).map((f) => link("main.py", f));
  assert.deepEqual([...omnipresent(files, links)], []);
});

// A small dense system is not a system with a shared core. Splitting one is
// inventing a distinction the code does not make.
test("refuses when more than half the graph looks omnipresent", () => {
  const files = ["a.py", "b.py", "c.py", "d.py", "e.py", "f.py"];
  const links = [];
  for (const from of files) for (const to of files) if (from !== to) links.push(link(from, to));
  assert.deepEqual([...omnipresent(files, links)], []);
});

// The regression this was built for: nine files, two of them imported by
// everything, previously rendered as one featureless block because nine is
// below minSplit. The shared core earns the split on its own.
test("splits a group under minSplit when it has a shared core", () => {
  const files = [
    "api/main.py", "api/models.py", "api/logging.py", "api/applier.py",
    "api/hunter.py", "api/scorer.py", "api/state.py", "api/platforms.py",
  ];
  // Everything leans on models and logging...
  const links = [];
  for (const f of files) {
    if (f !== "api/models.py") links.push(link(f, "api/models.py"));
    if (f !== "api/logging.py") links.push(link(f, "api/logging.py"));
  }
  // ...and the rest still have structure of their own, which is what makes
  // the split worth drawing. A fixture where every edge points at the core
  // leaves disconnected singletons behind, and the anti-fragmentation guard
  // correctly refuses those.
  links.push(
    link("api/applier.py", "api/hunter.py"),
    link("api/applier.py", "api/platforms.py"),
    link("api/hunter.py", "api/platforms.py"),
    link("api/main.py", "api/scorer.py"),
    link("api/main.py", "api/state.py"),
    link("api/scorer.py", "api/state.py"),
  );
  const groups = groupFiles(files, links, { minSplit: 10 });
  const flat = (gs) => gs.flatMap((g) => [g, ...flat(g.children)]);
  const core = flat(groups).find(
    (g) => g.files.length === 2 && g.files.every((f) => /models|logging/.test(f)));
  assert.ok(core, "the shared core should be its own group");
});

test("leaves a graph with no shared core exactly as it was", () => {
  const files = ["a/x.js", "a/y.js", "b/p.js", "b/q.js"];
  const links = [link("a/x.js", "a/y.js"), link("b/p.js", "b/q.js")];
  const groups = groupFiles(files, links);
  assert.equal(groups.length, 2);
});
