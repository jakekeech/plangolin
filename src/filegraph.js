// Stage 3: every source file in the project, and every reference between
// them, as one plain object.
//
// Deliberately deterministic — files and links are sorted, so two runs over
// unchanged code produce byte-identical output. The delta between syncs is
// the product, and a delta computed against a non-deterministic input is
// noise.

import { EXCLUDE_DIRS } from "./structure.js";
import { createHash } from "node:crypto";
import { buildIndex, linksFrom } from "./imports/index.js";
import { findAliasConfigs } from "./imports/aliases.js";
import { httpRoutes, httpLinks } from "./imports/http.js";

// Anything text-based can be read by the generic reader, so this list is
// about excluding binaries and lockfiles, not about picking languages.
export const SOURCE_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".py", ".pyw", ".go", ".rs", ".rb", ".php", ".java", ".kt", ".scala",
  ".cs", ".swift", ".ex", ".exs", ".erl", ".c", ".h", ".cpp", ".hpp",
  ".vue", ".svelte", ".lua", ".zig", ".dart", ".sh",
]);

const MAX_FILES = 2000;

/** A content address for the graph facts that affect adoption. Object and
 * input-array order are deliberately discarded; file, edge, and imported-name
 * facts are not. */
export function fingerprintGraph(graph) {
  const facts = {
    files: [...(graph.files || [])].map(String).sort(),
    links: [...(graph.links || [])].map((link) => ({
      from: String(link.from || ""),
      to: String(link.to || ""),
      kind: String(link.kind || ""),
      names: [...(link.names || [])].map(String).sort(),
    })).sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    capped: Boolean(graph.capped),
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export async function collectSourceFiles(ws, cap = MAX_FILES) {
  const files = [];
  const queue = [""];
  let capped = false;

  while (queue.length) {
    const dir = queue.shift();
    const entries = await ws.list(dir);
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = dir ? dir + "/" + e.name : e.name;
      if (e.dir) {
        if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
        queue.push(rel);
      } else if (SOURCE_EXT.has(extOf(e.name))) {
        if (files.length >= cap) { capped = true; continue; }
        files.push(rel);
      }
    }
  }
  return { files: files.sort(), capped };
}

export async function buildFileGraph(ws) {
  const { files, capped } = await collectSourceFiles(ws);
  const goMod = await ws.read("go.mod");
  const aliasConfigs = await findAliasConfigs(ws);
  const index = buildIndex(files, goMod, aliasConfigs);

  const links = [];
  // Route paths as they are read, so the caller/server matching below can be
  // done once over the whole project rather than per file.
  const routes = new Map();

  for (const file of files) {
    const text = await ws.read(file);
    if (text === null) continue;
    for (const link of linksFrom(file, text, index)) {
      // `names` is what the importing file actually takes — the operations
      // that cross this line. Readers that can't tell return none.
      links.push({ from: file, to: link.target, kind: link.kind, names: link.names || [] });
    }
    const found = httpRoutes(text);
    if (found.calls.length || found.serves.length) routes.set(file, found);
  }

  // The edges imports cannot see: a browser calling a server it never
  // imports. Matched on the route string both sides wrote down, so the edge
  // stays as checkable as an import — see imports/http.js.
  links.push(...httpLinks(routes));

  links.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { files, links, capped };
}
