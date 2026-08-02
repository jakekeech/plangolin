import { test } from "node:test";
import assert from "node:assert/strict";
import { runSync } from "../src/sync.js";

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

test("reports a line backed by a real import as confirmed", async () => {
  const ws = fakeWs({ "src/a.js": `import "./b.js";`, "src/b.js": "" });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] } },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] } },
    ],
    edges: [{ id: "a__b", from: "a", to: "b", origin: "scan" }],
  };
  const r = await runSync(ws, doc);
  assert.equal(r.summary.confirmed, 1);
  assert.deepEqual(r.changes, []);
});

test("flags a user-drawn line with no code behind it", async () => {
  const ws = fakeWs({ "src/a.js": "", "src/b.js": "" });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] } },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] } },
    ],
    edges: [{ id: "a__b", from: "a", to: "b", origin: "user" }],
  };
  const r = await runSync(ws, doc);
  assert.equal(r.summary.contradicted, 1);
  assert.equal(r.changes[0].type, "edge-contradicted");
});

test("still reports folders for the existing UI", async () => {
  const ws = fakeWs({ "src/a.js": "" });
  const doc = { nodes: [{ id: "a", name: "A", anchor: { paths: ["src/a.js"] } }], edges: [] };
  const r = await runSync(ws, doc);
  assert.deepEqual(r.folders, [{ id: "a", name: "A", dir: "src", exists: true, invalid: false }]);
});

test("marks a block whose files are gone", async () => {
  const ws = fakeWs({ "src/a.js": "" });
  const doc = { nodes: [{ id: "z", name: "Z", anchor: { paths: ["src/gone.js"] } }], edges: [] };
  const r = await runSync(ws, doc);
  assert.equal(r.folders[0].exists, false);
});

/** Stands in for the object makeGit() returns. */
function fakeGit(files = [], isRepo = true, untracked = []) {
  return {
    async isRepo() { return isRepo; },
    async changedFiles() { return files; },
    async untracked() { return untracked; },
  };
}

test("a sync with a baseline reports which blocks changed inside", async () => {
  const ws = fakeWs({ "src/a.js": `import "./b.js";`, "src/b.js": "" });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] } },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] } },
    ],
    edges: [],
  };
  const out = await runSync(ws, doc, { kind: "uncommitted" }, fakeGit(["src/b.js"]));
  const c = out.changes.find((x) => x.type === "block-changed-inside");
  assert.deepEqual(c, { type: "block-changed-inside", block: "b", files: ["src/b.js"] });
  assert.deepEqual(out.baseline, { kind: "uncommitted", ref: "HEAD" });
});

test("a project with no git syncs exactly as before", async () => {
  const ws = fakeWs({ "src/a.js": "" });
  const doc = { nodes: [{ id: "a", name: "A", anchor: { paths: ["src/a.js"] } }], edges: [] };
  const out = await runSync(ws, doc, { kind: "uncommitted" }, fakeGit([], false));
  assert.equal(out.baseline, null);
  assert.ok(!out.changes.some((x) => x.type === "block-changed-inside"));
});

test("a sync never carries a position, so the sheet cannot move underneath one", async () => {
  // The whole diff view rests on a surviving block keeping the position you
  // already learned. That is guaranteed structurally rather than by care:
  // runSync speaks about folders, counts and changes, and never about
  // coordinates, so there is nothing in its answer the canvas could move a
  // block with. This test is here to keep it that way.
  const ws = fakeWs({ "src/a.js": `import "./b.js";`, "src/b.js": "" });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] }, x: 137, y: 211 },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] }, x: 463, y: 97 },
    ],
    edges: [],
  };
  const out = await runSync(ws, doc, { kind: "uncommitted" }, fakeGit(["src/b.js"]));
  const json = JSON.stringify(out);
  assert.ok(!json.includes('"x"'), "sync output must not carry an x coordinate");
  assert.ok(!json.includes('"y"'), "sync output must not carry a y coordinate");
  assert.ok(!json.includes("137") && !json.includes("463"), "no position may leak through");
});



test("a sync groups the changed blocks into separate changes", async () => {
  // a and b refer to each other, c stands alone: two changes, not three.
  const ws = fakeWs({
    "src/a.js": `import "./b.js";`, "src/b.js": "", "src/c.js": "",
  });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] } },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] } },
      { id: "c", name: "C", anchor: { paths: ["src/c.js"] } },
    ],
    edges: [],
  };
  const out = await runSync(ws, doc, { kind: "uncommitted" },
    fakeGit(["src/a.js", "src/b.js", "src/c.js"]));
  assert.deepEqual(out.groups.map((g) => g.blocks), [["a", "b"], ["c"]]);
});

test("groups come from the code's links, not the lines someone drew", async () => {
  // The diagram being behind is the case this exists for, so an undrawn link
  // must still group the blocks it connects.
  const ws = fakeWs({ "src/a.js": `import "./b.js";`, "src/b.js": "" });
  const doc = {
    nodes: [
      { id: "a", name: "A", anchor: { paths: ["src/a.js"] } },
      { id: "b", name: "B", anchor: { paths: ["src/b.js"] } },
    ],
    edges: [],                                  // nothing drawn between them
  };
  const out = await runSync(ws, doc, { kind: "uncommitted" }, fakeGit(["src/a.js", "src/b.js"]));
  assert.deepEqual(out.groups.map((g) => g.blocks), [["a", "b"]]);
});
