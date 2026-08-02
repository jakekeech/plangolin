// Turns Go import statements into real project file paths.
//
// Go imports a package, which is a directory, not a file. So one import
// becomes a link to every .go file in that directory — the importing file
// may use a symbol from any of them, and picking one would be a guess.
//
// Resolution needs the module name from go.mod to tell an internal package
// from an external one. Without it every path looks external, which is the
// safe failure: no links rather than wrong ones.

import path from "node:path";

const MODULE = /^[ \t]*module[ \t]+(\S+)/m;
const GROUP = /\bimport\s*\(([^)]*)\)/g;
const SINGLE = /\bimport\s+(?:[A-Za-z_.]\w*\s+)?"([^"]+)"/g;
const QUOTED = /"([^"]+)"/g;

export function parseModule(goModText) {
  const m = MODULE.exec(String(goModText || ""));
  return m ? m[1] : null;
}

function specifiers(text) {
  const specs = [];
  GROUP.lastIndex = 0;
  for (let g; (g = GROUP.exec(text)) !== null; ) {
    QUOTED.lastIndex = 0;
    for (let q; (q = QUOTED.exec(g[1])) !== null; ) specs.push(q[1]);
  }
  SINGLE.lastIndex = 0;
  for (let m; (m = SINGLE.exec(text)) !== null; ) specs.push(m[1]);
  return specs;
}

export function goLinks(fromPath, text, index) {
  const mod = index.goModule;
  if (!mod) return [];

  const links = [];
  const seen = new Set();

  for (const spec of specifiers(text)) {
    if (spec !== mod && !spec.startsWith(mod + "/")) continue;   // external
    const dir = spec === mod ? "" : spec.slice(mod.length + 1);

    for (const file of index.paths) {
      if (!file.endsWith(".go")) continue;
      // dirname("main.go") is ".", so a root-level package compares against
      // "." rather than the empty string.
      if (path.posix.dirname(file) !== (dir || ".")) continue;
      if (file === fromPath || seen.has(file)) continue;
      seen.add(file);
      links.push({ target: file, kind: "import" });
    }
  }
  return links.sort((a, b) => a.target.localeCompare(b.target));
}
