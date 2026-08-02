import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSpecifiers, extractImports, resolveSpecifier, jsLinks } from "../src/imports/javascript.js";

test("extracts every import form", () => {
  const text = `
    import { a } from "./llm.js";
    import def from '../schema';
    import * as ns from "./ns.js";
    import "./side-effect.js";
    export { b } from "./sync.js";
    export * from "./all.js";
    const x = require("./legacy.js");
    const y = await import("./dyn.js");
  `;
  assert.deepEqual(extractSpecifiers(text).sort(), [
    "../schema", "./all.js", "./dyn.js", "./legacy.js",
    "./llm.js", "./ns.js", "./side-effect.js", "./sync.js",
  ]);
});

test("ignores bare specifiers", () => {
  const text = `import fs from "node:fs"; import express from "express";`;
  assert.deepEqual(extractSpecifiers(text), ["node:fs", "express"]);
});

test("resolves an exact relative path", () => {
  const files = new Set(["src/llm.js", "src/adopt.js"]);
  assert.equal(resolveSpecifier("./llm.js", "src/adopt.js", files), "src/llm.js");
});

test("guesses the extension", () => {
  const files = new Set(["src/schema.js", "src/adopt.js"]);
  assert.equal(resolveSpecifier("./schema", "src/adopt.js", files), "src/schema.js");
});

test("falls back to an index file", () => {
  const files = new Set(["src/routes/index.js", "src/server.js"]);
  assert.equal(resolveSpecifier("./routes", "src/server.js", files), "src/routes/index.js");
});

test("climbs out of a directory", () => {
  const files = new Set(["src/schema.js", "src/api/handlers.js"]);
  assert.equal(resolveSpecifier("../schema", "src/api/handlers.js", files), "src/schema.js");
});

test("returns null for anything external or unresolvable", () => {
  const files = new Set(["src/llm.js"]);
  assert.equal(resolveSpecifier("express", "src/llm.js", files), null);
  assert.equal(resolveSpecifier("node:fs", "src/llm.js", files), null);
  assert.equal(resolveSpecifier("./nope.js", "src/llm.js", files), null);
});

test("jsLinks returns resolved internal targets only", () => {
  const index = { paths: new Set(["src/llm.js", "src/adopt.js"]) };
  const text = `import { callModel } from "./llm.js";\nimport fs from "node:fs";`;
  assert.deepEqual(jsLinks("src/adopt.js", text, index), [
    { target: "src/llm.js", kind: "import", names: ["callModel"] },
  ]);
});

test("never links a file to itself", () => {
  const index = { paths: new Set(["src/a.js"]) };
  assert.deepEqual(jsLinks("src/a.js", `import "./a.js";`, index), []);
});

test("captures the names taken from each import", () => {
  const text = `
    import { verifyToken, generateAuthTokens } from "./token.service.js";
    import { pick as choose } from "./utils.js";
    import type { User } from "./types.js";
  `;
  const byspec = Object.fromEntries(extractImports(text).map((i) => [i.spec, i.names]));
  assert.deepEqual(byspec["./token.service.js"], ["generateAuthTokens", "verifyToken"]);
  assert.deepEqual(byspec["./utils.js"], ["pick"], "keeps the exported name, not the local alias");
  assert.deepEqual(byspec["./types.js"], ["User"]);
});

test("a single binding is named; a namespace import is not", () => {
  const byspec = Object.fromEntries(extractImports(`
    import app from "./app.js";
    import * as ns from "./ns.js";
    import "./side.js";
    const legacy = require("./legacy.js");
  `).map((i) => [i.spec, i.names]));
  assert.deepEqual(byspec["./app.js"], ["app"], "a default import names the one thing it takes");
  assert.deepEqual(byspec["./legacy.js"], ["legacy"], "so does a whole-module require");
  assert.deepEqual(byspec["./ns.js"], [], "but a namespace alias is the importer\u2019s own label");
  assert.deepEqual(byspec["./side.js"], [], "and a side-effect import takes nothing");
});

test("export-from also names what it re-exports", () => {
  assert.deepEqual(extractImports(`export { authService } from "./auth.js";`)[0].names, ["authService"]);
});

test("two specifiers resolving to one file merge their names", () => {
  const index = { paths: new Set(["src/x.js", "src/a.js"]) };
  const text = `import { one } from "./x.js";\nimport { two } from "./x";`;
  const links = jsLinks("src/a.js", text, index);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].names, ["one", "two"]);
});

test("captures names from CommonJS destructuring", () => {
  const text = `
    const { tokenTypes } = require('../config/tokens');
    const { authService, userService } = require('./services');
    const httpStatus = require('http-status');
  `;
  const byspec = Object.fromEntries(extractImports(text).map((i) => [i.spec, i.names]));
  assert.deepEqual(byspec["../config/tokens"], ["tokenTypes"]);
  assert.deepEqual(byspec["./services"], ["authService", "userService"]);
  assert.deepEqual(byspec["http-status"], ["httpStatus"]);
});
