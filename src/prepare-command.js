import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import {
  MAX_CLOCK_SKEW_MS,
  preparationGeneration,
  preparationPaths,
  preparationStartup,
  processIsAlive,
  runPreparation,
} from "./preparation.js";

export const PREPARE_START_TIMEOUT_MS = 2_000;
export const PREPARE_START_POLL_MS = 25;
export const LAUNCHER_RESERVATION_MS = 10_000;
export const WORKER_STARTUP_HOLD_MS = 100;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LAUNCHER_RE = /^launcher-(\d{12})\.claim$/;
const LAUNCHER_OWNER_RE = new RegExp(`^(${UUID})-(\\d+)-(\\d+)\\.owner$`);
const LAUNCHER_CHILD_RE = new RegExp(`^child-(${UUID})-(\\d+)\\.worker$`);
const CURRENT_CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));
const sleepFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function absoluteRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("preparation requires an absolute workspace root");
  }
  return path.resolve(root);
}

async function launcherNames(dir, io) {
  try { return await io.readdir(dir); }
  catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function launcherClaims(names, rootHash) {
  return names.flatMap((name) => {
    const match = LAUNCHER_RE.exec(name);
    return match ? [{ version: 1, rootHash, generation: Number(match[1]), name }] : [];
  });
}

async function currentLauncher(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const reservations = launcherClaims(await launcherNames(paths.dir, io), paths.rootHash);
  if (!reservations.length) return null;
  const generation = Math.max(...reservations.map((reservation) => reservation.generation));
  const slot = path.join(paths.dir, `launcher-${String(generation).padStart(12, "0")}.claim`);
  const entries = await launcherNames(slot, io);
  const owners = entries.flatMap((name) => {
    const match = LAUNCHER_OWNER_RE.exec(name);
    const pid = Number(match?.[2]);
    const createdAt = Number(match?.[3]);
    return match && Number.isSafeInteger(pid) && pid > 0 &&
      Number.isSafeInteger(createdAt) && createdAt >= 0 ? [{
      version: 1, rootHash: paths.rootHash, generation,
      owner: match[1], pid, createdAt, name,
    }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (owners.length) {
    const reservation = owners[0];
    const child = entries.flatMap((name) => {
      const match = LAUNCHER_CHILD_RE.exec(name);
      const pid = Number(match?.[2]);
      return match && match[1] === reservation.owner &&
        Number.isSafeInteger(pid) && pid > 0 ? [{ pid, name }] : [];
    }).sort((a, b) => a.name.localeCompare(b.name))[0];
    return { ...reservation, childPid: child?.pid };
  }
  if (entries.length) return { generation, invalid: true, createdAt: 0 };
  let stat;
  try { stat = await io.stat(slot); }
  catch { return { generation, incomplete: true, createdAt: 0 }; }
  return { generation, incomplete: true, createdAt: stat.mtimeMs };
}

function timestampLive(timestamp, now) {
  return Number.isFinite(timestamp) && timestamp <= now + MAX_CLOCK_SKEW_MS &&
    now - timestamp <= LAUNCHER_RESERVATION_MS;
}

async function launcherLive(reservation, options = {}) {
  if (!reservation || reservation.invalid) return false;
  const now = options.now || Date.now;
  const observedAt = now();
  if (!Number.isFinite(reservation.createdAt) ||
      reservation.createdAt > observedAt + MAX_CLOCK_SKEW_MS) return false;
  if (reservation.incomplete) return timestampLive(reservation.createdAt, observedAt);
  const processAlive = options.processAlive || processIsAlive;
  try {
    if (reservation.childPid) return Boolean(await processAlive(reservation.childPid));
    if (await processAlive(reservation.pid)) return true;
  } catch {
    return false;
  }
  return timestampLive(reservation.createdAt, observedAt);
}

function sameLauncher(left, right) {
  return Boolean(left && right && !left.invalid && !right.invalid &&
    left.generation === right.generation && left.owner === right.owner);
}

async function acquireLauncher(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  await io.mkdir(paths.dir, { recursive: true });
  for (;;) {
    const current = await currentLauncher(root, options);
    if (await launcherLive(current, options)) return { owner: null, existing: current };
    const reservation = {
      version: 1,
      rootHash: paths.rootHash,
      generation: (current?.generation || 0) + 1,
      owner: options.launcherToken || randomUUID(),
      pid: options.pid || process.pid,
      createdAt: now(),
    };
    const slot = path.join(
      paths.dir,
      `launcher-${String(reservation.generation).padStart(12, "0")}.claim`,
    );
    try {
      await io.mkdir(slot);
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    try {
      await io.mkdir(path.join(
        slot,
        `${reservation.owner}-${reservation.pid}-${reservation.createdAt}.owner`,
      ));
    } catch {
      return { owner: null, existing: await currentLauncher(root, options) };
    }
    const winner = await currentLauncher(root, options);
    if (!sameLauncher(winner, reservation)) continue;
    return { owner: reservation, existing: null };
  }
}

async function stillOwnsLauncher(root, reservation, options = {}) {
  const current = await currentLauncher(root, options);
  return sameLauncher(current, reservation) && await launcherLive(current, options);
}

async function handLauncherToChild(root, reservation, child, options = {}) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) {
    throw new Error("the preparation worker did not expose a valid process id");
  }
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const slot = path.join(
    paths.dir,
    `launcher-${String(reservation.generation).padStart(12, "0")}.claim`,
  );
  await io.mkdir(path.join(slot, `child-${reservation.owner}-${child.pid}.worker`));
}

export async function runPrepareCommand(root, options = {}) {
  let workspaceRoot;
  try { workspaceRoot = absoluteRoot(root); }
  catch { return { code: 1, started: false }; }
  const spawn = options.spawn || nodeSpawn;
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const timeoutMs = options.timeoutMs ?? PREPARE_START_TIMEOUT_MS;
  const pollMs = options.pollMs ?? PREPARE_START_POLL_MS;
  const cliPath = options.cliPath || CURRENT_CLI_PATH;
  if (!path.isAbsolute(cliPath)) return { code: 1, started: false };

  let initialGeneration;
  let initial;
  try {
    initialGeneration = await preparationGeneration(workspaceRoot, options);
    initial = await preparationStartup(workspaceRoot, options);
  }
  catch { return { code: 1, started: false }; }
  if (initial.ready) return { code: 0, started: false };

  let spawned = false;
  let spawnError = null;
  if (!initial.live) {
    let reservation;
    try { reservation = (await acquireLauncher(workspaceRoot, options)).owner; }
    catch { return { code: 1, started: false }; }
    if (reservation) {
      if (!await stillOwnsLauncher(workspaceRoot, reservation, options).catch(() => false)) {
        return { code: 1, started: false };
      }
      let child;
      try {
        child = spawn(process.execPath, [cliPath, "__prepare-worker", workspaceRoot], {
          detached: true, stdio: "ignore",
        });
        child.once("error", (err) => { spawnError = err; });
        try {
          await handLauncherToChild(workspaceRoot, reservation, child, options);
        } catch {
          try { child.kill?.(); } catch {}
          return { code: 1, started: false };
        }
        spawned = true;
        child.unref();
      } catch {
        return { code: 1, started: false };
      }
    }
  }

  const began = now();
  while (now() - began < timeoutMs) {
    if (spawnError) return { code: 1, started: false };
    let status;
    try {
      status = await preparationStartup(workspaceRoot, {
        ...options,
        completedAfterGeneration: initialGeneration,
      });
    }
    catch { return { code: 1, started: false }; }
    if (status.ready) return { code: 0, started: spawned };
    if (spawnError) return { code: 1, started: false };
    const remaining = timeoutMs - (now() - began);
    await sleep(Math.min(pollMs, remaining));
  }
  return { code: 1, started: false };
}

export async function runPrepareWorker(root, options = {}) {
  const workspaceRoot = absoluteRoot(root);
  const load = options.load || loadEnv;
  const run = options.run || runPreparation;
  load(workspaceRoot);
  return run(workspaceRoot, {
    ...options,
    startupHoldMs: options.startupHoldMs ?? WORKER_STARTUP_HOLD_MS,
  });
}
