import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeWorkspace } from "../src/workspace.js";

test("abs resolves a project path through the shared containment check", () => {
  assert.equal(nodeWorkspace("/project").abs("src/a.js"), "/project/src/a.js");
});

test("abs rejects a path that escapes the project", () => {
  assert.throws(() => nodeWorkspace("/project").abs("../secret.js"), (err) => err.escaped === true);
});
