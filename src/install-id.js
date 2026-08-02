// An anonymous id, generated once and kept in the user's config directory.
//
// It is not an account and it is not tied to anything. It exists so the
// service can rate limit per machine, and so "did anyone run this twice"
// becomes answerable — npm's download API returns four fields and none of
// them is a person, and npx makes it worse: a pinned invocation never fetches
// the tarball again, so the most loyal users are the ones it counts least.
//
// Regenerating it is deliberately trivial: delete the file. Anyone who wants
// to be uncountable can be, at the cost of their daily allowance resetting.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "plangolin");
}

/** The id for this machine, created on first call. Never throws: a home
    directory that cannot be written to is a reason to be uncounted, not a
    reason to refuse to run — so it falls back to a per-process id. */
export function installId() {
  const file = path.join(configDir(), "install.json");

  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (UUID.test(saved.installId)) return saved.installId;
  } catch {
    // No file, unreadable file, or corrupt JSON — all mean "make a new one".
  }

  const id = randomUUID();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ installId: id, created: new Date().toISOString() }, null, 2));
  } catch {
    // Read-only home, sandboxed CI, whatever. The id still works for this run.
  }
  return id;
}
