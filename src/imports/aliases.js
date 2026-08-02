// tsconfig.json / jsconfig.json "paths" — the mapping that turns a
// specifier like "@/db/schema" into a real project file. A bundler resolves
// this itself at build time; nothing about the specifier text says where it
// points, so plangolin has to read the same config a real toolchain would.
//
// There can be more than one config in a real project — an example app
// nested inside the main one, a monorepo package — so each file resolves
// against the *nearest* config above it, the same rule TypeScript itself
// uses for overlapping tsconfigs.

import path from "node:path";
import { EXCLUDE_DIRS } from "../structure.js";

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

/** Strips /* *‍/ and // comments and trailing commas well enough for a real
    tsconfig — these are JSONC in practice, not strict JSON. A config
    plangolin can't parse just means aliases are quietly unavailable for
    that subtree, not a failed scan. */
function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

/** Every tsconfig/jsconfig in the project that actually declares path
    aliases, each carrying the real directory its patterns resolve against
    (`compilerOptions.baseUrl`, relative to wherever the config file lives —
    "." when unset, which is what most projects leave it at). */
export async function findAliasConfigs(ws) {
  const configs = [];
  const queue = [""];
  while (queue.length) {
    const dir = queue.shift();
    const entries = await ws.list(dir);
    for (const e of entries) {
      if (e.dir) {
        if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
        queue.push(dir ? dir + "/" + e.name : e.name);
        continue;
      }
      if (!CONFIG_NAMES.includes(e.name)) continue;
      const rel = dir ? dir + "/" + e.name : e.name;
      const text = await ws.read(rel);
      if (!text) continue;

      let json;
      try { json = parseJsonc(text); } catch { continue; }
      const opts = json && json.compilerOptions;
      const paths = opts && opts.paths;
      if (!paths || typeof paths !== "object") continue;

      const root = opts.baseUrl ? path.posix.normalize(path.posix.join(dir, opts.baseUrl)) : dir;
      configs.push({ dir, root: root === "." ? "" : root, paths });
    }
  }
  // Deepest config first, so a nested project's own tsconfig is checked
  // before one further up the tree.
  configs.sort((a, b) => b.dir.length - a.dir.length);
  return configs;
}

function nearestConfig(configs, fromPath) {
  for (const c of configs) {
    if (!c.dir || fromPath === c.dir || fromPath.startsWith(c.dir + "/")) return c;
  }
  return null;
}

/** One "prefix*suffix": ["target*"] rule against one specifier — the single-
    wildcard shape, which is what every "@/*" or "~/*" convention actually
    uses. Patterns with no "*" require an exact match. */
function matchPattern(pattern, target, spec) {
  const star = pattern.indexOf("*");
  if (star === -1) return spec === pattern ? target : null;
  const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
  if (!spec.startsWith(pre) || !spec.endsWith(post)) return null;
  const middle = spec.slice(pre.length, spec.length - post.length);
  return target.replace("*", middle);
}

/** Turns an aliased specifier into the project-relative path it points at,
    or null if no configured pattern matches. The longest matching pattern
    wins, TypeScript's own rule for resolving overlapping patterns. */
export function resolveAlias(spec, fromPath, configs) {
  const config = nearestConfig(configs, fromPath);
  if (!config) return null;

  let best = null;
  for (const [pattern, targets] of Object.entries(config.paths)) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      const hit = matchPattern(pattern, target, spec);
      if (hit == null) continue;
      if (!best || pattern.length > best.patternLength) best = { hit, patternLength: pattern.length };
    }
  }
  if (!best) return null;
  return path.posix.normalize(config.root ? config.root + "/" + best.hit : best.hit);
}
