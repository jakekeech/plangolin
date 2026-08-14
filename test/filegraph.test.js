import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFileGraph, fingerprintGraph } from "../src/filegraph.js";

/** Minimal in-memory Workspace: the same methods src/workspace.js has. */
function fakeWs(tree) {
  return {
    root: "/fake",
    async read(p) { return Object.hasOwn(tree, p) ? tree[p] : null; },
    async exists(p) { return Object.hasOwn(tree, p); },
    async list(dir) {
      const seen = new Map();
      for (const p of Object.keys(tree)) {
        if (dir && !p.startsWith(dir + "/")) continue;
        const rest = dir ? p.slice(dir.length + 1) : p;
        const slash = rest.indexOf("/");
        if (slash === -1) seen.set(rest, false);
        else seen.set(rest.slice(0, slash), true);
      }
      return [...seen].map(([name, isDir]) => ({ name, dir: isDir }));
    },
    async write() {},
  };
}

test("builds a graph from real imports", async () => {
  const ws = fakeWs({
    "src/adopt.js": `import { callModel } from "./llm.js";`,
    "src/llm.js": `export function callModel() {}`,
    "src/cli.js": `import { createServer } from "./boot.js";`,
    "src/boot.js": `export function createServer() {}`,
  });
  const g = await buildFileGraph(ws);
  assert.deepEqual(g.files, ["src/adopt.js", "src/boot.js", "src/cli.js", "src/llm.js"]);
  assert.deepEqual(g.links, [
    { from: "src/adopt.js", to: "src/llm.js", kind: "import", names: ["callModel"] },
    { from: "src/cli.js", to: "src/boot.js", kind: "import", names: ["createServer"] },
  ]);
});

test("skips excluded directories", async () => {
  const ws = fakeWs({
    "src/a.js": "",
    "node_modules/dep/index.js": "",
    "plangolin/system.json": "{}",
  });
  const g = await buildFileGraph(ws);
  assert.deepEqual(g.files, ["src/a.js"]);
});

test("is byte-stable across runs", async () => {
  const ws = fakeWs({
    "src/a.js": `import "./b.js"; import "./c.js";`,
    "src/b.js": "", "src/c.js": "",
  });
  const one = await buildFileGraph(ws);
  const two = await buildFileGraph(ws);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});

test("reads go.mod so Go imports resolve", async () => {
  const ws = fakeWs({
    "go.mod": "module example.com/app\n",
    "main.go": `import "example.com/app/db"`,
    "db/conn.go": "package db",
  });
  const g = await buildFileGraph(ws);
  assert.deepEqual(g.links, [{ from: "main.go", to: "db/conn.go", kind: "import", names: [] }]);
});

test("fingerprints normalized graph facts independently of input order", () => {
  const one = fingerprintGraph({
    files: ["src/z.js", "src/a.js"],
    links: [
      { from: "src/z.js", to: "src/a.js", kind: "import", names: ["write", "read"] },
      { from: "src/a.js", to: "src/z.js", kind: "http", names: [] },
    ],
    capped: false,
  });
  const reordered = fingerprintGraph({
    capped: false,
    links: [
      { names: [], kind: "http", to: "src/z.js", from: "src/a.js" },
      { names: ["read", "write"], kind: "import", to: "src/a.js", from: "src/z.js" },
    ],
    files: ["src/a.js", "src/z.js"],
  });

  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(reordered, one);
});

test("fingerprints change when a file, link, or imported name changes", () => {
  const base = {
    files: ["src/a.js", "src/b.js"],
    links: [{ from: "src/a.js", to: "src/b.js", kind: "import", names: ["read"] }],
    capped: false,
  };

  assert.notEqual(fingerprintGraph({ ...base, files: [...base.files, "src/c.js"] }), fingerprintGraph(base));
  assert.notEqual(fingerprintGraph({
    ...base,
    links: [{ ...base.links[0], to: "src/a.js" }],
  }), fingerprintGraph(base));
  assert.notEqual(fingerprintGraph({
    ...base,
    links: [{ ...base.links[0], names: ["write"] }],
  }), fingerprintGraph(base));
});
