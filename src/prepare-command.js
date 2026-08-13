import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { MAX_CLOCK_SKEW_MS, preparationPaths, preparationStartup, runPreparation } from "./preparation.js";

export const PREPARE_START_TIMEOUT_MS = 2_000;
export const PREPARE_START_POLL_MS = 25;
export const LAUNCHER_RESERVATION_MS = PREPARE_START_TIMEOUT_MS;
export const WORKER_STARTUP_HOLD_MS = 100;

const LAUNCHER_RE = /^launcher-(\d{12})\.json$/;

const CURRENT_CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));
const sleepFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function absoluteRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("preparation requires an absolute workspace root");
  }
  return path.resolve(root);
}

async function launcherNames(dir, io) {
  try {
    return await io.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function currentLauncher(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const generations = (await launcherNames(paths.dir, io)).flatMap((name) => {
    const match = LAUNCHER_RE.exec(name);
    return match ? [Number(match[1])] : [];
  });
  if (!generations.length) return null;
  const generation = Math.max(...generations);
  let raw;
  try {
    raw = JSON.parse(await io.readFile(
      path.join(paths.dir, `launcher-${String(generation).padStart(12, "0")}.json`),
      "utf8",
    ));
  } catch (err) {
    if (err.code && err.code !== "ENOENT") throw err;
    return { generation, invalid: true };
  }
  return raw && raw.version === 1 && raw.generation === generation &&
    raw.rootHash === paths.rootHash && /^[0-9a-f-]{36}$/.test(raw.owner || "") &&
    Number.isFinite(raw.createdAt)
    ? raw : { generation, invalid: true };
}

function launcherLive(reservation, now) {
  return Boolean(reservation && !reservation.invalid &&
    reservation.createdAt <= now + MAX_CLOCK_SKEW_MS &&
    now - reservation.createdAt <= LAUNCHER_RESERVATION_MS);
}

async function acquireLauncher(root, options = {}) {
  const io = options.fs || nodeFs;
  const paths = preparationPaths(root, options);
  const now = options.now || Date.now;
  await io.mkdir(paths.dir, { recursive: true });
  for (;;) {
    const current = await currentLauncher(root, options);
    if (launcherLive(current, now())) return { owner: null, existing: current };
    const generation = (current?.generation || 0) + 1;
    const reservation = {
      version: 1,
      rootHash: paths.rootHash,
      generation,
      owner: options.launcherToken || randomUUID(),
      createdAt: now(),
    };
    try {
      await io.writeFile(
        path.join(paths.dir, `launcher-${String(generation).padStart(12, "0")}.json`),
        JSON.stringify(reservation),
        { encoding: "utf8", flag: "wx" },
      );
      return { owner: reservation, existing: null };
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
  }
}

async function stillOwnsLauncher(root, reservation, options = {}) {
  const current = await currentLauncher(root, options);
  const now = options.now || Date.now;
  return Boolean(current && !current.invalid && current.generation === reservation.generation &&
    current.owner === reservation.owner && launcherLive(current, now()));
}

export async function runPrepareCommand(root, options = {}) {
  let workspaceRoot;
  try {
    workspaceRoot = absoluteRoot(root);
  } catch {
    return { code: 1, started: false };
  }
  const spawn = options.spawn || nodeSpawn;
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepFor;
  const timeoutMs = options.timeoutMs ?? PREPARE_START_TIMEOUT_MS;
  const pollMs = options.pollMs ?? PREPARE_START_POLL_MS;
  const cliPath = options.cliPath || CURRENT_CLI_PATH;
  if (!path.isAbsolute(cliPath)) return { code: 1, started: false };

  let initial;
  try {
    initial = await preparationStartup(workspaceRoot, options);
  } catch {
    return { code: 1, started: false };
  }
  if (initial.ready) return { code: 0, started: false };

  let spawned = false;
  let spawnError = null;
  if (!initial.live) {
    let reservation;
    try {
      const launch = await acquireLauncher(workspaceRoot, options);
      reservation = launch.owner;
    } catch {
      return { code: 1, started: false };
    }
    if (!reservation) {
      // Another public command owns the bounded startup window. Follow it.
    } else if (!await stillOwnsLauncher(workspaceRoot, reservation, options).catch(() => false)) {
      return { code: 1, started: false };
    } else {
      let child;
      try {
        child = spawn(process.execPath, [cliPath, "__prepare-worker", workspaceRoot], {
          detached: true,
          stdio: "ignore",
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
    try {
      status = await preparationStartup(workspaceRoot, options);
    } catch {
      return { code: 1, started: false };
    }
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
