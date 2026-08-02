// The one model call in the pipeline. It receives resolved structure and
// returns judgement: what to call each group and what it does.
//
// Import lines are stripped from the excerpts because that information has
// already been extracted, correctly, and is handed over separately as
// "depends on". Asking the model to re-derive dependencies from a partial
// view of the repo would be both more expensive and less accurate, and its
// answer is never used for edges anyway.
//
// The system prompt and output schema used to sit in this file; they now live
// in plangolin's hosted service, so they can be changed without cutting
// an npm release and so two versions can run side by side. What is still
// built here is the *user* prompt, because it is made of this project's own
// files and could not be built anywhere else. Validation also stays here —
// the service returns the model's JSON untouched.

import { callTask } from "./llm.js";

const MAX_FILE_CHARS = 1200;
const MAX_FILES_PER_GROUP = 4;

// Backstops, not style. The prompt is what keeps these fields short — see the
// note in the service's prompt — and these only catch a reply that ignores it.
// Both are set well above what the prompt asks for, so a slightly long answer
// survives intact and only a runaway one is cut.
const MAX_KIND = 40;
const MAX_INTENT = 200;

/** Cut at a word boundary rather than mid-word. A card reading "Python
    backen" is worse than one reading "Python", and an ellipsis in stored data
    would then be drawn a second time by the card that truncates it again. */
export function trim(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  // The cut landed exactly where a word ended, so it is already clean —
  // there is no trailing space inside `cut` to find, and looking for one
  // would throw away a whole word that fitted.
  if (text[limit] === " ") return cut.trim();

  const space = cut.lastIndexOf(" ");
  // Any word boundary beats a mid-word cut: "React" reads, "React compon"
  // does not. Only a single word longer than the limit has none to use.
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

const IMPORT_LINE =
  /^[ \t]*(?:import\b|export\s+[^;]*\bfrom\b|from\s+[.\w]+\s+import\b|const\s+.*=\s*require\(|use\s+|#include\b|require(?:_relative)?\s)/;

export function stripImports(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line))
    .join("\n");
}

function descendantFiles(g) {
  const out = [...g.files];
  g.children.forEach((c) => out.push(...descendantFiles(c)));
  return out;
}

/** The folder every file beneath a group shares.
 *
 *  A container owns no files of its own, so until now it was asked to name
 *  itself from a list of child ids and nothing else — and that is exactly what
 *  it produced: "Backend Source Groups" for a group whose every file sits in
 *  `backend/`, "Nested Component Group", "Setup Groups". The folder is known,
 *  costs nothing to compute, and is the one concrete fact a container has.
 *
 *  Compared segment by segment rather than character by character, so `src/api`
 *  and `src/apiary` share `src/` and not `src/api`. */
export function commonFolder(files) {
  if (!files.length) return "";
  const parts = files.map((f) => f.split("/").slice(0, -1));
  let shared = parts[0];
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < shared.length && i < p.length && shared[i] === p[i]) i += 1;
    shared = shared.slice(0, i);
    if (!shared.length) break;
  }
  return shared.length ? shared.join("/") + "/" : "";
}

export function buildPrompt(groups, deps, excerpts) {
  const flat = [];
  const walk = (gs, depth) => {
    for (const g of gs) {
      flat.push({ g, depth });
      walk(g.children, depth + 1);
    }
  };
  walk(groups, 0);

  const sections = flat.map(({ g, depth }) => {
    const kids = g.children.map((c) => c.id).join(", ");
    const files = g.files.slice(0, MAX_FILES_PER_GROUP);
    const body = files
      .map((f) => `--- ${f} ---\n${stripImports(excerpts.get(f) || "").slice(0, MAX_FILE_CHARS)}`)
      .join("\n\n");
    const parent = depth ? ` (inside ${g.id.split(".").slice(0, -1).join(".")})` : "";
    const holds = g.files.length
      ? `files: ${g.files.join(", ")}`
      : `contains: ${kids}`;
    // A container has no files to read, so the folder its contents share is
    // the only concrete thing it can be named from.
    const folder = g.files.length ? "" : commonFolder(descendantFiles(g));
    return [
      `## ${g.id}${parent}`,
      holds,
      folder ? `every file below it is under: ${folder}` : "",
      `depends on: ${(deps.get(g.id) || []).join(", ") || "(nothing else in this project)"}`,
      body || "(no readable source)",
    ].filter(Boolean).join("\n");
  });

  return `Groups of files discovered in this project, with what each depends on:\n\n${sections.join("\n\n")}`;
}

/** Labels for lines we already computed. The model may describe any pair it
    was shown and may not invent one — the edge's existence stays a fact from
    the import graph; only the wording is judgement. `pairs` is the set of
    "from to" keys the caller actually found. */
export function validateEdges(raw, pairs) {
  const labels = new Map();
  const dropped = [];

  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== "object") { dropped.push("edge label: not an object"); continue; }
    const key = `${e.from} ${e.to}`;
    if (!pairs.has(key)) { dropped.push(`label for a pair that has no code behind it: ${key}`); continue; }
    if (labels.has(key)) { dropped.push(`second label for: ${key}`); continue; }
    const label = String(e.label || "").trim().slice(0, 40);
    if (!label) { dropped.push(`empty label for: ${key}`); continue; }
    labels.set(key, label);
  }
  return { labels, dropped };
}

/** Same drop-don't-fail philosophy as every other AI route: one bad block
    must never cost the rest of the sheet. */
export function validate(raw, groupIds) {
  const blocks = [];
  const dropped = [];
  const usedIds = new Set();
  const claimed = new Set();

  for (const b of Array.isArray(raw) ? raw : []) {
    if (!b || typeof b !== "object") { dropped.push("not an object"); continue; }
    if (!groupIds.has(b.groupId)) { dropped.push(`unknown group: ${JSON.stringify(b.groupId)}`); continue; }
    if (claimed.has(b.groupId)) { dropped.push(`second block for group: ${b.groupId}`); continue; }
    if (typeof b.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(b.id)) {
      dropped.push(`bad id: ${JSON.stringify(b.id)}`); continue;
    }
    if (usedIds.has(b.id)) { dropped.push(`duplicate id: ${b.id}`); continue; }

    usedIds.add(b.id);
    claimed.add(b.groupId);
    blocks.push({
      groupId: b.groupId,
      id: b.id,
      name: String(b.name || b.id).slice(0, 60),
      kind: trim(b.kind, MAX_KIND),
      intent: trim(b.intent, MAX_INTENT),
      details: String(b.details || "").slice(0, 2000),
    });
  }
  return { blocks, dropped };
}

export async function describeGroups(groups, deps, excerpts) {
  const ids = new Set();
  const walk = (gs) => gs.forEach((g) => { ids.add(g.id); walk(g.children); });
  walk(groups);
  if (!ids.size) return { blocks: [], labels: new Map(), dropped: [], provider: null, model: null };

  // The pairs the import graph actually produced. Nothing outside this set
  // may be labelled, which is what stops a label implying a line that isn't
  // there.
  const pairs = new Set();
  for (const [from, tos] of deps) for (const to of tos) pairs.add(`${from} ${to}`);

  const { parsed, provider, model } = await callTask({
    task: "describe",
    prompt: buildPrompt(groups, deps, excerpts),
  });
  const { blocks, dropped } = validate(parsed.blocks, ids);
  const { labels, dropped: edgeDropped } = validateEdges(parsed.edges, pairs);
  return { blocks, labels, dropped: [...dropped, ...edgeDropped], provider, model };
}
