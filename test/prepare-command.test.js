import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { preparationPaths } from "../src/preparation.js";
import {
  PREPARE_START_POLL_MS,
  PREPARE_START_TIMEOUT_MS,
  runPrepareCommand,
  runPrepareWorker,
} from "../src/prepare-command.js";

const execFile = promisify(execFileCallback);
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function temporaryProject(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "plangolin-prepare-command-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project");
  const cacheRoot = path.join(temp, "cache");
  await fs.mkdir(root);
  return { temp, root, cacheRoot };
}

function childProcessDouble() {
  const child = new EventEmitter();
  child.unrefs = 0;
  child.unref = () => { child.unrefs += 1; return child; };
  return child;
}

async function writeStartup(root, cacheRoot, {
  pid = process.pid,
  startedAt = Date.now() - 10,
  revision = 1,
} = {}) {
  const paths = preparationPaths(root, { cacheRoot });
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.lock, JSON.stringify({
    version: 1,
    rootHash: paths.rootHash,
    token: "worker-token",
    pid,
    startedAt,
    fingerprint: null,
  }));
  await fs.writeFile(paths.progress, JSON.stringify({
    phase: "starting", revision, elapsed: 0, counts: {},
  }));
}

test("prepare spawns the current CLI detached with an argv array and waits for revision 1", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const child = childProcessDouble();
  const calls = [];
  let startup;
  const spawn = (...args) => {
    calls.push(args);
    startup = writeStartup(root, cacheRoot);
    return child;
  };

  const result = await runPrepareCommand(root, {
    cacheRoot,
    cliPath: CLI_PATH,
    spawn,
    processAlive: () => true,
    sleep: async () => { await startup; },
    timeoutMs: 100,
  });

  assert.deepEqual(result, { code: 0, started: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [CLI_PATH, "__prepare-worker", root]);
  assert.deepEqual(calls[0][2], { detached: true, stdio: "ignore" });
  assert.equal(child.unrefs, 1);
});

test("an existing live worker returns success without spawning a duplicate", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  await writeStartup(root, cacheRoot);
  let spawns = 0;

  const result = await runPrepareCommand(root, {
    cacheRoot,
    processAlive: () => true,
    spawn: () => { spawns += 1; throw new Error("must not spawn"); },
  });

  assert.deepEqual(result, { code: 0, started: false });
  assert.equal(spawns, 0);
});

test("a detached spawn error is a startup failure, not a success message", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const child = childProcessDouble();
  let tick = 0;

  const resultPromise = runPrepareCommand(root, {
    cacheRoot,
    cliPath: CLI_PATH,
    spawn: () => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    },
    now: () => tick,
    sleep: async (milliseconds) => { tick += milliseconds; await Promise.resolve(); },
  });

  assert.deepEqual(await resultPromise, { code: 1, started: false });
});

test("a cache status read failure returns nonzero without spawning", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let spawns = 0;
  const io = {
    ...fs,
    async readFile() {
      const err = new Error("cache permission denied");
      err.code = "EACCES";
      throw err;
    },
  };

  const result = await runPrepareCommand(root, {
    cacheRoot,
    fs: io,
    spawn: () => { spawns += 1; return childProcessDouble(); },
  });

  assert.deepEqual(result, { code: 1, started: false });
  assert.equal(spawns, 0);
});

test("prepare gives startup at most two seconds to publish lock plus progress", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const child = childProcessDouble();
  let tick = 0;

  const result = await runPrepareCommand(root, {
    cacheRoot,
    cliPath: CLI_PATH,
    spawn: () => child,
    now: () => tick,
    sleep: async (milliseconds) => { tick += milliseconds; },
  });

  assert.equal(PREPARE_START_TIMEOUT_MS, 2_000);
  assert.ok(PREPARE_START_POLL_MS > 0);
  assert.equal(tick, PREPARE_START_TIMEOUT_MS);
  assert.deepEqual(result, { code: 1, started: false });
});

test("the hidden worker validates an absolute root before loading environment or working", async () => {
  let loads = 0;
  let runs = 0;

  await assert.rejects(runPrepareWorker("relative/project", {
    load: () => { loads += 1; },
    run: async () => { runs += 1; },
  }), /absolute/);

  assert.equal(loads, 0);
  assert.equal(runs, 0);
});

test("the real prepare CLI returns after startup while its hidden worker completes", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const { stdout, stderr } = await execFile(process.execPath, [CLI_PATH, "prepare"], {
    cwd: root,
    env: { ...process.env, PLANGOLIN_CACHE_DIR: cacheRoot },
    timeout: 5_000,
  });

  assert.equal(stdout, "Preparing this project's system map in the background.\n");
  assert.equal(stderr, "");

  // process.cwd() resolves macOS's /var -> /private/var symlink; address the
  // same physical workspace root the CLI passes to its worker.
  const paths = preparationPaths(await fs.realpath(root), { cacheRoot });
  let result;
  for (let i = 0; i < 200; i++) {
    result = await fs.readFile(paths.result, "utf8").then(JSON.parse, () => null);
    if (result) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(result?.version, 1);
  assert.deepEqual(result?.moves, []);
});
