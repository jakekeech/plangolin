// One entry point for "what does this file reference", and the index every
// reader resolves against.
//
// The dispatch is the whole of plangolin's per-language surface: a precise
// reader when we have one, the generic reader otherwise. Adding a language
// is one more line here and one more file next to it — nothing downstream
// changes, because every reader returns the same shape.

import path from "node:path";
import { jsLinks } from "./javascript.js";
import { pyLinks } from "./python.js";
import { goLinks, parseModule } from "./go.js";
import { genericLinks } from "./generic.js";

const JS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const PY = new Set([".py", ".pyw"]);
const GO = new Set([".go"]);

function extOf(p) {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i).toLowerCase();
}

export function buildIndex(files, goModText, aliasConfigs) {
  const paths = new Set(files);
  const byName = new Map();

  for (const file of files) {
    const base = path.posix.basename(file);
    const dot = base.lastIndexOf(".");
    const name = (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(file);
  }
  for (const list of byName.values()) list.sort();

  return { paths, byName, goModule: parseModule(goModText), aliasConfigs: aliasConfigs || [] };
}

export function linksFrom(p, text, index) {
  if (typeof text !== "string" || !text) return [];
  const ext = extOf(p);
  try {
    if (JS.has(ext)) return jsLinks(p, text, index);
    if (PY.has(ext)) return pyLinks(p, text, index);
    if (GO.has(ext)) return goLinks(p, text, index);
    return genericLinks(p, text, index);
  } catch {
    // Drop-don't-fail: one unreadable file must never cost the scan.
    return [];
  }
}
