#!/usr/bin/env node
import { spawn } from "node:child_process";
import { loadEnv } from "./env.js";
import { nodeWorkspace } from "./workspace.js";
import { createServer } from "./server.js";

import { promises as fsp } from "node:fs";

const root = process.cwd();
const argv = process.argv.slice(2);

/* Dispatched before anything is loaded or bound. These commands own their
   process lifetime and must not inherit the interactive server below. */
if (argv[0] === "prepare") {
  const { runPrepareCommand } = await import("./prepare-command.js");
  const { code } = await runPrepareCommand(root);
  if (code === 0) {
    console.log("Preparing this project's system map in the background.");
  } else {
    console.error("plangolin: preparation could not start.");
  }
  process.exit(code);
}

if (argv[0] === "__prepare-worker") {
  const { runPrepareWorker } = await import("./prepare-command.js");
  try {
    await runPrepareWorker(argv[1]);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

/* `review` owns its own server
   and its own lifetime; it must not inherit one started for a different
   purpose, and it must not leave one behind. */
if (argv[0] === "review") {
  const file = argv[1];
  if (!file) {
    console.error("Usage: plangolin review <plan-file>");
    process.exit(1);
  }
  let text;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (err) {
    console.error(`Couldn't read ${file} — ${err.message}`);
    process.exit(1);
  }
  const { runReview } = await import("./review-command.js");
  const { code, brief } = await runReview(root, text);
  if (brief) process.stdout.write(brief);
  process.exit(code);
}

// Only ever the directory you ran from. Reading a .env out of the installed
// package would work when linked from a checkout and silently stop working once
// published — the worst kind of difference.
loadEnv(root);
const ws = nodeWorkspace(root);
const server = createServer(ws);

const wanted = Number(process.env.PORT || 4321);

// Registered once, outside listen(), because "listening" only ever fires on
// the attempt that succeeds. Passing this as server.listen()'s callback
// instead queues one more listener per busy port, and every one of them
// fires on that single success — three attempts meant three log lines and
// three browser tabs, two naming ports we never bound.
server.once("listening", () => {
  // Ask the server what it bound rather than trusting a captured variable.
  //
  // Printed as localhost though it binds to 127.0.0.1: every dev server
  // people already know — vite, next, npx serve — prints the name, and it
  // reads as an address rather than as a number to decode.
  const url = `http://localhost:${server.address().port}`;

  // The Network line stays even though there is nothing on it. Binding to
  // loopback only is a deliberate choice for a tool that reads your source,
  // and an absent line reads as an oversight rather than as a decision.
  console.log("");
  console.log("  plangolin");
  console.log("");
  console.log(`  Local     ${url}`);
  console.log("  Network   off — this reads your source, so it stays here");
  console.log("  Sheet     plangolin/system.json");
  console.log("");

  if (process.argv.includes("--no-open")) return;

  // "start" is a cmd.exe builtin, not an executable on PATH — it only
  // works run through the shell. The empty "" is a placeholder window
  // title so cmd doesn't mistake the URL for one.
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  // Failing to open a tab must never take the server down with it — the
  // URL is already printed above for the user to open by hand.
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => console.warn(`plangolin: couldn't open a browser automatically — open ${url} yourself`))
    .unref();
});

function listen(port, attempts = 12) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attempts > 0) return listen(port + 1, attempts - 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1");
}

listen(wanted);
