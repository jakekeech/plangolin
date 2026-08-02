import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, linksFrom } from "../src/imports/index.js";

test("indexes paths and extensionless lowercased basenames", () => {
  const i = buildIndex(["src/LLM.js", "src/a/dispatch.go", "src/b/dispatch.go"], null);
  assert.ok(i.paths.has("src/LLM.js"));
  assert.deepEqual(i.byName.get("llm"), ["src/LLM.js"]);
  assert.deepEqual(i.byName.get("dispatch"), ["src/a/dispatch.go", "src/b/dispatch.go"]);
});

test("reads the go module when go.mod is supplied", () => {
  assert.equal(buildIndex([], "module example.com/x\n").goModule, "example.com/x");
  assert.equal(buildIndex([], null).goModule, null);
});

test("dispatches JS files to the precise reader", () => {
  const i = buildIndex(["src/llm.js", "src/adopt.js"], null);
  assert.deepEqual(linksFrom("src/adopt.js", `import x from "./llm.js";`, i), [
    { target: "src/llm.js", kind: "import", names: ["x"] },
  ]);
});

test("dispatches Python files to the precise reader", () => {
  const i = buildIndex(["app/schema.py", "app/views.py"], null);
  assert.deepEqual(linksFrom("app/views.py", "from .schema import load", i), [
    { target: "app/schema.py", kind: "import" },
  ]);
});

test("dispatches an unknown extension to the generic reader", () => {
  const i = buildIndex(["lib/workspace.ex", "lib/app.ex"], null);
  assert.deepEqual(linksFrom("lib/app.ex", "alias App.Workspace", i), [
    { target: "lib/workspace.ex", kind: "name" },
  ]);
});

test("a reader that throws costs that file its links, not the run", () => {
  const i = buildIndex(["src/a.js"], null);
  assert.deepEqual(linksFrom("src/a.js", null, i), []);
});
