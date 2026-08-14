import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalise,
  expandAnchor,
  docFromMoves,
  emptyDoc,
  load,
  save,
  saveIfEmpty,
} from "../src/schema.js";

const sys = (over) => ({ version: 1, nodes: [], edges: [], ...over });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryWorkspace(write = null) {
  const files = new Map();
  return {
    root: "/tmp/plangolin-schema-serialization",
    files,
    async read(file) { return files.get(file) ?? null; },
    async write(file, contents) {
      if (write) return write(files, file, contents);
      files.set(file, contents);
    },
  };
}

const persistedDoc = (id, x) => ({
  ...emptyDoc(),
  nodes: [{ id, name: id, kind: "", intent: "", details: "" }],
  layout: { [id]: { x, y: x + 1 } },
});

test("keeps anchor.paths", () => {
  const { doc } = normalise(sys({
    nodes: [{ id: "a", anchor: { paths: ["src/a.js", "src/b.js"] } }],
  }), null);
  assert.deepEqual(doc.nodes[0].anchor, { paths: ["src/a.js", "src/b.js"] });
});

test("still keeps anchor.dir", () => {
  const { doc } = normalise(sys({ nodes: [{ id: "a", anchor: { dir: "src" } }] }), null);
  assert.deepEqual(doc.nodes[0].anchor, { dir: "src" });
});

test("rejects a path that climbs out of the project", () => {
  const { doc } = normalise(sys({
    nodes: [{ id: "a", anchor: { paths: ["../secrets.js", "src/ok.js"] } }],
  }), null);
  assert.deepEqual(doc.nodes[0].anchor, { paths: ["src/ok.js"] });
});

test("drops an anchor left with no usable paths", () => {
  const { doc } = normalise(sys({
    nodes: [{ id: "a", anchor: { paths: ["../x"] } }],
  }), null);
  assert.equal(doc.nodes[0].anchor, undefined);
});

test("keeps edge origin, defaulting to user", () => {
  const { doc } = normalise(sys({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { from: "a", to: "b", origin: "scan" },
      { id: "x", from: "b", to: "a" },
    ],
  }), null);
  assert.equal(doc.edges[0].origin, "scan");
  assert.equal(doc.edges[1].origin, "user");
});

test("keeps the authored field list", () => {
  const { doc } = normalise(sys({
    nodes: [{ id: "a", authored: ["name", "intent", "bogus"] }],
  }), null);
  assert.deepEqual(doc.nodes[0].authored, ["intent", "name"]);
});

test("expandAnchor resolves both forms", () => {
  const files = ["src/a.js", "src/sub/b.js", "app/c.js"];
  assert.deepEqual(expandAnchor({ anchor: { dir: "src" } }, files), ["src/a.js", "src/sub/b.js"]);
  assert.deepEqual(expandAnchor({ anchor: { paths: ["app/c.js"] } }, files), ["app/c.js"]);
  assert.deepEqual(expandAnchor({}, files), []);
});

test("a block owning files is not treated as unanchored", async () => {
  const { proposeStructure } = await import("../src/structure.js");
  const ws = { root: "/f", async read() { return null; }, async write() {}, async exists() { return false; }, async list() { return []; } };
  // No model call should happen: every block already owns files.
  const r = await proposeStructure(ws, {
    nodes: [
      { id: "a", anchor: { paths: ["src/a.js"] } },
      { id: "b", anchor: { dir: "app" } },
    ],
  });
  assert.deepEqual(r.anchors, []);
});

/* docFromMoves has to agree with app.js's MOVES, because the same scan may be
   written by either one and the two sheets have to be the same sheet. */

test("a scan's moves become a document with its blocks and lines", () => {
  const doc = docFromMoves([
    { t: "addNode", node: { id: "a", name: "Server", anchor: { paths: ["src/a.js"] } } },
    { t: "addNode", node: { id: "b", name: "Store", parent: "a" } },
    { t: "connect", from: "a", to: "b", label: "reads", origin: "scan",
      operations: [{ name: "get" }] },
  ]);
  assert.deepEqual(doc.nodes.map((n) => n.id), ["a", "b"]);
  assert.equal(doc.nodes[1].parent, "a");
  assert.deepEqual(doc.nodes[0].anchor, { paths: ["src/a.js"] });
  assert.deepEqual(doc.edges[0], {
    id: "a__b", from: "a", to: "b", label: "reads", origin: "scan",
    operations: [{ name: "get", sends: "", returns: "" }],
  });
  // The browser decides where blocks sit; nothing here pretends to know.
  assert.deepEqual(doc.layout, {});
});

test("a pair already joined is not joined again in the other direction", () => {
  const doc = docFromMoves([
    { t: "addNode", node: { id: "a" } },
    { t: "addNode", node: { id: "b" } },
    { t: "connect", from: "a", to: "b", label: "calls" },
    { t: "connect", from: "b", to: "a", label: "answers" },
  ]);
  assert.deepEqual(doc.edges.map((e) => e.id), ["a__b"]);
});

test("moves that reference blocks that do not exist are dropped, not thrown", () => {
  const doc = docFromMoves([
    { t: "addNode", node: { id: "a" } },
    { t: "addNode", node: { id: "a", name: "again" } },
    { t: "addNode", node: {} },
    { t: "connect", from: "a", to: "gone" },
    { t: "connect", from: "a", to: "a" },
    { t: "nonsense" },
    null,
  ]);
  assert.deepEqual(doc.nodes.map((n) => n.id), ["a"]);
  assert.equal(doc.nodes[0].name, "a");
  assert.deepEqual(doc.edges, []);
});

test("nothing to replay is an empty sheet, not a crash", () => {
  assert.deepEqual(docFromMoves(undefined).nodes, []);
  assert.deepEqual(docFromMoves([]).edges, []);
});

test("saveIfEmpty gives an already-started ordinary save first-writer ownership", async () => {
  const browserWriteEntered = deferred();
  const finishBrowserWrite = deferred();
  const writes = [];
  const ws = memoryWorkspace(async (files, file, contents) => {
    const owner = contents.includes('"browser"') ? "browser" : "scan";
    writes.push(`${owner}:${file}`);
    if (owner === "browser" && file === "plangolin/system.json") {
      browserWriteEntered.resolve();
      await finishBrowserWrite.promise;
    }
    files.set(file, contents);
  });

  const browserSave = save(ws, persistedDoc("browser", 40));
  await browserWriteEntered.promise;
  const scanSave = saveIfEmpty(ws, persistedDoc("scan", 10));
  finishBrowserWrite.resolve();

  await browserSave;
  assert.equal(await scanSave, false);
  const { doc } = await load(ws);
  assert.deepEqual(doc.nodes.map((node) => node.id), ["browser"]);
  assert.deepEqual(doc.layout, { browser: { x: 40, y: 41 } });
  assert.deepEqual(writes, [
    "browser:plangolin/system.json",
    "browser:plangolin/layout.json",
  ]);
});

test("schema serialization never mixes system and layout across scan and browser saves", async () => {
  const scanSystemWritten = deferred();
  const finishScanSystem = deferred();
  const writes = [];
  const ws = memoryWorkspace(async (files, file, contents) => {
    const owner = contents.includes('"browser"') ? "browser" : "scan";
    writes.push(`${owner}:${file}`);
    files.set(file, contents);
    if (owner === "scan" && file === "plangolin/system.json") {
      scanSystemWritten.resolve();
      await finishScanSystem.promise;
    }
  });

  const scanSave = saveIfEmpty(ws, persistedDoc("scan", 10));
  await scanSystemWritten.promise;
  const browserSave = save(ws, persistedDoc("browser", 40));
  const reading = load(ws);
  finishScanSystem.resolve();

  assert.equal(await scanSave, true);
  await browserSave;
  const { doc } = await reading;
  assert.deepEqual(doc.nodes.map((node) => node.id), ["browser"]);
  assert.deepEqual(doc.layout, { browser: { x: 40, y: 41 } });
  assert.deepEqual(writes, [
    "scan:plangolin/system.json",
    "scan:plangolin/layout.json",
    "browser:plangolin/system.json",
    "browser:plangolin/layout.json",
  ]);
});
