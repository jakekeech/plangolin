import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LEASE_TTL_MS,
  LOCK_POLL_MS,
  LOCK_STALE_MS,
  MAX_CLOCK_SKEW_MS,
  ORPHAN_TEMP_STALE_MS,
  followPreparation,
  preparationPaths,
  preparationStartup,
  readPreparation,
  runPreparation,
  writePreparation,
} from "../src/preparation.js";

const generationName = (generation) => String(generation).padStart(12, "0");

async function writeLeaseState(root, cacheRoot, {
  generation = 1,
  owner = "11111111-1111-4111-8111-111111111111",
  pid = process.pid,
  startedAt = 1_000,
  renewedAt = startedAt,
  progressPhase = "starting",
  progressOwner = owner,
  revision = 1,
  progressAt = renewedAt,
} = {}) {
  const paths = preparationPaths(root, { cacheRoot });
  const g = generationName(generation);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(path.join(paths.dir, `lease-${g}.json`), JSON.stringify({
    version: 1, rootHash: paths.rootHash, generation, owner, pid, startedAt,
  }));
  await fs.writeFile(path.join(paths.dir, `heartbeat-${g}-${owner}.json`), JSON.stringify({
    version: 1, generation, owner, renewedAt,
  }));
  await fs.writeFile(path.join(paths.dir, `progress-${g}-${progressOwner}.json`), JSON.stringify({
    owner: progressOwner,
    generation,
    phase: progressPhase,
    revision,
    elapsed: Math.max(0, progressAt - startedAt),
    updatedAt: progressAt,
    counts: {},
  }));
  return { paths, generation, owner };
}

async function temporaryProject(t, prefix = "plangolin-preparation-") {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project");
  const cacheRoot = path.join(temp, "cache");
  await fs.mkdir(root);
  return { temp, root, cacheRoot };
}

function recordFor(root, cacheRoot, fingerprint = "a".repeat(64)) {
  return {
    version: 1,
    rootHash: preparationPaths(root, { cacheRoot }).rootHash,
    fingerprint,
    createdAt: 1234,
    moves: [{ t: "addNode", node: { id: "api" } }],
    dropped: [],
    provider: "test",
    model: "test-model",
  };
}

test("cache directories hash workspace roots without naming either workspace", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "plangolin-preparation-paths-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const cacheRoot = path.join(temp, "cache");
  const firstRoot = path.join(temp, "company-secret-alpha");
  const secondRoot = path.join(temp, "company-secret-beta");

  const first = preparationPaths(firstRoot, { cacheRoot });
  const second = preparationPaths(secondRoot, { cacheRoot });

  assert.notEqual(first.dir, second.dir);
  assert.match(path.basename(first.dir), /^[0-9a-f]{64}$/);
  assert.match(path.basename(second.dir), /^[0-9a-f]{64}$/);
  assert.ok(first.dir.startsWith(cacheRoot + path.sep));
  assert.ok(second.dir.startsWith(cacheRoot + path.sep));
  assert.doesNotMatch(first.dir, /company-secret-alpha|company-secret-beta/);
  assert.doesNotMatch(second.dir, /company-secret-alpha|company-secret-beta/);
});

test("cache location honors the explicit environment override", () => {
  const cacheRoot = path.join(os.tmpdir(), "plangolin-explicit-cache");
  const paths = preparationPaths("/workspace/project", {
    env: { PLANGOLIN_CACHE_DIR: cacheRoot },
    platform: "linux",
    home: "/home/tester",
  });

  assert.ok(paths.dir.startsWith(cacheRoot + path.sep));
});

test("cache location follows platform defaults without entering the workspace", () => {
  const mac = preparationPaths("/workspace/project", {
    env: {}, platform: "darwin", home: "/Users/tester",
  });
  const linuxXdg = preparationPaths("/workspace/project", {
    env: { XDG_CACHE_HOME: "/var/cache/tester" }, platform: "linux", home: "/home/tester",
  });
  const linuxHome = preparationPaths("/workspace/project", {
    env: {}, platform: "linux", home: "/home/tester",
  });
  const windows = preparationPaths("C:\\workspace\\project", {
    env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    platform: "win32", home: "C:\\Users\\tester",
  });

  assert.ok(mac.dir.startsWith(path.join("/Users/tester", "Library", "Caches", "plangolin") + path.sep));
  assert.ok(linuxXdg.dir.startsWith(path.join("/var/cache/tester", "plangolin") + path.sep));
  assert.ok(linuxHome.dir.startsWith(path.join("/home/tester", ".cache", "plangolin") + path.sep));
  assert.ok(windows.dir.startsWith(path.win32.join("C:\\Users\\tester\\AppData\\Local", "plangolin", "Cache") + path.win32.sep));
});

test("normalizes relative roots and cache roots but rejects cache storage inside the workspace", async (t) => {
  const { temp, root } = await temporaryProject(t, "plangolin-cache-containment-");
  const outside = path.join(temp, "outside-cache");
  const relativeRoot = path.relative(process.cwd(), root);
  const relativeOutside = path.relative(process.cwd(), outside);

  const normalized = preparationPaths(relativeRoot, {
    cacheRoot: relativeOutside,
    cwd: process.cwd(),
  });
  assert.ok(path.isAbsolute(normalized.dir));
  assert.equal(normalized.rootHash, preparationPaths(root, { cacheRoot: outside }).rootHash);

  assert.throws(() => preparationPaths(root, {
    cacheRoot: path.join(root, ".plangolin-cache"),
  }), /outside.*workspace/i);
  assert.throws(() => preparationPaths(root, {
    env: { PLANGOLIN_CACHE_DIR: "cache" }, cwd: root,
  }), /outside.*workspace/i);
  assert.throws(() => preparationPaths("/Users/tester/Library/Caches/plangolin", {
    env: {}, platform: "darwin", home: "/Users/tester",
  }), /outside.*workspace/i);
  assert.throws(() => preparationPaths("C:\\Work\\Project", {
    cacheRoot: "c:\\work\\project\\cache", platform: "win32", cwd: "C:\\Work",
  }), /outside.*workspace/i);
});

test("writes a result by same-directory rename and reads only its exact fingerprint", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const record = recordFor(root, cacheRoot);
  const renames = [];
  const io = {
    ...fs,
    async rename(from, to) {
      renames.push([from, to]);
      return fs.rename(from, to);
    },
  };

  await writePreparation(root, record, { cacheRoot, fs: io });

  const paths = preparationPaths(root, { cacheRoot });
  assert.equal(renames.length, 1);
  assert.equal(path.dirname(renames[0][0]), paths.dir);
  assert.equal(path.basename(renames[0][1]), "result-000000000000-manual.json");
  assert.deepEqual(await readPreparation(root, record.fingerprint, { cacheRoot }), record);
  assert.equal(await readPreparation(root, "b".repeat(64), { cacheRoot }), null);
  assert.deepEqual(await fs.readdir(paths.dir), ["result-000000000000-manual.json"]);
});

test("readPreparation requires a nonempty expected fingerprint", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const record = recordFor(root, cacheRoot);
  await writePreparation(root, record, { cacheRoot });

  await assert.rejects(readPreparation(root, undefined, { cacheRoot }), /fingerprint/i);
  await assert.rejects(readPreparation(root, "", { cacheRoot }), /fingerprint/i);
  assert.equal(await readPreparation(root, "b".repeat(64), { cacheRoot }), null);
  assert.deepEqual(await readPreparation(root, record.fingerprint, { cacheRoot }), record);
});

test("rejects malformed, partial, wrong-version, and wrong-root results", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });
  const result = path.join(paths.dir, "result-000000000000-manual.json");
  const fingerprint = "a".repeat(64);
  await fs.mkdir(paths.dir, { recursive: true });

  await fs.writeFile(result, "{not json", "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(result, JSON.stringify({ version: 1, fingerprint }), "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(result, JSON.stringify({
    ...recordFor(root, cacheRoot, fingerprint), version: 2,
  }), "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(result, JSON.stringify({
    ...recordFor(root, cacheRoot, fingerprint), rootHash: "c".repeat(64),
  }), "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);
});

function graphFixture() {
  return {
    files: ["src/api.js", "src/store.js"],
    links: [{ from: "src/api.js", to: "src/store.js", kind: "import", names: ["read"] }],
    capped: false,
  };
}

function preparationDoubles(overrides = {}) {
  const graph = graphFixture();
  const discovery = {
    graph, groups: [], flatGroups: [{ id: "g1" }], dependencies: new Map(),
    excerpts: new Map([["src/api.js", "private source excerpt"]]), dropped: ["group warning"],
  };
  const described = {
    blocks: [], labels: new Map(), dropped: ["name warning"],
    provider: "test", model: "test-model",
  };
  return {
    graph,
    discovery,
    described,
    buildGraph: async () => graph,
    discover: async (_ws, { graph: passed, onProgress }) => {
      assert.equal(passed, graph);
      await onProgress({
        phase: "grouping_components",
        counts: { components: 1, ignored: "not numeric" },
        sourcePath: "/private/project/src/api.js",
        excerpts: discovery.excerpts,
      });
      return discovery;
    },
    name: async (_discovery, { onProgress }) => {
      await onProgress({ phase: "naming_and_matching", counts: { components: 1 } });
      return described;
    },
    movesFrom: () => ({ moves: [{ t: "addNode", node: { id: "api" } }] }),
    ...overrides,
  };
}

test("shared preparation reuses one graph object, names once, and stores bounded progress", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const ws = { root };
  const doubles = preparationDoubles();
  let graphBuilds = 0;
  let discoveries = 0;
  let namings = 0;
  let moveBuilds = 0;
  const writtenProgress = [];
  const io = {
    ...fs,
    async writeFile(file, content, ...args) {
      if (path.basename(file).includes("progress")) writtenProgress.push(JSON.parse(content));
      return fs.writeFile(file, content, ...args);
    },
  };

  const record = await runPreparation(root, {
    cacheRoot,
    fs: io,
    ws,
    now: () => 5_000,
    buildGraph: async (passedWs) => {
      graphBuilds += 1;
      assert.equal(passedWs, ws);
      return doubles.graph;
    },
    discover: async (passedWs, options) => {
      discoveries += 1;
      assert.equal(passedWs, ws);
      assert.equal(options.graph, doubles.graph);
      await options.onProgress({
        phase: "private /workspace/secret.js excerpt",
        counts: { "/workspace/secret.js": 1 },
      });
      return doubles.discover(passedWs, options);
    },
    name: async (discovery, options) => {
      namings += 1;
      assert.equal(discovery, doubles.discovery);
      return doubles.name(discovery, options);
    },
    movesFrom: (discovery, described) => {
      moveBuilds += 1;
      assert.equal(discovery, doubles.discovery);
      assert.equal(described, doubles.described);
      return doubles.movesFrom();
    },
  });

  assert.equal(graphBuilds, 1);
  assert.equal(discoveries, 1);
  assert.equal(namings, 1);
  assert.equal(moveBuilds, 1);
  assert.deepEqual(record, {
    version: 1,
    rootHash: preparationPaths(root, { cacheRoot }).rootHash,
    fingerprint: record.fingerprint,
    createdAt: 5_000,
    moves: [{ t: "addNode", node: { id: "api" } }],
    dropped: ["group warning", "name warning"],
    provider: "test",
    model: "test-model",
  });
  assert.match(record.fingerprint, /^[0-9a-f]{64}$/);

  const paths = preparationPaths(root, { cacheRoot });
  const progressName = (await fs.readdir(paths.dir)).find((name) => name.startsWith("progress-"));
  const progressText = await fs.readFile(path.join(paths.dir, progressName), "utf8");
  const progress = JSON.parse(progressText);
  assert.deepEqual(progress, {
    owner: progress.owner,
    generation: 1,
    phase: "complete",
    revision: 5,
    elapsed: 0,
    updatedAt: 5_000,
    counts: { moves: 1, dropped: 2 },
  });
  assert.ok(writtenProgress.every((entry) => !JSON.stringify(entry).includes("secret.js")));
  assert.doesNotMatch(progressText, /src\/api|private source|excerpt|sourcePath/);
  const finalNames = await fs.readdir(paths.dir);
  assert.equal(finalNames.filter((name) => name.startsWith("lease-")).length, 1);
  assert.equal(finalNames.filter((name) => name.startsWith("heartbeat-")).length, 1);
  assert.equal(finalNames.filter((name) => name.startsWith("progress-")).length, 1);
  assert.equal(finalNames.filter((name) => name.startsWith("result-")).length, 1);
});

test("an exact cached preparation skips discovery, naming, and move generation", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  const first = await runPreparation(root, { cacheRoot, ws: { root }, ...doubles });

  const cached = await runPreparation(root, {
    cacheRoot,
    ws: { root },
    buildGraph: async () => doubles.graph,
    discover: async () => { throw new Error("must not discover an exact cache hit"); },
    name: async () => { throw new Error("must not name an exact cache hit"); },
    movesFrom: () => { throw new Error("must not produce moves for an exact cache hit"); },
  });

  assert.deepEqual(cached, first);
});

test("a matching live worker is followed and only one naming pass runs", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  let releaseNaming;
  const namingGate = new Promise((resolve) => { releaseNaming = resolve; });
  let namings = 0;
  const options = {
    cacheRoot,
    ws: { root },
    pollMs: 5,
    buildGraph: doubles.buildGraph,
    discover: doubles.discover,
    name: async (...args) => {
      namings += 1;
      await namingGate;
      return doubles.name(...args);
    },
    movesFrom: doubles.movesFrom,
  };

  const firstPromise = runPreparation(root, options);
  const paths = preparationPaths(root, { cacheRoot });
  for (let i = 0; i < 100; i++) {
    if (await fs.readFile(paths.progress, "utf8").then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const secondPromise = runPreparation(root, options);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(namings, 1);
  releaseNaming();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(second, first);
  assert.equal(namings, 1);
});

test("startup readiness is bound to the same live owner before and after progress is read", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const now = 2_000;
  const current = await writeLeaseState(root, cacheRoot, { startedAt: 1_900, renewedAt: 1_950, progressAt: 1_960 });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => now, processAlive: () => true,
  }), { live: true, ready: true });

  await fs.writeFile(path.join(current.paths.dir, `progress-${generationName(1)}-${current.owner}.json`), JSON.stringify({
    owner: current.owner, generation: 1, phase: "failed", revision: 2,
    elapsed: 50, updatedAt: 1_960, counts: {},
  }));
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => now, processAlive: () => true,
  }), { live: false, ready: false });

  await writeLeaseState(root, cacheRoot, {
    generation: 2,
    owner: "22222222-2222-4222-8222-222222222222",
    startedAt: 1_970,
    renewedAt: 1_980,
    progressOwner: current.owner,
    progressAt: 1_990,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => now, processAlive: () => true,
  }), { live: true, ready: false });

  await writeLeaseState(root, cacheRoot, {
    generation: 3,
    owner: "33333333-3333-4333-8333-333333333333",
    startedAt: 1_970,
    renewedAt: 1_980,
    progressAt: now - LEASE_TTL_MS - 1,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => now, processAlive: () => true,
  }), { live: true, ready: false });
});

test("startup retries when ownership changes during its progress read", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const first = await writeLeaseState(root, cacheRoot, { startedAt: 1_900, renewedAt: 1_950, progressAt: 1_960 });
  let changed = false;
  const io = {
    ...fs,
    async readFile(file, ...args) {
      const value = await fs.readFile(file, ...args);
      if (!changed && path.basename(file).startsWith("progress-")) {
        changed = true;
        await writeLeaseState(root, cacheRoot, {
          generation: 2,
          owner: "22222222-2222-4222-8222-222222222222",
          startedAt: 1_970,
          renewedAt: 1_980,
          progressAt: 1_990,
        });
      }
      return value;
    },
  };

  const status = await preparationStartup(root, {
    cacheRoot, fs: io, now: () => 2_000, processAlive: () => true,
  });

  assert.equal(changed, true);
  assert.deepEqual(status, { live: true, ready: false });
  assert.ok(await fs.readFile(path.join(first.paths.dir, `lease-${generationName(2)}.json`), "utf8"));
});

test("future-dated and expired leases are not live despite a live PID", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  await writeLeaseState(root, cacheRoot, {
    startedAt: 10_000 + MAX_CLOCK_SKEW_MS + 1,
    renewedAt: 10_000 + MAX_CLOCK_SKEW_MS + 1,
    progressAt: 10_000 + MAX_CLOCK_SKEW_MS + 1,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => 10_000, processAlive: () => true,
  }), { live: false, ready: false });

  await writeLeaseState(root, cacheRoot, {
    generation: 2,
    owner: "22222222-2222-4222-8222-222222222222",
    startedAt: 10_000 - LEASE_TTL_MS - 10,
    renewedAt: 10_000 - LEASE_TTL_MS - 1,
    progressAt: 10_000 - LEASE_TTL_MS - 1,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => 10_000, processAlive: () => true,
  }), { live: false, ready: false });

  await writeLeaseState(root, cacheRoot, {
    generation: 3,
    owner: "33333333-3333-4333-8333-333333333333",
    startedAt: 10_000 - LEASE_TTL_MS - 1,
    renewedAt: 9_999,
    progressAt: 9_999,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => 10_000, processAlive: () => true,
  }), { live: true, ready: true });
});

test("a fenced owner cannot overwrite a newer owner's lease, progress, or result", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let now = 1_000;
  let releaseOldPublish;
  const oldPublishGate = new Promise((resolve) => { releaseOldPublish = resolve; });
  let signalOldPublish;
  const oldAtPublish = new Promise((resolve) => { signalOldPublish = resolve; });
  const oldIo = {
    ...fs,
    async rename(from, to) {
      if (path.basename(from).startsWith(".tmp-result-000000000001-")) {
        signalOldPublish();
        await oldPublishGate;
      }
      return fs.rename(from, to);
    },
  };
  let oldHeartbeatTick;
  let oldHeartbeatStopped = false;
  const old = preparationDoubles({
    movesFrom: () => ({ moves: [{ t: "addNode", node: { id: "old" } }] }),
  });
  const oldRun = runPreparation(root, {
    cacheRoot, fs: oldIo, ws: { root }, now: () => now, processAlive: () => true,
    setInterval(fn) {
      oldHeartbeatTick = fn;
      return { unref() {} };
    },
    clearInterval() { oldHeartbeatStopped = true; },
    ...old,
  });
  await oldAtPublish;
  now += LEASE_TTL_MS + 1;
  const newer = preparationDoubles();
  newer.movesFrom = () => ({ moves: [{ t: "addNode", node: { id: "new" } }] });
  const newRecord = await runPreparation(root, {
    cacheRoot, ws: { root }, now: () => now, processAlive: () => true, ...newer,
  });
  const paths = preparationPaths(root, { cacheRoot });
  const oldHeartbeatName = (await fs.readdir(paths.dir)).find((name) => name.startsWith("heartbeat-000000000001-"));
  const heartbeatBefore = await fs.readFile(path.join(paths.dir, oldHeartbeatName), "utf8");
  oldHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await fs.readFile(path.join(paths.dir, oldHeartbeatName), "utf8"), heartbeatBefore);
  releaseOldPublish();
  await oldRun;
  assert.equal(oldHeartbeatStopped, true);

  const visible = await readPreparation(root, newRecord.fingerprint, { cacheRoot });
  assert.equal(visible.moves[0].node.id, "new");
  const names = await fs.readdir(paths.dir);
  assert.equal(names.filter((name) => name.startsWith("lease-")).length, 2);
  assert.equal(names.filter((name) => name.startsWith("progress-")).length, 2);
  assert.equal(names.filter((name) => name.startsWith("result-")).length, 2);
});

test("two successors that both observe a stale lease elect one higher generation without unlinking", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  await writeLeaseState(root, cacheRoot, {
    startedAt: 1_000, renewedAt: 1_000, progressAt: 1_000,
  });
  const doubles = preparationDoubles();
  let namings = 0;
  let leaseAttempts = 0;
  let releaseClaims;
  const bothClaims = new Promise((resolve) => { releaseClaims = resolve; });
  const io = {
    ...fs,
    async writeFile(file, ...args) {
      if (path.basename(file) === "lease-000000000002.json") {
        leaseAttempts += 1;
        if (leaseAttempts === 2) releaseClaims();
        await bothClaims;
      }
      return fs.writeFile(file, ...args);
    },
  };
  const options = {
    cacheRoot, fs: io, ws: { root }, now: () => 1_000 + LEASE_TTL_MS + 1,
    processAlive: () => true, pollMs: 2, ...doubles,
    name: async (...args) => { namings += 1; return doubles.name(...args); },
  };

  const [one, two] = await Promise.all([
    runPreparation(root, options),
    runPreparation(root, options),
  ]);

  assert.deepEqual(one, two);
  assert.equal(leaseAttempts, 2, "both successors selected generation 2 from the same stale read");
  assert.equal(namings, 1);
  const leaseNames = (await fs.readdir(preparationPaths(root, { cacheRoot }).dir))
    .filter((name) => name.startsWith("lease-"));
  assert.deepEqual(leaseNames, ["lease-000000000001.json", "lease-000000000002.json"]);
});

test("followPreparation returns a live matching worker's final atomic result", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const running = runPreparation(root, {
    cacheRoot, ws: { root }, pollMs: 5, ...doubles,
    name: async (...args) => { await gate; return doubles.name(...args); },
  });
  const fingerprint = (await import("../src/filegraph.js")).fingerprintGraph(doubles.graph);
  const paths = preparationPaths(root, { cacheRoot });
  for (let i = 0; i < 100; i++) {
    const lock = await fs.readFile(paths.lock, "utf8").then(JSON.parse, () => null);
    if (lock?.fingerprint === fingerprint) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const following = followPreparation(root, fingerprint, { cacheRoot, pollMs: 5, timeoutMs: 1_000 });
  finish();
  assert.deepEqual(await following, await running);
});

test("stale and dead locks are replaced without deleting another cache entry", async (t) => {
  for (const scenario of ["stale", "dead"]) {
    const { root, cacheRoot } = await temporaryProject(t, `plangolin-${scenario}-lock-`);
    const paths = preparationPaths(root, { cacheRoot });
    await writeLeaseState(root, cacheRoot, {
      owner: "11111111-1111-4111-8111-111111111111",
      pid: 987_654,
      startedAt: scenario === "stale" ? 0 : 9_999,
      renewedAt: scenario === "stale" ? 0 : 9_999,
      progressAt: scenario === "stale" ? 0 : 9_999,
    });
    await fs.writeFile(path.join(paths.dir, "unrelated.json"), "keep");
    const doubles = preparationDoubles();

    const record = await runPreparation(root, {
      cacheRoot, ws: { root }, ...doubles,
      now: () => LEASE_TTL_MS + 10_000,
      processAlive: () => scenario === "stale",
    });

    assert.equal(record.version, 1);
    assert.equal(await fs.readFile(path.join(paths.dir, "unrelated.json"), "utf8"), "keep");
    assert.equal((await fs.readdir(paths.dir)).filter((name) => name.startsWith("lease-")).length, 2);
  }
});

test("failure cleans its lock and temporary result without persisting error content", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });

  await assert.rejects(runPreparation(root, {
    cacheRoot,
    ws: { root },
    now: () => 2_000,
    buildGraph: async () => { throw new Error("private /workspace/secret.js excerpt"); },
  }), /private/);

  const names = await fs.readdir(paths.dir);
  assert.equal(names.filter((name) => name.startsWith("lease-")).length, 1);
  assert.equal(names.filter((name) => name.startsWith("result-")).length, 0);
  const progressText = await fs.readFile(path.join(paths.dir, names.find((name) => name.startsWith("progress-"))), "utf8");
  assert.deepEqual(JSON.parse(progressText), {
    owner: JSON.parse(progressText).owner,
    generation: 1,
    phase: "failed", revision: 2, elapsed: 0, updatedAt: 2_000, counts: {},
  });
  assert.doesNotMatch(progressText, /secret|workspace|excerpt|private/);
  assert.ok((await fs.readdir(paths.dir)).every((name) => !name.endsWith(".tmp")));
});

test("a startup wait failure still records failure and releases its owned lock", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });

  await assert.rejects(runPreparation(root, {
    cacheRoot,
    ws: { root },
    startupHoldMs: 1,
    sleep: async () => { throw new Error("startup clock failed"); },
  }), /startup clock failed/);

  const names = await fs.readdir(paths.dir);
  assert.equal(names.filter((name) => name.startsWith("lease-")).length, 1);
  const progress = names.find((name) => name.startsWith("progress-"));
  assert.equal(JSON.parse(await fs.readFile(path.join(paths.dir, progress), "utf8")).phase, "failed");
});

test("progress I/O failures never fail otherwise successful work", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  const io = {
    ...fs,
    async writeFile(file, ...args) {
      if (path.basename(file).includes("progress")) throw new Error("progress disk unavailable");
      return fs.writeFile(file, ...args);
    },
  };

  const record = await runPreparation(root, {
    cacheRoot, fs: io, ws: { root }, ...doubles,
  });

  assert.equal(record.version, 1);
  assert.deepEqual(await readPreparation(root, record.fingerprint, { cacheRoot }), record);
});

test("a successor removes only old recognized orphan temps outside its current lease", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });
  await fs.mkdir(paths.dir, { recursive: true });
  const oldOwner = "11111111-1111-4111-8111-111111111111";
  const currentOwner = "22222222-2222-4222-8222-222222222222";
  const old = [
    `.tmp-result-000000000001-${oldOwner}-orphan.json`,
    `.tmp-progress-000000000001-${oldOwner}-orphan.json`,
    `.tmp-lock-update-000000000001-${oldOwner}-orphan.json`,
  ];
  const recent = `.tmp-result-000000000001-${oldOwner}-recent.json`;
  const current = `.tmp-progress-000000000001-${currentOwner}-current.json`;
  const unrelated = "notes.tmp";
  for (const name of [...old, recent, current, unrelated]) {
    await fs.writeFile(path.join(paths.dir, name), "keep");
  }
  const oldDate = new Date(1_000 - ORPHAN_TEMP_STALE_MS - 1);
  for (const name of old) await fs.utimes(path.join(paths.dir, name), oldDate, oldDate);
  await fs.utimes(path.join(paths.dir, recent), new Date(1_000), new Date(1_000));
  await fs.utimes(path.join(paths.dir, current), oldDate, oldDate);
  await fs.utimes(path.join(paths.dir, unrelated), oldDate, oldDate);
  const doubles = preparationDoubles();

  await runPreparation(root, {
    cacheRoot, ws: { root }, now: () => 1_000, pid: process.pid,
    ownerToken: currentOwner, ...doubles,
  });

  const remaining = await fs.readdir(paths.dir);
  for (const name of old) assert.ok(!remaining.includes(name), name);
  assert.ok(remaining.includes(recent));
  assert.ok(remaining.includes(current));
  assert.ok(remaining.includes(unrelated));
});

test("lock timing defaults are finite named public constants", () => {
  assert.ok(Number.isFinite(LOCK_STALE_MS) && LOCK_STALE_MS > 2_000);
  assert.ok(Number.isFinite(LOCK_POLL_MS) && LOCK_POLL_MS > 0);
  assert.ok(Number.isFinite(LEASE_TTL_MS) && LEASE_TTL_MS > LOCK_POLL_MS);
  assert.ok(Number.isFinite(MAX_CLOCK_SKEW_MS) && MAX_CLOCK_SKEW_MS >= 0);
  assert.ok(Number.isFinite(ORPHAN_TEMP_STALE_MS) && ORPHAN_TEMP_STALE_MS > 0);
});
