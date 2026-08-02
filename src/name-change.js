// What a change was FOR — the one line the sheet cannot compute.
//
// Grouping is free and already done: blocks that changed and refer to each
// other are one change (changesets.js). What no amount of graph arithmetic
// yields is why those four blocks moved together, and that is the thing
// reviewers say they most lack — "the most difficult thing when doing a code
// review is understanding the reason of the change".
//
// So this is the only model call the diff view makes, and it is asked for.
// Everything else on the sheet is derived, free and automatic.
//
// It returns two things from one call, because they need the same evidence:
// the title of each change, and a replacement description for any block whose
// own one-liner the change has made wrong. Refreshing that description used
// to be a separate button reading the same files for the same reason.

import { callTask } from "./llm.js";

export const TITLE_MAX = 60;
export const INTENT_MAX = 90;

const MAX_FILES_PER_BLOCK = 4;
const MAX_EXCERPT_CHARS = 900;

/** Everything the model needs and nothing else: what each change contains,
    what those blocks are called, what they currently claim to do, and the
    lines that actually moved.

    `excerpts` holds diffs, not file contents. The head of a file is imports
    and licence headers, and asking a model to name a change from them
    produces a name for the file rather than for the change. */
export function buildPrompt(changes, nodes, filesByBlock, excerpts) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];

  for (const change of changes) {
    out.push(`## change ${change.id}`);
    for (const id of change.blocks) {
      const n = byId.get(id);
      if (!n) continue;
      out.push(`\nblock ${id} — ${n.name}${n.kind ? ` (${n.kind})` : ""}`);
      // Its current description, so the model can judge whether the change
      // has outdated it rather than rewriting every block it is shown.
      out.push(`says now: ${(n.intent || "").trim() || "(nothing yet)"}`);
      const files = (filesByBlock.get(id) || []).slice(0, MAX_FILES_PER_BLOCK);
      if (files.length) out.push(`changed files: ${files.join(", ")}`);
      for (const f of files) {
        const text = excerpts.get(f);
        if (text) out.push(`\nchanged lines in ${f}:\n${text}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

/** Keep only what was asked about and what will fit.
 *
 *  A model naming a change it was never shown, or rewriting a block that
 *  belongs to a different one, would turn a bounded question into an
 *  unbounded edit of the sheet. Length is checked rather than truncated: the
 *  card cuts a long title mid-word, and half a sentence read as fact is worse
 *  than no sentence.
 *
 *  An entry may cover several of the groups it was given — that is the model
 *  merging work the import graph could not see was one job. Each group may be
 *  claimed once, so the blocks on the strip still add up. */
/* How many groups one entry may claim.
 *
 *  A model asked whether two things are one job will say yes far more often
 *  than it should. Ten express commits — a QUERY feature, a content-
 *  disposition upgrade, a trimEnd fix, an error-logging change — came back as
 *  one entry titled "HTTP header compliance, QUERY freshness, and error
 *  logging", which is not a title, it is a list with the information taken
 *  out. Merging is worth having for the case it was built for (one pass over
 *  the code, arriving split because the halves do not reference each other)
 *  and that case is small. Three is generous for it. */
const MAX_MERGE = 3;

export function validate(raw, changes) {
  const out = [];
  const dropped = [];
  const allowed = new Map(changes.map((c) => [c.id, new Set(c.blocks)]));
  const claimed = new Set();

  const list = raw && Array.isArray(raw.changes) ? raw.changes : [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") { dropped.push("a reply that was not an object"); continue; }

    // Ids it covers. One is the common case; several means it saw one job
    // where the grouping saw two, which is the whole reason this is a list.
    const raw_ids = Array.isArray(entry.changeIds) ? entry.changeIds
                  : typeof entry.changeId === "string" ? [entry.changeId] : [];
    const ids = [];
    for (const id of raw_ids) {
      if (!allowed.has(id)) { dropped.push(`change "${id}" was never asked about`); continue; }
      // Never let one group be claimed twice: the strip would show the same
      // blocks under two titles and the counts would stop adding up.
      if (claimed.has(id)) { dropped.push(`change "${id}" was claimed twice`); continue; }
      ids.push(id);
    }
    if (!ids.length) continue;
    // Over the cap, or swallowing everything, is the over-merge signature.
    // Keep the groups and lose the title: an unnamed change still says which
    // blocks moved, where a wrong name says something untrue about all of it.
    if (ids.length > MAX_MERGE || (changes.length > 2 && ids.length === changes.length)) {
      dropped.push(`one title tried to cover ${ids.length} of ${changes.length} changes`);
      continue;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title || title.length > TITLE_MAX) {
      dropped.push(`${ids.join("+")} came back with no usable title`);
      continue;
    }

    const mine = new Set(ids.flatMap((id) => [...allowed.get(id)]));
    const blocks = [];
    for (const b of Array.isArray(entry.blocks) ? entry.blocks : []) {
      if (!b || typeof b !== "object") continue;
      const intent = typeof b.intent === "string" ? b.intent.trim() : "";
      if (!mine.has(b.id)) { dropped.push(`block "${b.id}" is not part of ${ids.join("+")}`); continue; }
      if (!intent || intent.length > INTENT_MAX) { dropped.push(`block "${b.id}" got an unusable description`); continue; }
      blocks.push({ id: b.id, intent });
    }
    ids.forEach((id) => claimed.add(id));
    out.push({ ids, title, blocks });
  }
  return { changes: out, dropped };
}

/** One call. `changes` is [{id, blocks}], `filesByBlock` maps block id to the
    files that moved in it, `excerpts` maps a file path to its new contents. */
export async function nameChanges(changes, nodes, filesByBlock, excerpts) {
  if (!changes.length) return { changes: [], dropped: [], provider: null, model: null };

  const { parsed, provider, model } = await callTask({
    task: "explain",
    prompt: buildPrompt(changes, nodes, filesByBlock, excerpts),
  });

  const { changes: named, dropped } = validate(parsed, changes);
  return { changes: named, dropped, provider, model };
}
