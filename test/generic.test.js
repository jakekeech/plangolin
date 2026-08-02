import { test } from "node:test";
import assert from "node:assert/strict";
import { familyOf, STOPLIST } from "../src/imports/stoplist.js";
import { genericLinks } from "../src/imports/generic.js";

const index = (pairs) => ({ byName: new Map(pairs) });

test("groups extensions into language families", () => {
  assert.equal(familyOf("a.py"), "python");
  assert.equal(familyOf("a.ts"), "js");
  assert.equal(familyOf("a.jsx"), "js");
  assert.equal(familyOf("a.go"), "go");
  assert.equal(familyOf("a.ex"), "");     // unknown family
});

test("finds a referenced file name", () => {
  const i = index([["workspace", ["lib/workspace.ex"]]]);
  const text = `defmodule App do\n  alias App.Workspace\nend`;
  assert.deepEqual(genericLinks("lib/app.ex", text, i), [
    { target: "lib/workspace.ex", kind: "name" },
  ]);
});

test("refuses generic names", () => {
  assert.ok(STOPLIST.has("utils"));
  const i = index([["utils", ["lib/utils.ex"]]]);
  assert.deepEqual(genericLinks("lib/app.ex", "call Utils.thing()", i), []);
});

test("refuses short names", () => {
  const i = index([["db", ["lib/db.ex"]]]);
  assert.deepEqual(genericLinks("lib/app.ex", "DB.query()", i), []);
});

test("never matches across language families", () => {
  const i = index([["mailer", ["cmd/mailer.go"]]]);
  assert.deepEqual(genericLinks("app/views.py", "start the mailer now", i), []);
});

test("matches when neither file has a known family", () => {
  const i = index([["workspace", ["lib/workspace.ex"]]]);
  assert.deepEqual(genericLinks("lib/app.ex", "Workspace", i), [
    { target: "lib/workspace.ex", kind: "name" },
  ]);
});

test("never links a file to itself", () => {
  const i = index([["app", ["lib/app.ex"]]]);
  assert.deepEqual(genericLinks("lib/app.ex", "App.run()", i), []);
});

test("links to every file sharing an ambiguous name", () => {
  const i = index([["dispatch", ["lib/a/dispatch.ex", "lib/b/dispatch.ex"]]]);
  assert.deepEqual(genericLinks("lib/app.ex", "Dispatch", i).map((l) => l.target), [
    "lib/a/dispatch.ex", "lib/b/dispatch.ex",
  ]);
});
