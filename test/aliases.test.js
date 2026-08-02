import { test } from "node:test";
import assert from "node:assert/strict";
import { findAliasConfigs, resolveAlias } from "../src/imports/aliases.js";
import { buildFileGraph } from "../src/filegraph.js";

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

test("finds a root tsconfig with a path alias", async () => {
  const ws = fakeWs({
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }),
    "app/page.tsx": "",
  });
  const configs = await findAliasConfigs(ws);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].dir, "");
});

test("tolerates JSONC comments and a trailing comma", async () => {
  const ws = fakeWs({
    "tsconfig.json": `{
      // path aliases
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["./*"], },
      },
    }`,
    "app/page.tsx": "",
  });
  const configs = await findAliasConfigs(ws);
  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0].paths, { "@/*": ["./*"] });
});

test("resolves an aliased specifier to the real file it points at", () => {
  const configs = [{ dir: "", root: "", paths: { "@/*": ["./*"] } }];
  assert.equal(resolveAlias("@/db/schema", "app/api/route.ts", configs), "db/schema");
});

test("a file outside any config's directory gets no alias", () => {
  const configs = [{ dir: "web", root: "web", paths: { "@/*": ["./*"] } }];
  assert.equal(resolveAlias("@/db/schema", "other/file.ts", configs), null);
});

test("the nearest config wins over one further up the tree", async () => {
  const ws = fakeWs({
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./outer/*"] } } }),
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./inner/*"] } } }),
    "app/page.tsx": "",
  });
  const configs = await findAliasConfigs(ws);
  assert.equal(resolveAlias("@/x", "app/page.tsx", configs), "app/inner/x");
  assert.equal(resolveAlias("@/x", "root-level.ts", configs), "outer/x");
});

test("end to end: an @/ import resolves through a real file graph", async () => {
  const ws = fakeWs({
    "spell-library-web/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }),
    "spell-library-web/app/api/game/route.ts": `import { getDb } from "@/db";`,
    "spell-library-web/db/index.ts": "export function getDb() {}",
  });
  const g = await buildFileGraph(ws);
  assert.deepEqual(g.links, [
    { from: "spell-library-web/app/api/game/route.ts", to: "spell-library-web/db/index.ts", kind: "import", names: ["getDb"] },
  ]);
});

test("a project with no tsconfig still resolves relative imports as before", async () => {
  const ws = fakeWs({
    "src/a.js": `import "./b.js";`,
    "src/b.js": "",
  });
  const g = await buildFileGraph(ws);
  assert.deepEqual(g.links, [{ from: "src/a.js", to: "src/b.js", kind: "import", names: [] }]);
});
