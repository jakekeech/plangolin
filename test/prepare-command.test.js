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
  LAUNCHER_RESERVATION_MS,
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
  child.pid = 987_654;
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
  const generation = 1;
  const owner = "11111111-1111-4111-8111-111111111111";
  const g = String(generation).padStart(12, "0");
  await fs.mkdir(paths.dir, { recursive: true });
  const lease = path.join(paths.dir, `lease-${g}.claim`);
  await fs.mkdir(lease);
  await fs.mkdir(path.join(lease, `${owner}-${pid}-${startedAt}.owner`));
  await fs.mkdir(path.join(paths.dir, `heartbeat-${g}-${owner}-000000000001-${startedAt}.beat`));
  await fs.writeFile(path.join(paths.dir, `progress-${g}-${owner}.json`), JSON.stringify({
    owner, generation, phase: "starting", revision, elapsed: 0,
    updatedAt: startedAt, counts: {},
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

test("concurrent public commands share one atomic launcher reservation and spawn once", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const children = [];
  const paths = preparationPaths(root, { cacheRoot });
  let startup;
  const spawn = () => {
    const child = childProcessDouble();
    children.push(child);
    startup = writeStartup(root, cacheRoot, { startedAt: 1_000 });
    return child;
  };
  let tick = 1_000;
  let initialReads = 0;
  let releaseInitialReads;
  const bothInitialReads = new Promise((resolve) => { releaseInitialReads = resolve; });
  const io = {
    ...fs,
    async readdir(dir, ...args) {
      if (dir === paths.dir && initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
      }
      return fs.readdir(dir, ...args);
    },
  };
  const options = {
    cacheRoot,
    fs: io,
    cliPath: CLI_PATH,
    spawn,
    now: () => tick,
    processAlive: () => true,
    sleep: async (milliseconds) => {
      tick += milliseconds;
      if (startup) await startup;
      await Promise.resolve();
    },
    timeoutMs: 100,
  };

  const [first, second] = await Promise.all([
    runPrepareCommand(root, options),
    runPrepareCommand(root, options),
  ]);

  assert.ok(LAUNCHER_RESERVATION_MS > PREPARE_START_TIMEOUT_MS);
  assert.equal(initialReads, 2, "both commands observed no worker before launcher election");
  assert.equal(children.length, 1);
  assert.ok([first.code, second.code].includes(0));
  assert.ok([first.code, second.code].every((code) => code === 0 || code === 1));
});

test("a partially published reservation cannot let generations one and two both spawn", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });
  let signalSlot;
  const slotCreated = new Promise((resolve) => { signalSlot = resolve; });
  let releaseSlot;
  const slotGate = new Promise((resolve) => { releaseSlot = resolve; });
  let signalFollower;
  const followerSawSlot = new Promise((resolve) => { signalFollower = resolve; });
  let slotBlocked = true;
  const io = {
    ...fs,
    async mkdir(dir, ...args) {
      const result = await fs.mkdir(dir, ...args);
      if (path.basename(dir) === "launcher-000000000001.claim" && slotBlocked) {
        signalSlot();
        await slotGate;
        slotBlocked = false;
      }
      return result;
    },
    async readdir(dir, ...args) {
      const result = await fs.readdir(dir, ...args);
      if (dir === path.join(paths.dir, "launcher-000000000001.claim") && slotBlocked) signalFollower();
      return result;
    },
  };
  let spawns = 0;
  const spawn = () => {
    spawns += 1;
    return childProcessDouble();
  };
  const options = {
    cacheRoot, fs: io, cliPath: CLI_PATH, spawn,
    pollMs: 1, timeoutMs: 40,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };

  const first = runPrepareCommand(root, options);
  await slotCreated;
  const second = runPrepareCommand(root, options);
  await followerSawSlot;
  assert.equal(spawns, 0);
  releaseSlot();
  const results = await Promise.all([first, second]);

  assert.equal(spawns, 1);
  assert.deepEqual(
    (await fs.readdir(paths.dir)).filter((name) => name.startsWith("launcher-")),
    ["launcher-000000000001.claim"],
  );
  assert.ok(results.every((result) => result.code === 1));
});

test("a live launcher cannot be replaced across expiry at the spawn boundary", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let tick = 1_000;
  let spawns = 0;
  let follower;
  const options = {
    cacheRoot,
    cliPath: CLI_PATH,
    now: () => tick,
    processAlive: () => true,
    pollMs: 1,
    timeoutMs: 5,
    sleep: async (milliseconds) => { tick += milliseconds; await Promise.resolve(); },
    spawn: () => {
      spawns += 1;
      if (spawns === 1) {
        tick += LAUNCHER_RESERVATION_MS + 1;
        follower = runPrepareCommand(root, options);
      }
      return childProcessDouble();
    },
  };

  const first = await runPrepareCommand(root, options);
  const second = await follower;

  assert.equal(spawns, 1);
  assert.equal(first.code, 1);
  assert.equal(second.code, 1);
});

test("a slow live child keeps followers from spawning after the launcher TTL", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let tick = 1_000;
  const launcherPid = 123_456;
  const childPid = 234_567;
  const alive = new Set([launcherPid, childPid]);
  let spawns = 0;
  const options = {
    cacheRoot,
    cliPath: CLI_PATH,
    pid: launcherPid,
    now: () => tick,
    processAlive: (pid) => alive.has(pid),
    pollMs: 1,
    timeoutMs: 5,
    sleep: async (milliseconds) => { tick += milliseconds; },
    spawn: () => {
      spawns += 1;
      const child = childProcessDouble();
      child.pid = childPid;
      return child;
    },
  };

  assert.equal((await runPrepareCommand(root, options)).code, 1);
  alive.delete(launcherPid);
  tick += LAUNCHER_RESERVATION_MS + 1;
  assert.equal((await runPrepareCommand(root, options)).code, 1);
  assert.equal(spawns, 1);
});

test("a failed handed-off child lets a later caller launch a replacement", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let tick = 1_000;
  const launcherPid = 345_678;
  const childPid = 456_789;
  const alive = new Set([launcherPid, childPid]);
  let spawns = 0;
  const options = {
    cacheRoot,
    cliPath: CLI_PATH,
    pid: launcherPid,
    now: () => tick,
    processAlive: (pid) => alive.has(pid),
    pollMs: 1,
    timeoutMs: 5,
    sleep: async (milliseconds) => { tick += milliseconds; },
    spawn: () => {
      spawns += 1;
      const child = childProcessDouble();
      child.pid = childPid + spawns - 1;
      alive.add(child.pid);
      return child;
    },
  };

  assert.equal((await runPrepareCommand(root, options)).code, 1);
  alive.delete(childPid);
  assert.equal((await runPrepareCommand(root, options)).code, 1);
  assert.equal(spawns, 2);
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
    async readdir() {
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
    const resultName = await fs.readdir(paths.dir).then(
      (names) => names.find((name) => name.startsWith("result-")),
      () => null,
    );
    result = resultName
      ? await fs.readFile(path.join(paths.dir, resultName), "utf8").then(JSON.parse, () => null)
      : null;
    if (result) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(result?.version, 1);
  assert.deepEqual(result?.moves, []);
  for (let i = 0; i < 200; i++) {
    const names = await fs.readdir(paths.dir);
    if (names.some((name) => name.startsWith("complete-"))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(
    (await fs.readdir(paths.dir)).filter((name) => name.startsWith("complete-")).length,
    1,
  );

  const repeated = await execFile(process.execPath, [CLI_PATH, "prepare"], {
    cwd: root,
    env: { ...process.env, PLANGOLIN_CACHE_DIR: cacheRoot },
    timeout: 5_000,
  });
  assert.equal(repeated.stdout, "Preparing this project's system map in the background.\n");
  assert.equal(repeated.stderr, "");
  let completed = [];
  for (let i = 0; i < 200; i++) {
    completed = (await fs.readdir(paths.dir)).filter((name) => name.startsWith("complete-"));
    if (completed.length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.length, 2);
});
