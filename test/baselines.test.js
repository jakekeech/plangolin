import { test } from "node:test";
import assert from "node:assert/strict";
import { listBaselines } from "../src/baselines.js";

const NODES = [
  { id: "core", anchor: { dir: "src" } },
  { id: "app", anchor: { dir: "app" } },
];
const FILES = ["src/a.js", "src/b.js", "app/x.js"];

function fakeGit(changedBy = {}, isRepo = true) {
  return {
    async isRepo() { return isRepo; },
    async commits() {
      return [
        { hash: "aaa", subject: "Wire up Stripe", when: "2 hours ago" },
        { hash: "bbb", subject: "Reformat everything", when: "1 day ago" },
      ];
    },
    async branches() { return [{ name: "main", current: true }]; },
    async changedFiles(from, to) {
      // The real call is (hash^, hash) — what that commit did, not what has
      // happened since it.
      const key = to || from;
      if (changedBy[key] === "throw") throw new Error("bad revision");
      return changedBy[key] || [];
    },
  };
}

test("a project with no git offers nothing rather than failing", async () => {
  const got = await listBaselines(fakeGit({}, false), NODES, FILES);
  assert.deepEqual(got, { repo: false, commits: [], branches: [] });
});

test("each commit carries how many blocks it moved", async () => {
  const got = await listBaselines(
    fakeGit({ aaa: ["src/a.js", "app/x.js"], bbb: ["src/b.js"] }), NODES, FILES);
  assert.deepEqual(got.commits.map((c) => [c.subject, c.blocks]), [
    ["Wire up Stripe", 2],
    ["Reformat everything", 1],
  ]);
});

test("a commit that moved no architecture reports zero, not nothing", async () => {
  // The useful sentence: this commit exists and changed the shape of nothing.
  const got = await listBaselines(fakeGit({ aaa: ["README.md"], bbb: [] }), NODES, FILES);
  assert.equal(got.commits[0].blocks, 0);
  assert.equal(got.commits[1].blocks, 0);
});

test("a commit we cannot diff is still offered, with an unknown count", async () => {
  const got = await listBaselines(fakeGit({ aaa: "throw", bbb: ["src/a.js"] }), NODES, FILES);
  assert.equal(got.commits[0].blocks, null);
  assert.equal(got.commits[1].blocks, 1);
});

test("branches come through as given", async () => {
  const got = await listBaselines(fakeGit(), NODES, FILES);
  assert.deepEqual(got.branches, [{ name: "main", current: true }]);
});
