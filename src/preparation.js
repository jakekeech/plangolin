import { createHash, randomUUID } from "node:crypto";
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
// Kept as a public compatibility name for callers that injected the previous
// stale threshold. A lease is now renewable and expires on this shorter TTL.
export const LOCK_STALE_MS = LEASE_TTL_MS;

const VERSION = 1;
const GENERATION_WIDTH = 12;
const LEASE_RE = /^lease-(\d{12})\.json$/;
const RESULT_RE = /^result-(\d{12})-([0-9a-f-]{36}|manual)\.json$/;
const TEMP_RE = /^\.tmp-(result|progress|lock-update)-(\d{12})-([0-9a-f-]{36})-[^.]+\.json$/;
const ACTIVE_PHASES = new Set([
  "starting", "working", "mapping_project", "grouping_components", "naming_and_matching",
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

export function preparationPaths(root, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = cachePathApi(platform);
  const cwd = options.cwd || process.cwd();
  const workspaceRoot = pathApi.resolve(cwd, root);
  const cacheRoot = pathApi.resolve(cwd, options.cacheRoot || defaultCacheRoot(options));
  const comparedWorkspace = platform === "win32" ? workspaceRoot.toLowerCase() : workspaceRoot;
  const comparedCache = platform === "win32" ? cacheRoot.toLowerCase() : cacheRoot;
  if (comparedCache === comparedWorkspace || comparedCache.startsWith(comparedWorkspace + pathApi.sep)) {
    throw new Error("the preparation cache must be outside the workspace root");
  }
  const rootHash = createHash("sha256").update(workspaceRoot).digest("hex");
  const dir = pathApi.join(cacheRoot, rootHash);
  return { root: workspaceRoot, cacheRoot, rootHash, dir };
}

function leasePath(paths, generation) {
  return path.join(paths.dir, `lease-${generationName(generation)}.json`);
}

function heartbeatPath(paths, lease) {
  return path.join(paths.dir, `heartbeat-${generationName(lease.generation)}-${lease.owner}.json`);
}

function progressPath(paths, lease) {
  return path.join(paths.dir, `progress-${generationName(lease.generation)}-${lease.owner}.json`);
}

function resultPath(paths, lease = { generation: 0, owner: "manual" }) {
  return path.join(paths.dir, `result-${generationName(lease.generation)}-${lease.owner}.json`);
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

export async function readPreparation(root, fingerprint, options = {}) {
  if (typeof fingerprint !== "string" || !fingerprint) {
    throw new Error("an expected preparation fingerprint is required");
  }
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const candidates = (await namesIn(paths.dir, io)).flatMap((name) => {
    const match = RESULT_RE.exec(name);
    return match ? [{ name, generation: Number(match[1]) }] : [];
  }).sort((a, b) => b.generation - a.generation);
  for (const candidate of candidates) {
    const record = await readJson(path.join(paths.dir, candidate.name), io);
    if (validRecord(record, paths.rootHash, fingerprint)) return record;
  }
  return null;
}

async function atomicOwnerJson(paths, kind, lease, value, io, beforeRename) {
  const temporary = path.join(
    paths.dir,
    `.tmp-${kind}-${generationName(lease.generation)}-${lease.owner}-${randomUUID()}.json`,
  );
  try {
    await io.writeFile(temporary, JSON.stringify(value), "utf8");
    if (beforeRename) await beforeRename();
    const final = kind === "result" ? resultPath(paths, lease)
      : kind === "progress" ? progressPath(paths, lease)
      : heartbeatPath(paths, lease);
    await io.rename(temporary, final);
  } catch (err) {
    await io.unlink(temporary).catch(() => {});
    throw err;
  }
}

export async function writePreparation(root, record, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  if (!validRecord(record, paths.rootHash)) {
    throw new Error("refusing to cache an invalid preparation result");
  }
  await io.mkdir(paths.dir, { recursive: true });
  const lease = options.lease || { generation: 0, owner: "manual" };
  await atomicOwnerJson(paths, "result", lease, record, io);
  return record;
}

function validLease(raw, generation, rootHash) {
  return Boolean(
    raw && raw.version === VERSION && raw.rootHash === rootHash &&
    raw.generation === generation && /^[0-9a-f-]{36}$/.test(raw.owner || "") &&
    Number.isInteger(raw.pid) && raw.pid > 0 && Number.isFinite(raw.startedAt)
  );
}

async function winningLease(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const generations = (await namesIn(paths.dir, io)).flatMap((name) => {
    const match = LEASE_RE.exec(name);
    return match ? [Number(match[1])] : [];
  });
  if (!generations.length) return null;
  const generation = Math.max(...generations);
  const raw = await readJson(leasePath(paths, generation), io);
  if (!validLease(raw, generation, paths.rootHash)) return { generation, invalid: true };
  return raw;
}

function sameLease(left, right) {
  return Boolean(left && right && !left.invalid && !right.invalid &&
    left.generation === right.generation && left.owner === right.owner);
}

function timestampCurrent(timestamp, now, ttl = LEASE_TTL_MS, skew = MAX_CLOCK_SKEW_MS) {
  return Number.isFinite(timestamp) && timestamp <= now + skew && now - timestamp <= ttl;
}

function timestampNotFuture(timestamp, now, skew = MAX_CLOCK_SKEW_MS) {
  return Number.isFinite(timestamp) && timestamp <= now + skew;
}

async function leaseIsLive(root, lease, options = {}) {
  if (!lease || lease.invalid) return false;
  const io = options.fs || nodeFs;
  const now = options.now || Date.now;
  const paths = preparationPaths(root, options);
  const skew = options.maxClockSkewMs ?? MAX_CLOCK_SKEW_MS;
  const ttl = options.leaseTtlMs ?? LEASE_TTL_MS;
  if (!timestampNotFuture(lease.startedAt, now(), skew)) return false;
  const progress = await readJson(progressPath(paths, lease), io);
  if (progress?.owner === lease.owner && progress?.generation === lease.generation &&
      (progress.phase === "complete" || progress.phase === "failed")) return false;
  const heartbeat = await readJson(heartbeatPath(paths, lease), io);
  const renewedAt = heartbeat?.owner === lease.owner && heartbeat?.generation === lease.generation
    ? heartbeat.renewedAt : lease.startedAt;
  if (!timestampCurrent(renewedAt, now(), ttl, skew)) return false;
  const processAlive = options.processAlive || processIsAlive;
  try {
    return Boolean(await processAlive(lease.pid));
  } catch {
    return false;
  }
}

async function renewLease(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const current = await winningLease(root, options);
  if (!sameLease(current, lease)) return false;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  await atomicOwnerJson(paths, "lock-update", lease, {
    version: VERSION,
    generation: lease.generation,
    owner: lease.owner,
    renewedAt: now(),
  }, io);
  return true;
}

function startHeartbeat(root, lease, options = {}) {
  const every = options.setInterval || setInterval;
  const cancel = options.clearInterval || clearInterval;
  const interval = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const timer = every(() => { renewLease(root, lease, options).catch(() => {}); }, interval);
  timer?.unref?.();
  return () => cancel(timer);
}

async function cleanupOrphanTemps(root, lease, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  for (const name of await namesIn(paths.dir, io)) {
    const match = TEMP_RE.exec(name);
    if (!match) continue;
    const generation = Number(match[2]);
    const owner = match[3];
    if (generation === lease.generation && owner === lease.owner) continue;
    const file = path.join(paths.dir, name);
    let stat;
    try {
      stat = await io.stat(file);
    } catch {
      continue;
    }
    const staleMs = options.orphanTempStaleMs ?? ORPHAN_TEMP_STALE_MS;
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
    if (await leaseIsLive(root, current, options)) return { owner: null, existing: current };
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
      await io.writeFile(leasePath(paths, generation), JSON.stringify(lease), { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    await renewLease(root, lease, options);
    await cleanupOrphanTemps(root, lease, options);
    return { owner: lease, existing: null };
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
      owner: lease.owner,
      generation: lease.generation,
      phase: PROGRESS_PHASES.has(phase) ? phase : "working",
      revision,
      elapsed: Math.max(0, updatedAt - lease.startedAt),
      updatedAt,
      counts: boundedCounts(counts),
    };
    try {
      await atomicOwnerJson(paths, "progress", lease, record, io);
    } catch {
      // Progress is observational. It must never control preparation work.
    }
    return record;
  };
}

export async function followPreparation(root, fingerprint, options = {}) {
  if (typeof fingerprint !== "string" || !fingerprint) {
    throw new Error("an expected preparation fingerprint is required");
  }
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const timeoutMs = options.timeoutMs ?? LOCK_STALE_MS;
  const began = now();
  for (;;) {
    const result = await readPreparation(root, fingerprint, options);
    if (result) return result;
    const lease = await winningLease(root, options);
    if (!await leaseIsLive(root, lease, options)) return readPreparation(root, fingerprint, options);
    if (now() - began >= timeoutMs) return null;
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
  if (!await leaseIsLive(root, before, options)) return { live: false, ready: false };
  const progress = await readJson(progressPath(paths, before), io);
  const after = await winningLease(root, options);
  if (!sameLease(before, after)) {
    return { live: await leaseIsLive(root, after, options), ready: false };
  }
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
  await atomicOwnerJson(paths, "result", lease, record, io, async () => {
    const current = await winningLease(root, options);
    if (!sameLease(current, lease)) throw new LostLeaseError();
  });
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

  for (;;) {
    const acquired = await acquireLease(workspaceRoot, options);
    if (acquired.owner) {
      lease = acquired.owner;
      break;
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
    stopHeartbeat = startHeartbeat(workspaceRoot, lease, options);
    if (options.startupHoldMs > 0) await (options.sleep || sleepFor)(options.startupHoldMs);
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
      version: VERSION,
      rootHash: preparationPaths(workspaceRoot, options).rootHash,
      fingerprint,
      createdAt: now(),
      moves,
      dropped: [...discovery.dropped, ...described.dropped],
      provider: described.provider,
      model: described.model,
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
