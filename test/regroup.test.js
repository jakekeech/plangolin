import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, shape, buildPrompt } from "../src/regroup.js";

const FILES = ["a.js", "b.js", "c.js", "d.js"];
const STRUCTURAL = [
  { id: "g1", files: ["a.js", "b.js"], children: [] },
  { id: "g2", files: ["c.js", "d.js"], children: [] },
];

test("keeps a clean grouping as it came", () => {
  const out = validate(
    [{ why: "the front", files: ["a.js", "b.js"] }, { why: "the back", files: ["c.js", "d.js"] }],
    FILES, STRUCTURAL);
  assert.deepEqual(out.groups.map((g) => g.files), [["a.js", "b.js"], ["c.js", "d.js"]]);
  assert.deepEqual(out.dropped, []);
});

test("refuses a path that is not in the project", () => {
  const out = validate(
    [{ why: "x", files: ["a.js", "invented.js", "b.js"] }, { why: "y", files: ["c.js", "d.js"] }],
    FILES, STRUCTURAL);
  assert.deepEqual(out.groups[0].files, ["a.js", "b.js"]);
  assert.match(out.dropped[0], /not a file in this project/);
});

test("a file placed twice stays in the first group", () => {
  const out = validate(
    [{ why: "x", files: ["a.js", "b.js"] }, { why: "y", files: ["b.js", "c.js", "d.js"] }],
    FILES, STRUCTURAL);
  assert.deepEqual(out.groups[0].files, ["a.js", "b.js"]);
  assert.deepEqual(out.groups[1].files, ["c.js", "d.js"]);
  assert.match(out.dropped[0], /placed twice/);
});

// A file missing from the diagram is a file the reader never learns about.
// It gets put back rather than dropped — beside the files the clustering had
// it with, not in a bin of leftovers.
test("restores a file the model forgot, next to its structural neighbours", () => {
  const out = validate(
    [{ why: "front", files: ["a.js"] }, { why: "back", files: ["c.js", "d.js"] }],
    FILES, STRUCTURAL);
  const all = out.groups.flatMap((g) => g.files).sort();
  assert.deepEqual(all, FILES, "every file must survive");
  const front = out.groups.find((g) => g.files.includes("a.js"));
  assert.ok(front.files.includes("b.js"), "b.js was grouped with a.js, so it goes back there");
  assert.match(out.dropped.join(" "), /restored from the structural grouping/);
});

test("gives up when nothing usable came back", () => {
  assert.equal(validate([], FILES, STRUCTURAL), null);
  assert.equal(validate(null, FILES, STRUCTURAL), null);
  assert.equal(validate([{ why: "x", files: ["nope.js"] }], FILES, STRUCTURAL), null);
});

test("shapes groups into unique ids the pipeline can key on", () => {
  const out = shape([{ why: "a", files: ["a.js"] }, { why: "b", files: ["b.js"] }]);
  assert.deepEqual(out.map((g) => g.id), ["g1", "g2"]);
  assert.deepEqual(new Set(out.map((g) => g.id)).size, 2);
  assert.ok(out.every((g) => Array.isArray(g.children)));
});

test("the prompt carries the files, the imports and the structural hint", () => {
  const p = buildPrompt(FILES, [{ from: "a.js", to: "b.js" }], STRUCTURAL, new Map([["a.js", "code"]]));
  assert.match(p, /FILES \(4\)/);
  assert.match(p, /a\.js -> b\.js/);
  assert.match(p, /STRUCTURAL GROUPING/);
  assert.match(p, /a\.js, b\.js/);
});

// The regression this fixes: switching to model grouping made every sheet
// flat, so a repo laid out as backend/ and frontend/ lost the two blocks it
// is really made of.
test("wraps groups in a container per top-level folder", () => {
  const out = shape([
    { why: "api", files: ["backend/main.py", "backend/models.py"] },
    { why: "worker", files: ["backend/worker.py"] },
    { why: "ui", files: ["frontend/App.jsx"] },
    { why: "components", files: ["frontend/Card.jsx"] },
  ]);
  assert.equal(out.length, 2, "one container per folder");
  assert.deepEqual(out.map((g) => g.children.length), [2, 2]);
  assert.deepEqual(out.map((g) => g.id), ["g1", "g2"]);
  assert.deepEqual(out[0].children.map((c) => c.id), ["g1.1", "g1.2"]);
  assert.ok(out.every((g) => g.files.length === 0), "a container owns no files");
});

// A group spanning two folders is the model saying "this is one feature,
// front to back" — a better observation than the folder layout, so it wins.
test("stays flat when a group spans folders", () => {
  const out = shape([
    { why: "the copilot, front to back", files: ["backend/apply.py", "frontend/Copilot.jsx"] },
    { why: "the rest", files: ["backend/main.py"] },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((g) => g.children.length === 0));
});

test("stays flat when everything is in one folder", () => {
  const out = shape([
    { why: "a", files: ["src/a.js"] },
    { why: "b", files: ["src/b.js"] },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((g) => g.children.length === 0));
});

test("stays flat when a file sits at the repo root", () => {
  const out = shape([
    { why: "a", files: ["index.js"] },
    { why: "b", files: ["lib/b.js"] },
  ]);
  assert.ok(out.every((g) => g.children.length === 0));
});

// One child in a folder is the same box with another border round it.
test("does not wrap a folder holding a single group", () => {
  const out = shape([
    { why: "api", files: ["backend/main.py"] },
    { why: "ui", files: ["frontend/App.jsx"] },
    { why: "more ui", files: ["frontend/Card.jsx"] },
  ]);
  const backend = out.find((g) => g.files.some((f) => f.startsWith("backend")));
  assert.equal(backend.children.length, 0, "single-group folder stays a plain block");
  assert.deepEqual(backend.files, ["backend/main.py"]);
});

const L = (from, to) => ({ from, to });

// Option A: a box is either frontend or backend, never both. Enforced here
// rather than trusted to the prompt, because a single Python file inside a
// mostly-React group makes the group's label untrue and turns an ordinary
// server-to-server import into a line that appears to cross to the browser.
test("splits a group that mixes folders, and rehomes the fragment", () => {
  const files = [
    "backend/main.py", "backend/parser.py",
    "frontend/Upload.jsx", "frontend/Form.jsx",
  ];
  const structural = [{ id: "g1", files, children: [] }];
  const links = [L("backend/main.py", "backend/parser.py")];

  const out = validate(
    [{ why: "the resume feature, front to back",
       files: ["frontend/Upload.jsx", "frontend/Form.jsx", "backend/parser.py"] },
     { why: "the api", files: ["backend/main.py"] }],
    files, structural, links);

  for (const g of out.groups) {
    const folders = new Set(g.files.map((f) => f.split("/")[0]));
    assert.equal(folders.size, 1, `group mixes folders: ${g.files.join(", ")}`);
  }
  // parser.py talks to main.py, so it lands there rather than standing alone.
  const api = out.groups.find((g) => g.files.includes("backend/main.py"));
  assert.deepEqual(api.files, ["backend/main.py", "backend/parser.py"]);
  assert.match(out.dropped.join(" "), /split along folders/);
});

test("a fragment with nothing to join stands on its own", () => {
  const files = ["backend/lonely.py", "frontend/a.jsx", "frontend/b.jsx"];
  const structural = [{ id: "g1", files, children: [] }];
  const out = validate(
    [{ why: "everything", files }], files, structural, []);
  const solo = out.groups.find((g) => g.files.includes("backend/lonely.py"));
  assert.deepEqual(solo.files, ["backend/lonely.py"]);
});

// With every group now inside one folder, the containers always apply.
test("folder-pure groups get their containers back", () => {
  const out = shape([
    { why: "api", files: ["backend/main.py"] },
    { why: "worker", files: ["backend/worker.py"] },
    { why: "ui", files: ["frontend/App.jsx"] },
    { why: "cards", files: ["frontend/Card.jsx"] },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((g) => g.children.length), [2, 2]);
});
