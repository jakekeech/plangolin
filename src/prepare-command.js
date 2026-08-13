import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { MAX_CLOCK_SKEW_MS, preparationPaths, preparationStartup, runPreparation } from "./preparation.js";

export const PREPARE_START_TIMEOUT_MS = 2_000;
export const PREPARE_START_POLL_MS = 25;
export const LAUNCHER_RESERVATION_MS = 10_000;
export const WORKER_STARTUP_HOLD_MS = 100;

const UUID = "[0-9a-f-]{36}";
const LAUNCHER_RE = /^launcher-(\d{12})\.claim$/;
const LAUNCHER_OWNER_RE = new RegExp(`^(${UUID})-(\\d+)\\.owner$`);
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
  const owners = (await launcherNames(slot, io)).flatMap((name) => {
    const match = LAUNCHER_OWNER_RE.exec(name);
    return match ? [{
      version: 1, rootHash: paths.rootHash, generation,
      owner: match[1], createdAt: Number(match[2]), name,
    }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (owners.length) return owners[0];
  let stat;
  try { stat = await io.stat(slot); }
  catch { return { generation, incomplete: true, createdAt: 0 }; }
  return { generation, incomplete: true, createdAt: stat.mtimeMs };
}

function launcherLive(reservation, now) {
  return Boolean(reservation && reservation.createdAt <= now + MAX_CLOCK_SKEW_MS &&
    now - reservation.createdAt <= LAUNCHER_RESERVATION_MS);
}

function sameLauncher(left, right) {
  return Boolean(left && right && left.generation === right.generation && left.owner === right.owner);
}

async function acquireLauncher(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  await io.mkdir(paths.dir, { recursive: true });
  for (;;) {
    const current = await currentLauncher(root, options);
    if (launcherLive(current, now())) return { owner: null, existing: current };
    const reservation = {
      version: 1,
      rootHash: paths.rootHash,
      generation: (current?.generation || 0) + 1,
      owner: options.launcherToken || randomUUID(),
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
      await io.mkdir(path.join(slot, `${reservation.owner}-${reservation.createdAt}.owner`));
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
  const now = options.now || Date.now;
  return sameLauncher(current, reservation) && launcherLive(current, now());
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

  let initial;
  try { initial = await preparationStartup(workspaceRoot, options); }
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
        spawned = true;
        child.once("error", (err) => { spawnError = err; });
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
    try { status = await preparationStartup(workspaceRoot, options); }
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
