import { createHash, randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFileGraph, fingerprintGraph } from "./filegraph.js";
import { nodeWorkspace } from "./workspace.js";
import { discoverProject, nameProject, movesFromDiscovery } from "./adopt.js";

export const LOCK_STALE_MS = 30 * 60 * 1000;
export const LOCK_POLL_MS = 100;

const PREPARATION_VERSION = 1;
const sleepFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function hashRoot(root) {
  return createHash("sha256").update(path.resolve(root)).digest("hex");
}

function defaultCacheRoot({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.PLANGOLIN_CACHE_DIR) return env.PLANGOLIN_CACHE_DIR;
  if (platform === "darwin") return path.join(home, "Library", "Caches", "plangolin");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "plangolin", "Cache");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "plangolin");
}

export function preparationPaths(root, options = {}) {
  const cacheRoot = options.cacheRoot || defaultCacheRoot(options);
  const rootHash = hashRoot(root);
  const dir = path.join(cacheRoot, rootHash);
  return {
    rootHash,
    dir,
    lock: path.join(dir, "lock.json"),
    progress: path.join(dir, "progress.json"),
    result: path.join(dir, "result.json"),
  };
}

function validRecord(record, rootHash, fingerprint = record?.fingerprint) {
  return Boolean(
    record && typeof record === "object" && !Array.isArray(record) &&
    record.version === 1 &&
    record.rootHash === rootHash &&
    /^[0-9a-f]{64}$/.test(record.fingerprint || "") &&
    record.fingerprint === fingerprint &&
    Number.isFinite(record.createdAt) &&
    Array.isArray(record.moves) &&
    Array.isArray(record.dropped) &&
    (record.provider === null || typeof record.provider === "string") &&
    (record.model === null || typeof record.model === "string")
  );
}

export async function readPreparation(root, fingerprint, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  let text;
  try {
    text = await io.readFile(paths.result, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  return validRecord(record, paths.rootHash, fingerprint) ? record : null;
}

export async function writePreparation(root, record, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  if (!validRecord(record, paths.rootHash)) {
    throw new Error("refusing to cache an invalid preparation result");
  }
  await io.mkdir(paths.dir, { recursive: true });
  const temporary = path.join(paths.dir, `.result-${process.pid}-${randomUUID()}.tmp`);
  try {
    await io.writeFile(temporary, JSON.stringify(record), "utf8");
    await io.rename(temporary, paths.result);
  } catch (err) {
    await io.unlink(temporary).catch(() => {});
    throw err;
  }
  return record;
}

async function readLock(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  let text;
  try {
    text = await io.readFile(paths.lock, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { malformed: true };
  }
}

async function lockIsLive(lock, rootHash, options = {}) {
  if (!lock || lock.malformed || lock.version !== PREPARATION_VERSION ||
      lock.rootHash !== rootHash || typeof lock.token !== "string" ||
      !Number.isInteger(lock.pid) || lock.pid <= 0 || !Number.isFinite(lock.startedAt)) {
    return false;
  }
  const now = options.now || Date.now;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  if (Math.max(0, now() - lock.startedAt) > staleMs) return false;
  const processAlive = options.processAlive || processIsAlive;
  try {
    return Boolean(await processAlive(lock.pid));
  } catch {
    return false;
  }
}

async function acquireLock(root, fingerprint, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  const pid = options.pid || process.pid;
  await io.mkdir(paths.dir, { recursive: true });

  for (;;) {
    const token = randomUUID();
    const lock = {
      version: PREPARATION_VERSION,
      rootHash: paths.rootHash,
      token,
      pid,
      startedAt: now(),
      fingerprint: fingerprint || null,
    };
    const candidate = path.join(paths.dir, `.lock-${pid}-${token}.tmp`);
    await io.writeFile(candidate, JSON.stringify(lock), "utf8");
    try {
      await io.link(candidate, paths.lock);
      await io.unlink(candidate).catch(() => {});
      return { owner: lock, existing: null };
    } catch (err) {
      await io.unlink(candidate).catch(() => {});
      if (err.code !== "EEXIST") throw err;
    }

    const existing = await readLock(root, options);
    if (await lockIsLive(existing, paths.rootHash, options)) {
      return { owner: null, existing };
    }
    // Only the one cache lock is replaced. Another contender can win between
    // this unlink and the next exclusive link; EEXIST then makes us follow it.
    await io.unlink(paths.lock).catch((err) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}

async function updateOwnedLock(root, owner, fingerprint, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const current = await readLock(root, options);
  if (current?.token !== owner.token) throw new Error("preparation lock ownership was lost");
  const updated = { ...owner, fingerprint };
  const temporary = path.join(paths.dir, `.lock-update-${owner.token}.tmp`);
  try {
    await io.writeFile(temporary, JSON.stringify(updated), "utf8");
    await io.rename(temporary, paths.lock);
  } catch (err) {
    await io.unlink(temporary).catch(() => {});
    throw err;
  }
  return updated;
}

async function releaseOwnedLock(root, owner, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  let current;
  try {
    current = await readLock(root, options);
  } catch {
    return;
  }
  if (current?.token !== owner.token) return;
  await io.unlink(paths.lock).catch(() => {});
}

function boundedCounts(raw) {
  const allowed = new Set(["files", "links", "components", "moves", "dropped"]);
  const counts = {};
  if (!raw || typeof raw !== "object") return counts;
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.has(key) && Number.isFinite(value)) counts[key] = value;
  }
  return counts;
}

function progressWriter(root, startedAt, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  let revision = 0;
  const phases = new Set([
    "starting", "mapping_project", "grouping_components",
    "naming_and_matching", "complete", "failed",
  ]);

  return async ({ phase, counts } = {}) => {
    revision += 1;
    const record = {
      phase: phases.has(phase) ? phase : "working",
      revision,
      elapsed: Math.max(0, now() - startedAt),
      counts: boundedCounts(counts),
    };
    const temporary = path.join(paths.dir, `.progress-${process.pid}-${randomUUID()}.tmp`);
    try {
      await io.writeFile(temporary, JSON.stringify(record), "utf8");
      await io.rename(temporary, paths.progress);
    } catch {
      await io.unlink(temporary).catch(() => {});
    }
    return record;
  };
}

export async function followPreparation(root, fingerprint, options = {}) {
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const timeoutMs = options.timeoutMs ?? LOCK_STALE_MS;
  const began = now();

  for (;;) {
    const result = await readPreparation(root, fingerprint, options);
    if (result) return result;

    const lock = await readLock(root, options);
    if (!lock || !await lockIsLive(lock, paths.rootHash, options)) {
      return readPreparation(root, fingerprint, options);
    }
    if (now() - began >= timeoutMs) return null;
    // A live worker whose fingerprint is not known yet may turn out to match.
    // A known mismatch is still allowed to release its lock before we return,
    // avoiding a hot acquire/follow loop around somebody else's preparation.
    await sleep(pollMs);
  }
}

/** The public command's narrow startup observation: a live root-scoped worker
 * and a progress file that was written after that worker claimed the lock. */
export async function preparationStartup(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const lock = await readLock(root, options);
  if (!lock || !await lockIsLive(lock, paths.rootHash, options)) {
    return { live: false, ready: false };
  }

  let text;
  let stat;
  try {
    [text, stat] = await Promise.all([
      io.readFile(paths.progress, "utf8"),
      io.stat(paths.progress),
    ]);
  } catch (err) {
    if (err.code === "ENOENT") return { live: true, ready: false };
    return { live: true, ready: false };
  }
  let progress;
  try {
    progress = JSON.parse(text);
  } catch {
    return { live: true, ready: false };
  }
  const numericCounts = progress.counts && typeof progress.counts === "object" &&
    Object.values(progress.counts).every(Number.isFinite);
  const valid = typeof progress.phase === "string" &&
    Number.isInteger(progress.revision) && progress.revision >= 1 &&
    Number.isFinite(progress.elapsed) && numericCounts &&
    stat.mtimeMs >= lock.startedAt;
  return { live: true, ready: Boolean(valid) };
}

export async function runPreparation(root, options = {}) {
  const io = options.fs || nodeFs;
  const now = options.now || Date.now;
  const ws = options.ws || nodeWorkspace(root);
  const buildGraph = options.buildGraph || buildFileGraph;
  const discover = options.discover || discoverProject;
  const name = options.name || nameProject;
  const movesFrom = options.movesFrom || movesFromDiscovery;
  let graph;
  let fingerprint;
  let owner;
  let report;

  // The winner publishes lock + revision 1 before scanning. A racing worker
  // computes its fingerprint once, follows the winner if it matches, and only
  // takes over after that lock is gone or stale.
  for (;;) {
    const acquired = await acquireLock(root, fingerprint, options);
    if (acquired.owner) {
      owner = acquired.owner;
      break;
    }
    if (!graph) {
      graph = await buildGraph(ws);
      fingerprint = fingerprintGraph(graph);
    }
    const followed = await followPreparation(root, fingerprint, options);
    if (followed) return followed;
  }

  try {
    const paths = preparationPaths(root, options);
    await io.unlink(paths.progress).catch(() => {});
    report = progressWriter(root, owner.startedAt, options);
    await report({ phase: "starting", counts: {} });
    if (options.startupHoldMs > 0) {
      await (options.sleep || sleepFor)(options.startupHoldMs);
    }
    if (!graph) {
      graph = await buildGraph(ws);
      fingerprint = fingerprintGraph(graph);
    }
    owner = await updateOwnedLock(root, owner, fingerprint, options);

    const cached = await readPreparation(root, fingerprint, options);
    if (cached) {
      await report({
        phase: "complete",
        counts: { moves: cached.moves.length, dropped: cached.dropped.length },
      });
      return cached;
    }

    const discovery = await discover(ws, { graph, onProgress: report });
    let described = { blocks: [], labels: new Map(), dropped: [], provider: null, model: null };
    let moves = [];
    if (discovery.graph.files.length) {
      described = await name(discovery, { onProgress: report });
      ({ moves } = movesFrom(discovery, described));
    }
    const record = {
      version: PREPARATION_VERSION,
      rootHash: preparationPaths(root, options).rootHash,
      fingerprint,
      createdAt: now(),
      moves,
      dropped: [...discovery.dropped, ...described.dropped],
      provider: described.provider,
      model: described.model,
    };
    await writePreparation(root, record, options);
    await report({
      phase: "complete",
      counts: { moves: record.moves.length, dropped: record.dropped.length },
    });
    return record;
  } catch (err) {
    await report?.({ phase: "failed", counts: {} });
    throw err;
  } finally {
    if (owner) await releaseOwnedLock(root, owner, options);
  }
}
