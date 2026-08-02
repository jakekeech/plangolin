import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { nodeWorkspace } from "../src/workspace.js";

const exec = promisify(execFile);
let root, base, server, commit;

async function git(...args) {
  const { stdout } = await exec("git", ["-C", root, ...args]);
  return stdout.trim();
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plangolin-hunks-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "a.js"), "const state = 'old';\n");
  await git("init");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("add", ".");
  await git("commit", "-m", "Add state");
  await fs.writeFile(path.join(root, "src", "a.js"), "const state = 'committed';\n");
  await git("commit", "-am", "Change state");
  commit = await git("rev-parse", "HEAD");
  await fs.writeFile(path.join(root, "src", "a.js"), "const state = 'working';\n");

  server = createServer(nodeWorkspace(root));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test("GET /api/hunks matches a resolved commit rather than the working tree", async () => {
  const url = new URL("/api/hunks", base);
  url.searchParams.set("path", "src/a.js");
  url.searchParams.set("kind", "commit");
  url.searchParams.set("ref", commit);
  const res = await fetch(url);
  const out = await res.json();

  assert.equal(res.status, 200);
  assert.match(out.patch, /committed/);
  assert.doesNotMatch(out.patch, /working/);
});

test("GET /api/hunks keeps an empty patch as a successful answer", async () => {
  const url = new URL("/api/hunks", base);
  url.searchParams.set("path", "src/unchanged.js");
  url.searchParams.set("kind", "uncommitted");
  url.searchParams.set("ref", "HEAD");
  const res = await fetch(url);
  const out = await res.json();

  assert.equal(res.status, 200);
  assert.equal(out.patch, "");
  assert.match(out.reason, /no text hunks/i);
});

test("GET /api/hunks returns 400 when the path escapes the workspace", async () => {
  const url = new URL("/api/hunks", base);
  url.searchParams.set("path", "../secret.js");
  url.searchParams.set("kind", "uncommitted");
  url.searchParams.set("ref", "HEAD");
  const res = await fetch(url);
  const out = await res.json();

  assert.equal(res.status, 400);
  assert.match(out.error, /escapes the project folder/);
});
