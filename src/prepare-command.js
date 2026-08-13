import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { preparationStartup, runPreparation } from "./preparation.js";

export const PREPARE_START_TIMEOUT_MS = 2_000;
export const PREPARE_START_POLL_MS = 25;
export const WORKER_STARTUP_HOLD_MS = 100;

const CURRENT_CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));
const sleepFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function absoluteRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("preparation requires an absolute workspace root");
  }
  return path.resolve(root);
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
