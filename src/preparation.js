import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFileGraph, fingerprintGraph } from "./filegraph.js";
import { nodeWorkspace } from "./workspace.js";
import { discoverProject, nameProject, movesFromDiscovery } from "./adopt.js";

export const LEASE_TTL_MS = 15_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const MAX_CLOCK_SKEW_MS = 1_000;
export const ORPHAN_TEMP_STALE_MS = 60_000;
export const LOCK_POLL_MS = 100;
export const LOCK_STALE_MS = LEASE_TTL_MS;

const VERSION = 1;
const GENERATION_WIDTH = 12;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LEASE_RE = /^lease-(\d{12})\.claim$/;
const OWNER_RE = new RegExp(`^(${UUID})-(\\d+)-(\\d+)\\.owner$`);
const RESULT_RE = new RegExp(`^result-(\\d{12})-(${UUID}|manual)\\.json$`);
const COMPLETION_RE = new RegExp(`^complete-(\\d{12})-(${UUID})\\.done$`);
const HEARTBEAT_RE = new RegExp(`^heartbeat-(\\d{12})-(${UUID})-(\\d{12})-(\\d+)\\.beat$`);
const TEMP_RE = new RegExp(
  `^\\.tmp-(result|progress|lock-update)-(\\d{12})-(${UUID}|manual)-[^.]+\\.json$`,
);
const ACTIVE_PHASES = new Set([
  "starting", "working", "mapping_project", "grouping_components", "naming_components",
  "naming_and_matching",
]);
const PROGRESS_PHASES = new Set([...ACTIVE_PHASES, "complete", "failed"]);
const sleepFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class LostLeaseError extends Error {
  constructor() {
    super("preparation lease was fenced by a newer owner");
    this.lostLease = true;
  }
}

export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function generationName(generation) {
  return String(generation).padStart(GENERATION_WIDTH, "0");
}

function cachePathApi(platform) {
  return platform === "win32" ? path.win32 : path;
}

function defaultCacheRoot({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const pathApi = cachePathApi(platform);
  if (env.PLANGOLIN_CACHE_DIR) return env.PLANGOLIN_CACHE_DIR;
  if (platform === "darwin") return pathApi.join(home, "Library", "Caches", "plangolin");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || pathApi.join(home, "AppData", "Local");
    return pathApi.join(local, "plangolin", "Cache");
  }
  return pathApi.join(env.XDG_CACHE_HOME || pathApi.join(home, ".cache"), "plangolin");
}

function physicalPath(target) {
  let existing = target;
  const suffix = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const physical = existsSync(existing) ? realpathSync(existing) : path.resolve(existing);
  return path.resolve(physical, ...suffix);
}

function inside(child, parent, platform) {
  let comparedChild = child;
  let comparedParent = parent;
  if (platform === "win32") {
    comparedChild = child.toLowerCase();
    comparedParent = parent.toLowerCase();
  }
  return comparedChild === comparedParent || comparedChild.startsWith(comparedParent + path.sep);
}

export function preparationPaths(root, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = cachePathApi(platform);
  const cwd = options.cwd || process.cwd();
  const workspaceRoot = pathApi.resolve(cwd, root);
  const cacheRoot = pathApi.resolve(cwd, options.cacheRoot || defaultCacheRoot(options));
  if (options.platform === undefined) {
    const physicalWorkspace = physicalPath(workspaceRoot);
    const physicalCache = physicalPath(cacheRoot);
    if (inside(physicalCache, physicalWorkspace, platform)) {
      throw new Error("the preparation cache must be outside the workspace root");
    }
  } else {
    const comparedWorkspace = platform === "win32" ? workspaceRoot.toLowerCase() : workspaceRoot;
    const comparedCache = platform === "win32" ? cacheRoot.toLowerCase() : cacheRoot;
    if (comparedCache === comparedWorkspace || comparedCache.startsWith(comparedWorkspace + pathApi.sep)) {
      throw new Error("the preparation cache must be outside the workspace root");
    }
  }
  const rootHash = createHash("sha256").update(workspaceRoot).digest("hex");
  return { root: workspaceRoot, cacheRoot, rootHash, dir: pathApi.join(cacheRoot, rootHash) };
}

function claimName(generation) {
  return `lease-${generationName(generation)}.claim`;
}

function claimPath(paths, lease) {
  return path.join(paths.dir, claimName(lease.generation));
}

function ownerName(lease) {
  return `${lease.owner}-${lease.pid}-${lease.startedAt}.owner`;
}

function progressPath(paths, lease) {
  return path.join(paths.dir, `progress-${generationName(lease.generation)}-${lease.owner}.json`);
}

function resultPath(paths, lease = { generation: 0, owner: "manual" }) {
  return path.join(paths.dir, `result-${generationName(lease.generation)}-${lease.owner}.json`);
}

function completionPath(paths, lease) {
  return path.join(paths.dir, `complete-${generationName(lease.generation)}-${lease.owner}.done`);
}

async function namesIn(dir, io) {
  try {
    return await io.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readJson(file, io) {
  let text;
  try {
    text = await io.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validRecord(record, rootHash, fingerprint = record?.fingerprint) {
  return Boolean(
    record && typeof record === "object" && !Array.isArray(record) &&
    record.version === VERSION && record.rootHash === rootHash &&
    /^[0-9a-f]{64}$/.test(record.fingerprint || "") && record.fingerprint === fingerprint &&
    Number.isFinite(record.createdAt) && Array.isArray(record.moves) && Array.isArray(record.dropped) &&
    (record.provider === null || typeof record.provider === "string") &&
    (record.model === null || typeof record.model === "string")
  );
}

function generationsFrom(names) {
  return names.flatMap((name) => {
    const match = LEASE_RE.exec(name);
    return match ? [{ generation: Number(match[1]), name }] : [];
  });
}

async function winningLease(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const generations = generationsFrom(await namesIn(paths.dir, io));
  if (!generations.length) return null;
  const generation = Math.max(...generations.map((entry) => entry.generation));
  const slot = path.join(paths.dir, claimName(generation));
  const entries = await namesIn(slot, io);
  const owners = entries.flatMap((name) => {
    const match = OWNER_RE.exec(name);
    const pid = Number(match?.[2]);
    const startedAt = Number(match?.[3]);
    return match && Number.isSafeInteger(pid) && pid > 0 &&
      Number.isSafeInteger(startedAt) && startedAt >= 0 ? [{
      version: VERSION, rootHash: paths.rootHash, generation,
      owner: match[1], pid, startedAt, name,
    }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (owners.length) return owners[0];
  if (entries.length) return { generation, invalid: true };
  let stat;
  try { stat = await io.stat(slot); }
  catch { return { generation, incomplete: true, reservedAt: 0 }; }
  return { generation, incomplete: true, reservedAt: stat.mtimeMs };
}

export async function preparationGeneration(root, options = {}) {
  return (await winningLease(root, options))?.generation || 0;
}

function sameLease(left, right) {
  return Boolean(left && right && !left.invalid && !right.invalid &&
    left.generation === right.generation && left.owner === right.owner);
}

async function completionExists(paths, lease, io) {
  try {
    await io.access(completionPath(paths, lease));
    return true;
  } catch {
    return false;
  }
}

export async function readPreparation(root, fingerprint, options = {}) {
  if (typeof fingerprint !== "string" || !fingerprint) {
    throw new Error("an expected preparation fingerprint is required");
  }
  const lease = await winningLease(root, options);
  return readCompletedLease(root, lease, { ...options, expectedFingerprint: fingerprint });
}

async function readCompletedLease(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  if (!lease || lease.incomplete || lease.invalid || !await completionExists(paths, lease, io)) return null;
  const record = await readJson(resultPath(paths, lease), io);
  const fingerprint = options.expectedFingerprint ?? record?.fingerprint;
  if (!validRecord(record, paths.rootHash, fingerprint)) return null;
  return sameLease(await winningLease(root, options), lease) ? record : null;
}

async function atomicOwnerJson(paths, kind, lease, value, io, beforeRename) {
  const temporary = path.join(
    paths.dir,
    `.tmp-${kind}-${generationName(lease.generation)}-${lease.owner}-${randomUUID()}.json`,
  );
  try {
    await io.writeFile(temporary, JSON.stringify(value), "utf8");
    if (beforeRename) await beforeRename();
    const final = kind === "result" ? resultPath(paths, lease) : progressPath(paths, lease);
    await io.rename(temporary, final);
  } catch (err) {
    await io.unlink(temporary).catch(() => {});
    throw err;
  }
}

export async function writePreparation(root, record, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  if (!validRecord(record, paths.rootHash)) throw new Error("refusing to cache an invalid preparation result");
  await io.mkdir(paths.dir, { recursive: true });
  let lease = options.lease;
  if (!lease) {
    const acquired = await acquireLease(root, { ...options, forceNew: true });
    lease = acquired.owner;
    if (!lease) throw new Error("could not acquire a preparation lease for writing");
  }
  await atomicOwnerJson(paths, "result", lease, record, io);
  await io.mkdir(completionPath(paths, lease)).catch((err) => {
    if (err.code !== "EEXIST") throw err;
  });
  return record;
}

function timestampCurrent(timestamp, now, ttl = LEASE_TTL_MS, skew = MAX_CLOCK_SKEW_MS) {
  return Number.isFinite(timestamp) && timestamp <= now + skew && now - timestamp <= ttl;
}

function timestampNotFuture(timestamp, now, skew = MAX_CLOCK_SKEW_MS) {
  return Number.isFinite(timestamp) && timestamp <= now + skew;
}

async function newestHeartbeat(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const prefix = `heartbeat-${generationName(lease.generation)}-${lease.owner}-`;
  const records = (await namesIn(paths.dir, io)).flatMap((name) => {
    if (!name.startsWith(prefix)) return [];
    const match = HEARTBEAT_RE.exec(name);
    return match ? [{ sequence: Number(match[3]), renewedAt: Number(match[4]) }] : [];
  }).sort((a, b) => b.sequence - a.sequence || b.renewedAt - a.renewedAt);
  return records[0] || null;
}

async function leaseIsLive(root, lease, options = {}) {
  if (!lease || lease.invalid) return false;
  const io = options.fs || nodeFs;
  const now = options.now || Date.now;
  const paths = preparationPaths(root, options);
  const skew = options.maxClockSkewMs ?? MAX_CLOCK_SKEW_MS;
  const ttl = options.leaseTtlMs ?? LEASE_TTL_MS;
  if (lease.incomplete) return timestampCurrent(lease.reservedAt, now(), ttl, skew);
  if (!timestampNotFuture(lease.startedAt, now(), skew)) return false;
  const progress = await readJson(progressPath(paths, lease), io);
  if (progress?.owner === lease.owner && progress?.generation === lease.generation &&
      (progress.phase === "complete" || progress.phase === "failed")) return false;
  const heartbeat = await newestHeartbeat(root, lease, options);
  const renewedAt = heartbeat?.renewedAt ?? lease.startedAt;
  if (!timestampCurrent(renewedAt, now(), ttl, skew)) return false;
  const processAlive = options.processAlive || processIsAlive;
  try {
    return Boolean(await processAlive(lease.pid));
  } catch {
    return false;
  }
}

function leaseRenewer(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  let sequence = 0;
  return async () => {
    const current = await winningLease(root, options);
    if (!sameLease(current, lease)) return false;
    sequence += 1;
    const renewedAt = now();
    const name = `heartbeat-${generationName(lease.generation)}-${lease.owner}-` +
      `${generationName(sequence)}-${renewedAt}.beat`;
    try {
      await io.mkdir(path.join(paths.dir, name));
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    return sameLease(await winningLease(root, options), lease);
  };
}

function startHeartbeat(renew, options = {}) {
  const every = options.setInterval || setInterval;
  const cancel = options.clearInterval || clearInterval;
  const interval = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const timer = every(() => { renew().catch(() => {}); }, interval);
  timer?.unref?.();
  return () => cancel(timer);
}

async function cleanupOrphanTemps(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  const staleMs = options.orphanTempStaleMs ?? ORPHAN_TEMP_STALE_MS;
  for (const name of await namesIn(paths.dir, io)) {
    const match = TEMP_RE.exec(name);
    if (!match) continue;
    const generation = Number(match[2]);
    const owner = match[3];
    if (generation === lease.generation && owner === lease.owner) continue;
    const file = path.join(paths.dir, name);
    let stat;
    try { stat = await io.stat(file); } catch { continue; }
    if (now() - stat.mtimeMs <= staleMs) continue;
    await io.unlink(file).catch(() => {});
  }
}

async function acquireLease(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  await io.mkdir(paths.dir, { recursive: true });
  for (;;) {
    const current = await winningLease(root, options);
    const completed = current && !current.incomplete && await completionExists(paths, current, io);
    if (completed && !options.forceNew) return { owner: null, completed: current };
    if (!completed && await leaseIsLive(root, current, options)) return { owner: null, existing: current };
    const generation = (current?.generation || 0) + 1;
    const lease = {
      version: VERSION,
      rootHash: paths.rootHash,
      generation,
      owner: options.ownerToken || randomUUID(),
      pid: options.pid || process.pid,
      startedAt: now(),
    };
    try {
      await io.mkdir(claimPath(paths, lease));
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    try {
      await io.mkdir(path.join(claimPath(paths, lease), ownerName(lease)));
    } catch {
      return { owner: null, fencedBy: await winningLease(root, options) };
    }
    if (!sameLease(await winningLease(root, options), lease)) continue;
    const renew = leaseRenewer(root, lease, options);
    if (!await renew()) return { owner: null, fencedBy: await winningLease(root, options) };
    if (!sameLease(await winningLease(root, options), lease)) {
      return { owner: null, fencedBy: await winningLease(root, options) };
    }
    await cleanupOrphanTemps(root, lease, options);
    return { owner: lease, renew, existing: null };
  }
}

async function followLeaseCompletion(root, lease, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const timeoutMs = options.timeoutMs;
  const began = now();
  for (;;) {
    const current = await winningLease(root, options);
    if (!sameLease(current, lease)) return null;
    const record = await readCompletedLease(root, lease, options);
    if (record) return record;
    if (!await leaseIsLive(root, lease, options) ||
        (Number.isFinite(timeoutMs) && now() - began >= timeoutMs)) return null;
    await sleep(pollMs);
  }
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

function progressWriter(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  let revision = 0;
  return async ({ phase, counts } = {}) => {
    revision += 1;
    const updatedAt = now();
    const record = {
      owner: lease.owner, generation: lease.generation,
      phase: PROGRESS_PHASES.has(phase) ? phase : "working",
      revision, elapsed: Math.max(0, updatedAt - lease.startedAt), updatedAt,
      counts: boundedCounts(counts),
    };
    try { await atomicOwnerJson(paths, "progress", lease, record, io); } catch {}
    return record;
  };
}

async function livePreparationProgress(root, lease, options = {}) {
  if (!lease || lease.invalid || lease.incomplete) return null;
  const io = options.fs || nodeFs;
  const now = options.now || Date.now;
  const paths = preparationPaths(root, options);
  const progress = await readJson(progressPath(paths, lease), io);
  if (!progress || progress.owner !== lease.owner || progress.generation !== lease.generation ||
      !ACTIVE_PHASES.has(progress.phase) || !Number.isInteger(progress.revision) || progress.revision < 1 ||
      !Number.isFinite(progress.elapsed) || progress.elapsed < 0 ||
      !timestampCurrent(progress.updatedAt, now(), options.leaseTtlMs ?? LEASE_TTL_MS,
        options.maxClockSkewMs ?? MAX_CLOCK_SKEW_MS)) return null;
  if (!sameLease(await winningLease(root, options), lease) || !await leaseIsLive(root, lease, options)) return null;
  return {
    phase: progress.phase,
    revision: progress.revision,
    elapsed: progress.elapsed,
    counts: boundedCounts(progress.counts),
  };
}

function reportFollowProgress(onProgress, progress) {
  if (!onProgress || !progress) return;
  try {
    Promise.resolve(onProgress(progress)).catch(() => {});
  } catch {
    // A progress observer cannot interrupt preparation following.
  }
}

export async function followPreparation(root, fingerprint, options = {}) {
  if (typeof fingerprint !== "string" || !fingerprint) {
    throw new Error("an expected preparation fingerprint is required");
  }
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const timeoutMs = options.timeoutMs;
  const began = now();
  let reportedRevision = 0;
  for (;;) {
    const result = await readPreparation(root, fingerprint, options);
    if (result) return result;
    const lease = await winningLease(root, options);
    if (!await leaseIsLive(root, lease, options)) return readPreparation(root, fingerprint, options);
    const progress = await livePreparationProgress(root, lease, options);
    if (progress && progress.revision > reportedRevision) {
      reportFollowProgress(options.onProgress, progress);
      reportedRevision = progress.revision;
    }
    if (Number.isFinite(timeoutMs) && now() - began >= timeoutMs) return null;
    await sleep(pollMs);
  }
}

export async function preparationStartup(root, options = {}) {
  const io = options.fs || nodeFs;
  const now = options.now || Date.now;
  const skew = options.maxClockSkewMs ?? MAX_CLOCK_SKEW_MS;
  const ttl = options.leaseTtlMs ?? LEASE_TTL_MS;
  const paths = preparationPaths(root, options);
  const before = await winningLease(root, options);
  if (!await leaseIsLive(root, before, options)) {
    const minimum = options.completedAfterGeneration;
    if (!before || before.invalid || !Number.isSafeInteger(minimum) || before.generation <= minimum) {
      return { live: false, ready: false };
    }
    const progress = await readJson(progressPath(paths, before), io);
    const completed = await readCompletedLease(root, before, options);
    const ready = Boolean(
      completed && progress && progress.owner === before.owner &&
      progress.generation === before.generation && progress.phase === "complete" &&
      Number.isInteger(progress.revision) && progress.revision >= 1
    );
    return { live: false, ready };
  }
  const progress = await readJson(progressPath(paths, before), io);
  const after = await winningLease(root, options);
  if (!sameLease(before, after)) return { live: await leaseIsLive(root, after, options), ready: false };
  if (!await leaseIsLive(root, after, options)) return { live: false, ready: false };
  const ready = Boolean(
    progress && progress.owner === after.owner && progress.generation === after.generation &&
    ACTIVE_PHASES.has(progress.phase) && Number.isInteger(progress.revision) && progress.revision >= 1 &&
    Number.isFinite(progress.elapsed) && progress.counts && typeof progress.counts === "object" &&
    Object.values(progress.counts).every(Number.isFinite) &&
    progress.updatedAt >= after.startedAt - skew && timestampCurrent(progress.updatedAt, now(), ttl, skew)
  );
  return { live: true, ready };
}

async function publishOwnedResult(root, lease, record, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  await atomicOwnerJson(paths, "result", lease, record, io);
  if (!sameLease(await winningLease(root, options), lease)) throw new LostLeaseError();
  try {
    await io.mkdir(completionPath(paths, lease));
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  if (!sameLease(await winningLease(root, options), lease)) throw new LostLeaseError();
}

export async function runPreparation(root, options = {}) {
  const now = options.now || Date.now;
  const workspaceRoot = preparationPaths(root, options).root;
  const ws = options.ws || nodeWorkspace(workspaceRoot);
  const buildGraph = options.buildGraph || buildFileGraph;
  const discover = options.discover || discoverProject;
  const name = options.name || nameProject;
  const movesFrom = options.movesFrom || movesFromDiscovery;
  let graph;
  let fingerprint;
  let lease;
  let report;
  let stopHeartbeat = () => {};
  let forceNew = false;
  let cachedRecord = null;

  for (;;) {
    const acquired = await acquireLease(workspaceRoot, { ...options, forceNew });
    forceNew = false;
    if (acquired.owner) {
      lease = acquired.owner;
      stopHeartbeat = startHeartbeat(acquired.renew, options);
      break;
    }
    if (acquired.fencedBy) {
      const followed = await followLeaseCompletion(workspaceRoot, acquired.fencedBy, options);
      if (followed) return followed;
      continue;
    }
    if (acquired.completed) {
      if (!graph) {
        graph = await buildGraph(ws);
        fingerprint = fingerprintGraph(graph);
      }
      const cached = await readPreparation(workspaceRoot, fingerprint, options);
      if (cached) cachedRecord = cached;
      forceNew = true;
      continue;
    }
    if (!graph) {
      graph = await buildGraph(ws);
      fingerprint = fingerprintGraph(graph);
    }
    const followed = await followPreparation(workspaceRoot, fingerprint, options);
    if (followed) return followed;
  }

  try {
    report = progressWriter(workspaceRoot, lease, options);
    await report({ phase: "starting", counts: {} });
    if (options.startupHoldMs > 0) await (options.sleep || sleepFor)(options.startupHoldMs);
    if (cachedRecord) {
      await publishOwnedResult(workspaceRoot, lease, cachedRecord, options);
      await report({
        phase: "complete",
        counts: { moves: cachedRecord.moves.length, dropped: cachedRecord.dropped.length },
      });
      return cachedRecord;
    }
    if (!graph) {
      graph = await buildGraph(ws);
      fingerprint = fingerprintGraph(graph);
    }
    const cached = await readPreparation(workspaceRoot, fingerprint, options);
    if (cached) {
      await report({ phase: "complete", counts: { moves: cached.moves.length, dropped: cached.dropped.length } });
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
      version: VERSION, rootHash: preparationPaths(workspaceRoot, options).rootHash,
      fingerprint, createdAt: now(), moves,
      dropped: [...discovery.dropped, ...described.dropped],
      provider: described.provider, model: described.model,
    };
    await publishOwnedResult(workspaceRoot, lease, record, options);
    await report({ phase: "complete", counts: { moves: record.moves.length, dropped: record.dropped.length } });
    return record;
  } catch (err) {
    await report?.({ phase: "failed", counts: {} });
    if (err.lostLease && fingerprint) {
      const replacement = await readPreparation(workspaceRoot, fingerprint, options);
      if (replacement) return replacement;
    }
    throw err;
  } finally {
    stopHeartbeat();
  }
}
