// Proposes a real folder for any block that doesn't have one yet — the
// replacement for a manual "type the folder path" field, which breaks for a
// from-scratch project with no code at all. Matches an existing folder if
// there's a plausible one; invents a short conventional path otherwise.
//
// Deliberately cheap: this only ever sees folder *names* and each
// unanchored block's name/kind/intent — never file contents. That keeps it
// fast and low-cost even though it's AI-backed: it never reads a file's
// contents, only the names of folders.

// The system prompt and schema for this call live in the hosted service — see
// the note at the top of describe.js for why.
import { callTask } from "./llm.js";

export const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "out", ".turbo", "plangolin",
]);
const MAX_DIRS = 500;

/** BFS listing of real folders in the project, skipping build/vendor/dot
    directories and plangolin's own folder. Shared with sync.js's
    GET /api/fs/dirs — both need "what folders actually exist here." */
export async function listDirs(ws) {
  const dirs = [];
  const queue = [""];
  while (queue.length && dirs.length < MAX_DIRS) {
    const rel = queue.shift();
    const entries = await ws.list(rel);
    for (const e of entries) {
      if (!e.dir) continue;
      if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
      const childRel = rel ? rel + "/" + e.name : e.name;
      dirs.push(childRel);
      if (dirs.length >= MAX_DIRS) break;
      queue.push(childRel);
    }
  }
  return dirs;
}

function describe(unanchored, dirs) {
  const blocks = unanchored
    .map((n) => `- ${n.id} (${n.kind || "unknown kind"}): ${n.name} — ${n.intent || "no description"}`)
    .join("\n");
  const folders = dirs.length ? dirs.map((d) => `- ${d}`).join("\n") : "(none — this project has no folders yet)";
  return `Blocks with no folder yet:\n${blocks}\n\nFolders that already exist in this project:\n${folders}`;
}

/** Same drop-don't-fail philosophy as every other AI route: one bad
    proposal must never cost the rest of the batch. */
export function validate(raw, unanchoredIds) {
  const anchors = [];
  const dropped = [];
  const known = new Set(unanchoredIds);
  const claimed = new Set();

  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || typeof a !== "object") { dropped.push("not an object"); continue; }
    if (typeof a.id !== "string" || !known.has(a.id)) {
      dropped.push(`unknown or duplicate block id: ${JSON.stringify(a.id)}`); continue;
    }
    if (claimed.has(a.id)) { dropped.push(`duplicate proposal for: ${a.id}`); continue; }

    let dir = String(a.dir || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!dir || dir.split("/").some((seg) => seg === "..")) {
      dropped.push(`bad path for "${a.id}": ${JSON.stringify(a.dir)}`); continue;
    }
    claimed.add(a.id);
    anchors.push({ id: a.id, dir: dir.slice(0, 200) });
  }
  return { anchors, dropped };
}

export async function proposeStructure(ws, doc) {
  const nodes = doc.nodes || [];
  // A block anchored to a set of files is anchored. Testing only for `.dir`
  // made every scanned block look unanchored, and since setAnchor replaces
  // the whole anchor, one export would have swapped every precise file list
  // for a guessed folder.
  const anchored = (n) =>
    n.anchor && (n.anchor.dir || (Array.isArray(n.anchor.paths) && n.anchor.paths.length));
  const unanchored = nodes.filter((n) => !anchored(n));
  if (!unanchored.length) return { anchors: [], dropped: [], provider: null, model: null };

  const dirs = await listDirs(ws);
  const { parsed, provider, model } = await callTask({
    task: "structure", prompt: describe(unanchored, dirs),
  });
  const { anchors, dropped } = validate(parsed.anchors, unanchored.map((n) => n.id));
  return { anchors, dropped, provider, model };
}
