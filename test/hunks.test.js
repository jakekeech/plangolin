import { test } from "node:test";
import assert from "node:assert/strict";
import { readHunks } from "../src/hunks.js";

function fakeGit(result = { patch: "@@ -1 +1 @@\n-old\n+new", truncated: false }) {
  const calls = [];
  return {
    calls,
    async patch(...args) { calls.push(args); return result; },
  };
}

const ws = {
  root: "/project",
  abs(path) {
    if (path.startsWith("../")) throw Object.assign(new Error("path escapes the project folder"), { escaped: true });
    return "/project/" + path;
  },
};

test("branch hunks compare the resolved ref with the working tree", async () => {
  const git = fakeGit();
  await readHunks(ws, "src/a.js", { kind: "branch", ref: "forkpoint", against: "main" }, git);
  assert.deepEqual(git.calls[0], ["forkpoint", "src/a.js", { human: true }]);
});

test("uncommitted hunks compare HEAD with the working tree", async () => {
  const git = fakeGit();
  await readHunks(ws, "src/a.js", { kind: "uncommitted", ref: "HEAD" }, git);
  assert.deepEqual(git.calls[0], ["HEAD", "src/a.js", { human: true }]);
});

test("commit hunks show only that commit", async () => {
  const git = fakeGit();
  await readHunks(ws, "src/a.js", { kind: "commit", ref: "abc123" }, git);
  assert.deepEqual(git.calls[0], ["abc123^", "src/a.js", { human: true, to: "abc123" }]);
});

test("root commit hunks preserve the resolved baseline fallback", async () => {
  const git = fakeGit();
  await readHunks(ws, "src/a.js", { kind: "commit", ref: "root", rootCommit: true }, git);
  assert.deepEqual(git.calls[0], ["root", "src/a.js", { human: true }]);
});

test("an empty patch is returned with a readable reason", async () => {
  const out = await readHunks(ws, "src/a.js", { kind: "uncommitted", ref: "HEAD" }, fakeGit({
    patch: "", truncated: false,
  }));
  assert.deepEqual(out, {
    patch: "", truncated: false,
    reason: "There are no text hunks for this file.",
  });
});

test("path validation stays at the workspace boundary", async () => {
  await assert.rejects(
    readHunks(ws, "../secret.js", { kind: "uncommitted", ref: "HEAD" }, fakeGit()),
    (err) => err.escaped === true,
  );
});
