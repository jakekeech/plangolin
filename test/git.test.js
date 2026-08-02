import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGit } from "../src/git.js";

/** Records the argument vectors it was called with and replays canned stdout. */
function fakeRun(replies) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    for (const [match, out] of Object.entries(replies)) {
      if (key.endsWith(match)) return out;
    }
    throw Object.assign(new Error("not a git repository"), { gitFailed: true });
  };
  run.calls = calls;
  return run;
}

test("changedFiles diffs against a ref and returns sorted unique paths", async () => {
  const run = fakeRun({ "-z HEAD": "src/b.js\0src/a.js\0src/b.js\0" });
  const git = makeGit("/proj", run);
  assert.deepEqual(await git.changedFiles("HEAD"), ["src/a.js", "src/b.js"]);
  assert.deepEqual(run.calls[0], [
    "-C", "/proj", "diff", "--name-only", "--relative", "-z", "HEAD",
  ]);
});

test("changedFiles appends the second ref when given one", async () => {
  const run = fakeRun({ "-z abc123 def456": "src/a.js\0" });
  const git = makeGit("/proj", run);
  assert.deepEqual(await git.changedFiles("abc123", "def456"), ["src/a.js"]);
  assert.equal(run.calls[0].at(-1), "def456");
});

test("an empty diff is an empty list, not a list containing an empty string", async () => {
  const git = makeGit("/proj", fakeRun({ "-z HEAD": "" }));
  assert.deepEqual(await git.changedFiles("HEAD"), []);
});

test("isRepo is false when git fails rather than throwing", async () => {
  const git = makeGit("/not-a-repo", fakeRun({}));
  assert.equal(await git.isRepo(), false);
});

test("isRepo is true when rev-parse succeeds", async () => {
  const git = makeGit("/proj", fakeRun({ "rev-parse --git-dir": ".git\n" }));
  assert.equal(await git.isRepo(), true);
});

test("commits parses the unit-separated record format", async () => {
  const run = fakeRun({
    "--format=%H%x1f%s%x1f%cr": "aaa\x1fWire up Stripe\x1f2 hours ago\nbbb\x1fMove sessions\x1f5 hours ago\n",
  });
  const git = makeGit("/proj", run);
  assert.deepEqual(await git.commits(2), [
    { hash: "aaa", subject: "Wire up Stripe", when: "2 hours ago" },
    { hash: "bbb", subject: "Move sessions", when: "5 hours ago" },
  ]);
  assert.ok(run.calls[0].includes("-n2"));
});

test("head trims the trailing newline", async () => {
  const git = makeGit("/proj", fakeRun({ "rev-parse HEAD": "deadbeef\n" }));
  assert.equal(await git.head(), "deadbeef");
});

test("untracked lists new files git isn't following yet, sorted and unique", async () => {
  const run = fakeRun({ "ls-files --others --exclude-standard -z": "src/b.js\0src/a.js\0" });
  const git = makeGit("/proj", run);
  assert.deepEqual(await git.untracked(), ["src/a.js", "src/b.js"]);
  assert.deepEqual(run.calls[0], [
    "-C", "/proj", "ls-files", "--others", "--exclude-standard", "-z",
  ]);
});

test("branches lists local branch names, current one first", async () => {
  // Real git output, byte for byte — an earlier version of this used %x1f,
  // which `git log` expands and `git branch` prints literally, and the fake
  // was happy to replay the format that never actually occurs.
  const run = fakeRun({
    "--format=%(HEAD)|%(refname:short)": "*|main\n |feature/diff\n |old\n",
  });
  const git = makeGit("/proj", run);
  assert.deepEqual(await git.branches(), [
    { name: "main", current: true },
    { name: "feature/diff", current: false },
    { name: "old", current: false },
  ]);
});

test("mergeBase finds where this branch left the trunk", async () => {
  const run = fakeRun({ "merge-base HEAD main": "abc123\n" });
  const git = makeGit("/proj", run);
  assert.equal(await git.mergeBase("main"), "abc123");
});

test("mergeBase is null when the trunk isn't there", async () => {
  assert.equal(await makeGit("/proj", fakeRun({})).mergeBase("main"), null);
});

test("upstream reports the branch this one tracks", async () => {
  const git = makeGit("/proj", fakeRun({ "--abbrev-ref @{upstream}": "origin/main\n" }));
  assert.equal(await git.upstream(), "origin/main");
});

test("upstream is null on a branch that tracks nothing", async () => {
  assert.equal(await makeGit("/proj", fakeRun({})).upstream(), null);
});
