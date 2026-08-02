import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBaseline, DEFAULT_BASELINE } from "../src/baseline.js";

/** Stands in for the object makeGit() returns. */
function fakeGit(over = {}) {
  const asked = [];
  return {
    asked,
    async isRepo() { return over.isRepo !== false; },
    async untracked() { return over.untracked || []; },
    async head() { return over.head || "headsha"; },
    async upstream() { return over.upstream || null; },
    async mergeBase(trunk) { return (over.bases || {})[trunk] || null; },
    async changedFiles(from, to = null) {
      asked.push([from, to]);
      if (over.throwOn && from === over.throwOn) throw new Error("bad revision");
      return over.files || [];
    },
  };
}

test("a project that is not a repo resolves to null", async () => {
  assert.equal(await resolveBaseline(fakeGit({ isRepo: false }), DEFAULT_BASELINE), null);
});

test("the default is the work in flight on this branch", async () => {
  const git = fakeGit({ bases: { main: "forkpoint" }, files: ["src/a.js"] });
  const got = await resolveBaseline(git);
  assert.equal(got.kind, "branch");
  assert.equal(got.ref, "forkpoint");
  assert.equal(got.against, "main");
  assert.deepEqual(git.asked[0], ["forkpoint", null]);
});

test("a repo whose trunk is called master is found too", async () => {
  const got = await resolveBaseline(fakeGit({ bases: { master: "fp" } }), { kind: "branch" });
  assert.equal(got.against, "master");
});

test("on the trunk itself, the branch state becomes what hasn't been pushed", async () => {
  // merge-base with main IS head — we are on main — so the question becomes
  // "what has not left this machine", which the upstream answers.
  const git = fakeGit({
    head: "headsha", bases: { main: "headsha", "origin/main": "pushed" },
    upstream: "origin/main", files: ["src/a.js"],
  });
  const got = await resolveBaseline(git, { kind: "branch" });
  assert.equal(got.ref, "pushed");
  assert.equal(got.against, "origin/main");
});

test("on the trunk with nothing to push, it falls back and says so", async () => {
  const git = fakeGit({ head: "headsha", bases: { main: "headsha" }, files: ["src/a.js"] });
  const got = await resolveBaseline(git, { kind: "branch" });
  assert.equal(got.kind, "uncommitted");
  assert.equal(got.fellBack, true);
});

test("uncommitted is the working tree against HEAD", async () => {
  const git = fakeGit({ files: ["src/a.js"], untracked: ["src/new.js"] });
  const got = await resolveBaseline(git, { kind: "uncommitted" });
  assert.deepEqual(git.asked[0], ["HEAD", null]);
  assert.deepEqual([...got.files].sort(), ["src/a.js", "src/new.js"]);
});

test("a commit means THAT COMMIT'S change, not everything since it", async () => {
  // The convention everywhere else, and the thing the count in the picker
  // already claims. Diffing against the working tree instead made the list a
  // liar: a row saying "3 blocks" opened onto fifteen.
  const git = fakeGit({ files: ["src/a.js"] });
  const got = await resolveBaseline(git, { kind: "commit", ref: "abc123" });
  assert.deepEqual(git.asked[0], ["abc123^", "abc123"]);
  assert.equal(got.ref, "abc123");
});

test("the very first commit has no parent and is compared with nothing", async () => {
  const git = fakeGit({ throwOn: "root^", files: ["src/a.js"] });
  const got = await resolveBaseline(git, { kind: "commit", ref: "root" });
  assert.equal(got.rootCommit, true);
  assert.deepEqual([...got.files], ["src/a.js"]);
});

test("a commit with no ref resolves to null rather than guessing", async () => {
  assert.equal(await resolveBaseline(fakeGit(), { kind: "commit" }), null);
});

test("an unrecognised kind resolves to null", async () => {
  assert.equal(await resolveBaseline(fakeGit(), { kind: "since-i-last-looked" }), null);
});

test("untracked files count in every working-tree state", async () => {
  // An agent writes a file and never stages it; git diff will not mention it.
  const git = fakeGit({ bases: { main: "fp" }, files: ["src/old.js"], untracked: ["src/new.js"] });
  const got = await resolveBaseline(git, { kind: "branch" });
  assert.deepEqual([...got.files].sort(), ["src/new.js", "src/old.js"]);
});
