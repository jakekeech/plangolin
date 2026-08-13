import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LOCK_POLL_MS,
  LOCK_STALE_MS,
  followPreparation,
  preparationPaths,
  readPreparation,
  runPreparation,
  writePreparation,
} from "../src/preparation.js";

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
  assert.ok(windows.dir.startsWith(path.join("C:\\Users\\tester\\AppData\\Local", "plangolin", "Cache") + path.sep));
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
  assert.equal(renames[0][1], paths.result);
  assert.deepEqual(await readPreparation(root, record.fingerprint, { cacheRoot }), record);
  assert.equal(await readPreparation(root, "b".repeat(64), { cacheRoot }), null);
  assert.deepEqual(await fs.readdir(paths.dir), ["result.json"]);
});

test("rejects malformed, partial, wrong-version, and wrong-root results", async (t) => {
  const { root, cacheRoot } = await temporaryProject(t);
  const paths = preparationPaths(root, { cacheRoot });
  const fingerprint = "a".repeat(64);
  await fs.mkdir(paths.dir, { recursive: true });

  await fs.writeFile(paths.result, "{not json", "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(paths.result, JSON.stringify({ version: 1, fingerprint }), "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(paths.result, JSON.stringify({
    ...recordFor(root, cacheRoot, fingerprint), version: 2,
  }), "utf8");
  assert.equal(await readPreparation(root, fingerprint, { cacheRoot }), null);

  await fs.writeFile(paths.result, JSON.stringify({
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
  const progressText = await fs.readFile(paths.progress, "utf8");
  const progress = JSON.parse(progressText);
  assert.deepEqual(progress, {
    phase: "complete",
    revision: 5,
    elapsed: 0,
    counts: { moves: 1, dropped: 2 },
  });
  assert.ok(writtenProgress.every((entry) => !JSON.stringify(entry).includes("secret.js")));
  assert.doesNotMatch(progressText, /src\/api|private source|excerpt|sourcePath/);
  assert.deepEqual((await fs.readdir(paths.dir)).sort(), ["progress.json", "result.json"]);
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
    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.lock, JSON.stringify({
      version: 1,
      rootHash: paths.rootHash,
      token: `${scenario}-owner`,
      pid: 987_654,
      startedAt: scenario === "stale" ? 0 : 9_999,
      fingerprint: null,
    }));
    await fs.writeFile(path.join(paths.dir, "unrelated.json"), "keep");
    const doubles = preparationDoubles();

    const record = await runPreparation(root, {
      cacheRoot, ws: { root }, ...doubles,
      now: () => 10_000,
      staleMs: 100,
      processAlive: () => scenario === "stale",
    });

    assert.equal(record.version, 1);
    assert.equal(await fs.readFile(path.join(paths.dir, "unrelated.json"), "utf8"), "keep");
    await assert.rejects(fs.access(paths.lock), { code: "ENOENT" });
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

  await assert.rejects(fs.access(paths.lock), { code: "ENOENT" });
  await assert.rejects(fs.access(paths.result), { code: "ENOENT" });
  const progressText = await fs.readFile(paths.progress, "utf8");
  assert.deepEqual(JSON.parse(progressText), {
    phase: "failed", revision: 2, elapsed: 0, counts: {},
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

  await assert.rejects(fs.access(paths.lock), { code: "ENOENT" });
  assert.equal(JSON.parse(await fs.readFile(paths.progress, "utf8")).phase, "failed");
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

test("lock timing defaults are finite named public constants", () => {
  assert.ok(Number.isFinite(LOCK_STALE_MS) && LOCK_STALE_MS > 2_000);
  assert.ok(Number.isFinite(LOCK_POLL_MS) && LOCK_POLL_MS > 0);
});
