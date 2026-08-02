// Turns JavaScript and TypeScript import statements into real project file
// paths. Regex rather than a parser: plangolin's blocks are coarse groups of
// files, so a missed dynamic import cannot change which group a file lands
// in. What it buys is staying dependency-free — see the design doc's
// decision log.

import path from "node:path";
import { resolveAlias } from "./aliases.js";

const EXTS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];

// Forms that name what they take: the clause between the keyword and "from"
// is captured so the individual bindings can be read out of it.
const NAMED = [
  /\bimport\s+([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g,   // import x from "y"
  /\bexport\s+([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g,   // export { x } from "y"
];
// CommonJS destructuring is the same statement in another dialect, and a
// great many real projects are still written this way — including the
// Express apps most likely to be scanned. Handled alongside `import { … }`
// rather than treated as a bare require, which named nothing.
const DESTRUCTURED = [
  /\b(?:const|let|var)\s*(\{[^}]*\})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
// Forms that take the whole module and name nothing.
const BARE = [
  /\bimport\s*['"]([^'"]+)['"]/g,               // import "y"
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,    // require("y")
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,     // import("y")
];

/** The specific things taken from a module.
 *
 *  `import { verifyToken, generateAuthTokens }` names two things that cross
 *  the line. So does `const ApiError = require("./ApiError")` — in practice
 *  a single binding is the one thing the module exports, and naming it is
 *  more use than leaving the line blank.
 *
 *  A namespace import ("import * as ns") is the exception: `ns` is a label
 *  the importer invented for the whole module, and says nothing the line
 *  does not already say.
 *
 *  For `b as c` the exported name `b` is kept, not the importer's local
 *  alias — what matters is what the other side offers. */
export function bindingsOf(clause) {
  const text = String(clause || "").trim().replace(/^type\s+/, "");
  const braced = /\{([^}]*)\}/.exec(text);

  if (braced) {
    return braced[1]
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
  }
  if (/^\*\s+as\s+/.test(text)) return [];
  return /^[A-Za-z_$][\w$]*$/.test(text) ? [text] : [];
}

/** Every specifier in the file, each with the names taken from it. */
export function extractImports(text) {
  const bySpec = new Map();
  const add = (spec, names) => {
    if (!bySpec.has(spec)) bySpec.set(spec, new Set());
    for (const n of names) bySpec.get(spec).add(n);
  };

  for (const pattern of [...NAMED, ...DESTRUCTURED]) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)) !== null; ) add(m[2], bindingsOf(m[1]));
  }
  for (const pattern of BARE) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)) !== null; ) add(m[1], []);
  }
  return [...bySpec].map(([spec, names]) => ({ spec, names: [...names].sort() }));
}

export function extractSpecifiers(text) {
  return extractImports(text).map((i) => i.spec);
}

/** A resolved base path (no extension yet) against the real files — tried
    exact, then with each known extension, then as a folder's index file.
    Shared by relative and aliased resolution; both end up needing the same
    "what file does this base path actually mean" question answered. */
function matchFile(base, files) {
  if (files.has(base)) return base;
  for (const ext of EXTS) if (files.has(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.posix.join(base, "index" + ext);
    if (files.has(idx)) return idx;
  }
  return null;
}

/** Relative specifiers resolve against `fromPath`; a `@/`-style aliased
    specifier resolves against whatever tsconfig/jsconfig.json configured,
    if anything did. Anything else is a bare package specifier — external by
    definition, never part of the project graph. */
export function resolveSpecifier(spec, fromPath, files, aliasConfigs) {
  if (spec.startsWith(".")) {
    const base = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromPath), spec),
    );
    if (base.startsWith("..")) return null;   // climbed out of the project
    return matchFile(base, files);
  }

  if (aliasConfigs && aliasConfigs.length) {
    const aliased = resolveAlias(spec, fromPath, aliasConfigs);
    if (aliased) return matchFile(aliased, files);
  }
  return null;
}

export function jsLinks(fromPath, text, index) {
  const links = [];
  const byTarget = new Map();
  for (const { spec, names } of extractImports(text)) {
    const target = resolveSpecifier(spec, fromPath, index.paths, index.aliasConfigs);
    if (!target || target === fromPath) continue;
    // Two specifiers can resolve to the same file ("./x" and "./x.js"); the
    // names they take are both real, so merge rather than keeping the first.
    if (!byTarget.has(target)) {
      byTarget.set(target, new Set(names));
      links.push({ target, kind: "import", names: [] });
    } else {
      for (const n of names) byTarget.get(target).add(n);
    }
  }
  for (const link of links) link.names = [...byTarget.get(link.target)].sort();
  return links;
}
