import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, validate, validateEdges, stripImports, trim, commonFolder } from "../src/describe.js";

test("strips import lines from excerpts", () => {
  const text = `import { a } from "./b.js";\nfrom .x import y\nexport function go() {}\n`;
  assert.equal(stripImports(text).trim(), "export function go() {}");
});

test("prompt names each group, its files and its resolved dependencies", () => {
  const groups = [{ id: "g1", files: ["src/llm.js"], children: [] }];
  const deps = new Map([["g1", ["g2"]]]);
  const excerpts = new Map([["src/llm.js", "export function callModel() {}"]]);
  const prompt = buildPrompt(groups, deps, excerpts);
  assert.match(prompt, /g1/);
  assert.match(prompt, /src\/llm\.js/);
  assert.match(prompt, /depends on: g2/);
  assert.match(prompt, /callModel/);
});

test("validate keeps a well-formed block", () => {
  const { blocks, dropped } = validate([
    { groupId: "g1", id: "model-client", name: "Model client", kind: "OpenAI", intent: "Talks to the model.", details: "" },
  ], new Set(["g1"]));
  assert.equal(dropped.length, 0);
  assert.equal(blocks[0].id, "model-client");
});

test("validate drops an unknown group", () => {
  const { blocks, dropped } = validate([
    { groupId: "nope", id: "x", name: "X", kind: "", intent: "", details: "" },
  ], new Set(["g1"]));
  assert.equal(blocks.length, 0);
  assert.match(dropped[0], /unknown group/);
});

test("validate drops a bad slug and a duplicate", () => {
  const known = new Set(["g1", "g2"]);
  const { blocks, dropped } = validate([
    { groupId: "g1", id: "Not A Slug", name: "A", kind: "", intent: "", details: "" },
    { groupId: "g2", id: "ok", name: "B", kind: "", intent: "", details: "" },
    { groupId: "g2", id: "ok", name: "C", kind: "", intent: "", details: "" },
  ], known);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].id, "ok");
  assert.equal(dropped.length, 2);
});

// The cap came down from 400 to 200 once real cards were looked at: a
// 132-character intent already filled five lines and crowded out everything
// else on the block. 200 is still well above the 90 the prompt asks for, so
// it only catches a reply that ignored the instruction outright.
test("validate truncates overlong prose rather than dropping it", () => {
  const { blocks } = validate([
    { groupId: "g1", id: "a", name: "N", kind: "", intent: "x".repeat(900), details: "" },
  ], new Set(["g1"]));
  assert.equal(blocks[0].intent.length, 200);
});

test("validateEdges keeps a label for a pair that has code behind it", () => {
  const { labels, dropped } = validateEdges(
    [{ from: "g1", to: "g2", label: "reads / writes" }],
    new Set(["g1 g2"]),
  );
  assert.equal(dropped.length, 0);
  assert.equal(labels.get("g1 g2"), "reads / writes");
});

test("validateEdges refuses a label for a pair with no code behind it", () => {
  const { labels, dropped } = validateEdges(
    [{ from: "g1", to: "g9", label: "invented" }],
    new Set(["g1 g2"]),
  );
  assert.equal(labels.size, 0);
  assert.match(dropped[0], /no code behind it/);
});

test("validateEdges is direction-sensitive", () => {
  const { labels } = validateEdges(
    [{ from: "g2", to: "g1", label: "backwards" }],
    new Set(["g1 g2"]),
  );
  assert.equal(labels.size, 0);
});

test("validateEdges drops a duplicate and an empty label", () => {
  const { labels, dropped } = validateEdges([
    { from: "g1", to: "g2", label: "calls into" },
    { from: "g1", to: "g2", label: "again" },
    { from: "g3", to: "g4", label: "   " },
  ], new Set(["g1 g2", "g3 g4"]));
  assert.equal(labels.get("g1 g2"), "calls into");
  assert.equal(labels.has("g3 g4"), false);
  assert.equal(dropped.length, 2);
});

test("validateEdges truncates an overlong label", () => {
  const { labels } = validateEdges(
    [{ from: "g1", to: "g2", label: "x".repeat(80) }],
    new Set(["g1 g2"]),
  );
  assert.equal(labels.get("g1 g2").length, 40);
});

// Cards print `kind` on one line and cut it off mid-word if it runs over, so
// the stored value is trimmed at a word boundary. "Python backen" is worse
// than "Python", and an ellipsis stored in the data would be drawn twice.
test("trims at a word boundary, not mid-word", () => {
  assert.equal(trim("Python backend services", 14), "Python backend");
  assert.equal(trim("React components", 12), "React");
  assert.equal(trim("Python API", 40), "Python API");
  assert.equal(trim("", 40), "");
  assert.equal(trim(undefined, 40), "");
});

// A single word longer than the limit has no boundary to cut at, so it is cut
// where it must be rather than being emptied entirely.
test("cuts a single overlong word rather than dropping it", () => {
  assert.equal(trim("Supercalifragilistic", 10), "Supercalif");
});

// A container owns no files, so the folder its contents share is the only
// concrete thing it can be named from. Without it the namer produced
// "Backend Source Groups" for a group entirely inside backend/.
test("finds the folder a group's files share", () => {
  assert.equal(commonFolder(["backend/main.py", "backend/models.py"]), "backend/");
  assert.equal(commonFolder(["backend/api/a.py", "backend/api/b.py"]), "backend/api/");
  assert.equal(commonFolder(["backend/a.py", "frontend/b.jsx"]), "");
  assert.equal(commonFolder([]), "");
});

// Segment by segment, not character by character: src/api and src/apiary
// share src/, not src/api.
test("does not cut a folder name in half", () => {
  assert.equal(commonFolder(["src/api/a.js", "src/apiary/b.js"]), "src/");
});

test("a file at the repo root has no shared folder", () => {
  assert.equal(commonFolder(["index.js", "lib/b.js"]), "");
});

test("the prompt tells a container which folder it covers", () => {
  const groups = [{
    id: "g1", files: [], children: [
      { id: "g1.1", files: ["backend/main.py"], children: [] },
      { id: "g1.2", files: ["backend/worker.py"], children: [] },
    ],
  }];
  const p = buildPrompt(groups, new Map(), new Map());
  assert.match(p, /every file below it is under: backend\//);
});

test("a group that owns files is not given a folder line", () => {
  const groups = [{ id: "g1", files: ["backend/main.py"], children: [] }];
  const p = buildPrompt(groups, new Map(), new Map());
  assert.doesNotMatch(p, /every file below it is under/);
});
