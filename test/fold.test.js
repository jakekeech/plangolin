import { test } from "node:test";
import assert from "node:assert/strict";
import { fold } from "../src/fold.js";

const leaf = (id, ...files) => ({ id, files, children: [] });
const L = (from, to) => ({ from, to });

// The rule: used by exactly one thing, so it is a detail of that thing.
test("folds blocks that serve exactly one master", () => {
  const groups = [
    leaf("api", "api.js"),
    leaf("mailer", "mail.js"),
    leaf("pdf", "pdf.js"),
  ];
  const out = fold(groups, [L("api.js", "mail.js"), L("api.js", "pdf.js")]);
  assert.equal(out.length, 1, "mailer and pdf fold into api");
  assert.equal(out[0].id, "api");
  assert.deepEqual(out[0].children.map((c) => c.files[0]).sort(), ["mail.js", "pdf.js"]);
});

// Two things use it, so hiding it inside either one would be a lie.
test("leaves a shared block alone", () => {
  const groups = [leaf("a", "a.js"), leaf("b", "b.js"), leaf("shared", "s.js")];
  const out = fold(groups, [L("a.js", "s.js"), L("b.js", "s.js")]);
  assert.equal(out.length, 3);
});

// Folding one block into another hides a name and adds a box. No gain.
test("does not fold a lone child", () => {
  const groups = [leaf("api", "api.js"), leaf("mailer", "mail.js")];
  const out = fold(groups, [L("api.js", "mail.js")]);
  assert.equal(out.length, 2);
});

// A block that only reaches out to one other is a consumer, not a detail of
// it. Folding the entry point into the thing it calls hides the way in.
test("does not fold a block into something it merely calls", () => {
  const groups = [leaf("cli", "cli.js"), leaf("engine", "engine.js"), leaf("other", "other.js")];
  const out = fold(groups, [L("cli.js", "engine.js"), L("other.js", "engine.js")]);
  const ids = out.map((g) => g.id).sort();
  assert.deepEqual(ids, ["cli", "engine", "other"], "callers stay put");
});

// Folding must never move a block across a region, or a frontend block would
// end up inside a backend one and the network call between them would vanish.
test("never folds across regions", () => {
  const groups = [
    { id: "back", files: [], children: [leaf("back.api", "backend/api.py")] },
    { id: "front", files: [], children: [leaf("front.ui", "frontend/ui.jsx"), leaf("front.lib", "frontend/lib.js")] },
  ];
  const out = fold(groups, [
    L("frontend/ui.jsx", "backend/api.py"),
    L("frontend/lib.js", "backend/api.py"),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].children.length, 1, "backend keeps its one child");
  assert.equal(out[1].children.length, 2, "frontend keeps both, nothing moved across");
});

test("folds inside a region, leaving the region intact", () => {
  const groups = [
    { id: "back", files: [], children: [
      leaf("back.api", "backend/api.py"),
      leaf("back.mail", "backend/mail.py"),
      leaf("back.pdf", "backend/pdf.py"),
    ] },
  ];
  const out = fold(groups, [
    L("backend/api.py", "backend/mail.py"),
    L("backend/api.py", "backend/pdf.py"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].children.length, 1, "api absorbs the other two");
  assert.equal(out[0].children[0].children.length, 2);
});

test("an island with no connections is left where it is", () => {
  const groups = [leaf("a", "a.js"), leaf("b", "b.js")];
  assert.equal(fold(groups, []).length, 2);
});
