import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprintGraph } from "../src/filegraph.js";
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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
  const lease = path.join(paths.dir, `lease-${g}.claim`);
  await fs.mkdir(lease);
  await fs.mkdir(path.join(lease, `${owner}-${pid}-${startedAt}.owner`));
  await fs.mkdir(path.join(paths.dir, `heartbeat-${g}-${owner}-000000000001-${renewedAt}.beat`));
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

test("rejects a cache root whose physical symlink target is inside the workspace", async (t) => {
  const { temp, root } = await temporaryProject(t, "plangolin-cache-symlink-");
  const inside = path.join(root, "hidden-cache");
  const alias = path.join(temp, "outside-looking-cache");
  await fs.mkdir(inside);
  try {
    await fs.symlink(inside, alias, "dir");
  } catch (err) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(err.code)) return t.skip(`symlinks unsupported: ${err.code}`);
    throw err;
  }

  assert.throws(() => preparationPaths(root, { cacheRoot: alias }), /outside.*workspace/i);
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
  assert.match(path.basename(renames[0][1]), /^result-000000000001-[0-9a-f-]{36}\.json$/);
  assert.deepEqual(await readPreparation(root, record.fingerprint, { cacheRoot }), record);
  assert.equal(await readPreparation(root, "b".repeat(64), { cacheRoot }), null);
  assert.equal((await fs.readdir(paths.dir)).filter((name) => name.startsWith("result-")).length, 1);
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

test("a newer generation created during result read fences the older cache hit", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const record = recordFor(root, cacheRoot);
  await writePreparation(root, record, { cacheRoot });
  const paths = preparationPaths(root, { cacheRoot });
  let advanced = false;
  const io = {
    ...fs,
    async readFile(file, ...args) {
      const value = await fs.readFile(file, ...args);
      if (!advanced && path.basename(file).startsWith("result-000000000001-")) {
        advanced = true;
        const owner = "22222222-2222-4222-8222-222222222222";
        const slot = path.join(paths.dir, "lease-000000000002.claim");
        await fs.mkdir(slot);
        await fs.mkdir(path.join(slot, `${owner}-${process.pid}-${Date.now()}.owner`));
      }
      return value;
    },
  };

  assert.equal(await readPreparation(root, record.fingerprint, { cacheRoot, fs: io }), null);
  assert.equal(advanced, true);
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
  assert.deepEqual(
    (await fs.readdir(preparationPaths(root, { cacheRoot }).dir))
      .filter((entry) => entry.startsWith("lease-"))
      .sort(),
    ["lease-000000000001.claim", "lease-000000000002.claim"],
  );
});

test("a completed fingerprint miss advances immediately to a new generation", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const first = preparationDoubles();
  await runPreparation(root, { cacheRoot, ws: { root }, ...first });
  const changedGraph = {
    ...graphFixture(),
    files: [...graphFixture().files, "src/new.js"],
  };
  const second = preparationDoubles();
  second.graph = changedGraph;
  second.buildGraph = async () => changedGraph;
  second.discovery.graph = changedGraph;
  second.discover = async (_ws, { graph, onProgress }) => {
    assert.equal(graph, changedGraph);
    await onProgress({ phase: "grouping_components", counts: { components: 1 } });
    return second.discovery;
  };
  second.movesFrom = () => ({ moves: [{ t: "addNode", node: { id: "changed" } }] });

  const record = await runPreparation(root, {
    cacheRoot, ws: { root }, pollMs: 1, timeoutMs: 20, ...second,
  });

  assert.equal(record.moves[0].node.id, "changed");
  const leases = (await fs.readdir(preparationPaths(root, { cacheRoot }).dir))
    .filter((name) => name.startsWith("lease-"));
  assert.deepEqual(leases.sort(), ["lease-000000000001.claim", "lease-000000000002.claim"]);
});

test("an incomplete lease slot blocks a follower until its owner identity is published", async (t) => {
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
      if (path.basename(dir) === "lease-000000000001.claim" && slotBlocked) {
        signalSlot();
        await slotGate;
        slotBlocked = false;
      }
      return result;
    },
    async readdir(dir, ...args) {
      const result = await fs.readdir(dir, ...args);
      if (dir === path.join(paths.dir, "lease-000000000001.claim") && slotBlocked) signalFollower();
      return result;
    },
  };
  const doubles = preparationDoubles();
  let namings = 0;
  const options = {
    cacheRoot, fs: io, ws: { root }, pollMs: 2, ...doubles,
    name: async (...args) => { namings += 1; return doubles.name(...args); },
  };

  const first = runPreparation(root, options);
  await slotCreated;
  const second = runPreparation(root, options);
  await followerSawSlot;
  assert.equal(namings, 0);
  releaseSlot();
  const [one, two] = await Promise.all([first, second]);

  assert.deepEqual(one, two);
  assert.equal(namings, 1);
  assert.deepEqual(
    (await fs.readdir(paths.dir)).filter((name) => name.startsWith("lease-")).sort(),
    ["lease-000000000001.claim"],
  );
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
  assert.ok((await fs.readdir(first.paths.dir)).includes(`lease-${generationName(2)}.claim`));
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
    startedAt: 1,
    renewedAt: 19_999,
    progressAt: 19_999,
  });
  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => 20_000, processAlive: () => true,
  }), { live: true, ready: true });
});

test("malformed owner identities are never considered live or followed", async (t) => {
  const cases = [
    "11111111-1111-4111-8111-111111111111-0-1000.owner",
    "11111111-1111-4111-8111-111111111111--1-1000.owner",
    "11111111-1111-4111-8111-111111111111-9007199254740992-1000.owner",
    "00000000-0000-0000-0000-000000000000-123-1000.owner",
    "not-a-uuid-123-1000.owner",
  ];

  for (const [index, ownerName] of cases.entries()) {
    await t.test(ownerName, async (t) => {
      const { root, cacheRoot } = await temporaryProject(t, `plangolin-invalid-owner-${index}-`);
      const paths = preparationPaths(root, { cacheRoot });
      const slot = path.join(paths.dir, "lease-000000000001.claim");
      await fs.mkdir(slot, { recursive: true });
      await fs.mkdir(path.join(slot, ownerName));
      const observedAt = Date.now();
      let processChecks = 0;

      assert.deepEqual(await preparationStartup(root, {
        cacheRoot,
        now: () => observedAt,
        processAlive: () => { processChecks += 1; return true; },
      }), { live: false, ready: false });
      assert.equal(processChecks, 0);
    });
  }
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
    async mkdir(dir, ...args) {
      if (path.basename(dir).startsWith("complete-000000000001-")) {
        signalOldPublish();
        await oldPublishGate;
      }
      return fs.mkdir(dir, ...args);
    },
    async rename(from, to) {
      if (path.basename(from).startsWith(".tmp-result-000000000001-")) {
        // Owner 1's final exists before its completion marker is delayed.
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
  const oldHeartbeatBefore = (await fs.readdir(paths.dir)).filter((name) => name.startsWith("heartbeat-000000000001-"));
  oldHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    (await fs.readdir(paths.dir)).filter((name) => name.startsWith("heartbeat-000000000001-")),
    oldHeartbeatBefore,
  );
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

test("a newer failed generation masks a delayed older successful result", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let now = 1_000;
  let releaseOldPublish;
  const oldPublishGate = new Promise((resolve) => { releaseOldPublish = resolve; });
  let signalOldPublish;
  const oldAtPublish = new Promise((resolve) => { signalOldPublish = resolve; });
  const oldIo = {
    ...fs,
    async mkdir(dir, ...args) {
      if (path.basename(dir).startsWith("complete-000000000001-")) {
        signalOldPublish();
        await oldPublishGate;
      }
      return fs.mkdir(dir, ...args);
    },
  };
  const old = preparationDoubles({
    movesFrom: () => ({ moves: [{ t: "addNode", node: { id: "old" } }] }),
  });
  const oldRun = runPreparation(root, {
    cacheRoot, fs: oldIo, ws: { root }, now: () => now, processAlive: () => true, ...old,
  });
  await oldAtPublish;
  now += LEASE_TTL_MS + 1;
  const newer = preparationDoubles();

  await assert.rejects(runPreparation(root, {
    cacheRoot, ws: { root }, now: () => now, processAlive: () => true, ...newer,
    name: async () => { throw new Error("new generation failed"); },
  }), /new generation failed/);
  releaseOldPublish();
  await assert.rejects(oldRun, /fenced/);

  const fingerprint = fingerprintGraph(old.graph);
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);
});

test("an owner fenced during initial renewal follows without doing graph or naming work", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let now = 1_000;
  let injected = false;
  let graphBuilds = 0;
  const winner = preparationDoubles({
    movesFrom: () => ({ moves: [{ t: "addNode", node: { id: "winner" } }] }),
  });
  const io = {
    ...fs,
    async mkdir(dir, ...args) {
      if (!injected && path.basename(dir).startsWith("heartbeat-000000000001-")) {
        injected = true;
        now += LEASE_TTL_MS + 1;
        await runPreparation(root, {
          cacheRoot, ws: { root }, now: () => now, processAlive: () => true, ...winner,
        });
      }
      return fs.mkdir(dir, ...args);
    },
  };

  const record = await runPreparation(root, {
    cacheRoot, fs: io, ws: { root }, now: () => now, processAlive: () => true,
    buildGraph: async () => { graphBuilds += 1; return winner.graph; },
    discover: async () => { throw new Error("fenced owner must not discover"); },
    name: async () => { throw new Error("fenced owner must not name"); },
  });

  assert.equal(injected, true);
  assert.equal(graphBuilds, 0);
  assert.equal(record.moves[0].node.id, "winner");
});

test("out-of-order heartbeat completion cannot make a newer renewal look stale", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  let now = 2_000;
  let heartbeatTick;
  let releaseWork;
  const workGate = new Promise((resolve) => { releaseWork = resolve; });
  let releaseOlder;
  const olderGate = new Promise((resolve) => { releaseOlder = resolve; });
  let olderBlocked;
  const olderAtRename = new Promise((resolve) => { olderBlocked = resolve; });
  let heartbeatClaims = 0;
  const io = {
    ...fs,
    async mkdir(dir, ...args) {
      if (path.basename(dir).startsWith("heartbeat-")) heartbeatClaims += 1;
      if (heartbeatClaims === 2) {
        olderBlocked();
        await olderGate;
      }
      return fs.mkdir(dir, ...args);
    },
  };
  const doubles = preparationDoubles({
    name: async (...args) => { await workGate; return preparationDoubles().name(...args); },
  });
  const running = runPreparation(root, {
    cacheRoot, fs: io, ws: { root }, now: () => now, processAlive: () => true, ...doubles,
    setInterval(fn) { heartbeatTick = fn; return { unref() {} }; },
    clearInterval() {},
  });
  while (!heartbeatTick) await new Promise((resolve) => setImmediate(resolve));

  heartbeatTick();
  await olderAtRename;
  now = 3_000;
  heartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));
  releaseOlder();
  await new Promise((resolve) => setImmediate(resolve));
  now = 2_000 + LEASE_TTL_MS + 1;

  assert.deepEqual(await preparationStartup(root, {
    cacheRoot, now: () => now, processAlive: () => true,
  }), { live: true, ready: false });
  releaseWork();
  await running;
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
    async mkdir(dir, ...args) {
      if (path.basename(dir) === "lease-000000000002.claim") {
        leaseAttempts += 1;
        if (leaseAttempts === 2) releaseClaims();
        await bothClaims;
      }
      return fs.mkdir(dir, ...args);
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
  assert.equal(leaseNames.length, 2);
  assert.ok(leaseNames.includes("lease-000000000001.claim"));
  assert.ok(leaseNames.includes("lease-000000000002.claim"));
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

test("followPreparation reports bounded live progress while retaining exact result fencing", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  const nameStarted = deferred();
  const finishName = deferred();
  const sleepEntered = deferred();
  const continueFollowing = deferred();
  const running = runPreparation(root, {
    cacheRoot,
    ws: { root },
    ...doubles,
    name: async (_discovery, { onProgress }) => {
      await onProgress({
        phase: "naming_and_matching",
        counts: { components: 1, privatePath: "/private/project/src/api.js" },
      });
      nameStarted.resolve();
      await finishName.promise;
      return doubles.described;
    },
  });
  await nameStarted.promise;

  const progress = [];
  const following = followPreparation(root, fingerprintGraph(doubles.graph), {
    cacheRoot,
    timeoutMs: 1_000,
    sleep: async () => {
      sleepEntered.resolve();
      await continueFollowing.promise;
    },
    onProgress(event) { progress.push(event); },
  });

  try {
    await sleepEntered.promise;
    assert.deepEqual(progress, [{
      phase: "naming_and_matching",
      revision: 3,
      elapsed: progress[0]?.elapsed,
      counts: { components: 1 },
    }]);
    assert.ok(Number.isFinite(progress[0].elapsed));
    assert.doesNotMatch(JSON.stringify(progress), /private|project|src\/api/);
  } finally {
    finishName.resolve();
    continueFollowing.resolve();
  }
  assert.deepEqual(await following, await running);
});

test("followPreparation completion never waits for a progress observer to settle", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const doubles = preparationDoubles();
  const nameStarted = deferred();
  const finishName = deferred();
  const observerStarted = deferred();
  const observerNeverSettles = deferred();
  const sleepEntered = deferred();
  const continueFollowing = deferred();
  const running = runPreparation(root, {
    cacheRoot,
    ws: { root },
    ...doubles,
    name: async (_discovery, { onProgress }) => {
      await onProgress({ phase: "naming_and_matching", counts: { components: 1 } });
      nameStarted.resolve();
      await finishName.promise;
      return doubles.described;
    },
  });
  await nameStarted.promise;

  const following = followPreparation(root, fingerprintGraph(doubles.graph), {
    cacheRoot,
    timeoutMs: 1_000,
    sleep: async () => {
      sleepEntered.resolve();
      await continueFollowing.promise;
    },
    onProgress() {
      observerStarted.resolve();
      return observerNeverSettles.promise;
    },
  });

  await observerStarted.promise;
  const loopState = await Promise.race([
    sleepEntered.promise.then(() => "continued"),
    new Promise((resolve) => setImmediate(() => resolve("observer-blocked"))),
  ]);
  try {
    assert.equal(loopState, "continued");
  } finally {
    finishName.resolve();
    continueFollowing.resolve();
  }
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
    ".tmp-result-000000000000-manual-orphan.json",
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
