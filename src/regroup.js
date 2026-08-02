// Asks a model to regroup what the clustering already grouped.
//
// Louvain groups by import density, which is not what a group means. It has
// no way to know that a file and its own test belong together, that a helper
// belongs with the feature that uses it rather than in a bucket of helpers,
// or that two files doing the same job belong together when neither imports
// the other. A model reading names and code knows all three.
//
// Measured on four repositories before this was written. The model won every
// time, and by more the larger the repository got — on a 99-file Go framework
// the clustering produced twenty groups with no theme, several separating
// files from their own tests, while the model produced the six a person would
// name. Coverage was exact in all four: nothing missing, duplicated or
// invented.
//
// Three things this deliberately does NOT do:
//
//   It does not decide edges. An arrow means "this file imports that file",
//   which a reader can check in seconds. An arrow meaning "a model thought
//   these were related" cannot be checked, and the moment edges become
//   opinions the sheet stops being worth more than asking an agent.
//
//   It does not name. Naming is describe.js's job and stays there, so this
//   change leaves describe.js and an already-deployed prompt alone. It costs a second call per adoption, which is cents on a thing
//   that happens once per repository, and buys two halves that fail
//   independently.
//
//   It does not run without the structural grouping. That is the fallback
//   when the service is unreachable, when the repository is too large to
//   describe in a prompt, and when the reply cannot be trusted.

import { callTask } from "./llm.js";

// Above this, the file list, the import list and the excerpts stop fitting in
// a prompt worth sending, and the structural grouping is used alone. The
// largest repository measured was 99 files; this leaves headroom without
// pretending the method scales to a monorepo. [reasoned]
export const MAX_FILES_FOR_SEMANTIC = 260;
const MAX_LINKS_IN_PROMPT = 1500;
export const EXCERPT_FILES = 60;
const EXCERPT_CHARS = 320;

/** Flat list of every group, deepest last, each with the files it owns
    directly. Mirrors what chooseGroups returns so callers can treat the two
    interchangeably. */
function leafFiles(groups) {
  const out = [];
  const walk = (gs) => gs.forEach((g) => { if (g.files.length) out.push(g.files); walk(g.children); });
  walk(groups);
  return out;
}

export function buildPrompt(files, links, structural, excerpts) {
  const prior = leafFiles(structural)
    .map((fs, i) => `  ${i + 1}. ${fs.join(", ")}`)
    .join("\n");

  const shown = links.slice(0, MAX_LINKS_IN_PROMPT);
  const body = [];
  for (const f of files.slice(0, EXCERPT_FILES)) {
    const text = excerpts.get(f);
    if (text) body.push(`--- ${f} ---\n${text.slice(0, EXCERPT_CHARS)}`);
  }

  return [
    `FILES (${files.length}):`,
    files.join("\n"),
    ``,
    `IMPORTS (${links.length}${shown.length < links.length ? `, showing ${shown.length}` : ""}):`,
    shown.map((l) => `${l.from} -> ${l.to}`).join("\n") || "(none)",
    ``,
    `STRUCTURAL GROUPING (a hint, computed from imports alone):`,
    prior || "(none)",
    ``,
    `EXCERPTS:`,
    body.join("\n\n") || "(none readable)",
  ].join("\n");
}

const topFolder = (file) => (file.includes("/") ? file.slice(0, file.indexOf("/")) : "");

/** Enforces "one folder per group" rather than trusting the prompt to.
 *
 *  A group mixing backend/ and frontend/ is split along the folder. The
 *  largest piece keeps the group; the rest are fragments, and a fragment is
 *  merged into whichever group in its own folder it actually imports from or
 *  is imported by most — which is nearly always the one it belonged in.
 *
 *  Without this a single Python file inside a mostly-React group makes the
 *  group's label untrue, and turns an ordinary server-to-server import into a
 *  line that appears to run from the server to the browser. */
function oneFolderEach(groups, links, dropped) {
  const kept = [];
  const fragments = [];

  for (const g of groups) {
    const byFolder = new Map();
    for (const f of g.files) {
      const folder = topFolder(f);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(f);
    }
    if (byFolder.size <= 1) { kept.push(g); continue; }

    const pieces = [...byFolder.values()].sort((a, b) => b.length - a.length);
    dropped.push(`split along folders: ${pieces.map((p) => topFolder(p[0]) || "(root)").join(", ")}`);
    kept.push({ why: g.why, files: pieces[0] });
    for (const piece of pieces.slice(1)) fragments.push({ why: g.why, files: piece });
  }

  for (const fragment of fragments) {
    const folder = topFolder(fragment.files[0]);
    const inside = new Set(fragment.files);
    let best = null;
    let bestTies = 0;

    for (const g of kept) {
      if (topFolder(g.files[0]) !== folder) continue;
      const theirs = new Set(g.files);
      const ties = links.filter(
        (l) => (inside.has(l.from) && theirs.has(l.to)) || (theirs.has(l.from) && inside.has(l.to))).length;
      if (ties > bestTies) { bestTies = ties; best = g; }
    }

    if (best) {
      best.files.push(...fragment.files);
      best.files.sort();
    } else {
      // Nothing in its folder it talks to, so it stands on its own rather
      // than being pushed somewhere arbitrary.
      kept.push(fragment);
    }
  }

  return kept;
}

/** Same drop-don't-fail philosophy as every other AI route, with one
 *  addition that matters more here than anywhere else: a file the model
 *  forgot is not dropped from the sheet. It is put back where the structural
 *  grouping had it, because a file missing from the diagram is a file the
 *  reader will never learn about, and silence is the one failure this product
 *  cannot afford.
 *
 *  Returns null when the reply is too damaged to repair, which tells the
 *  caller to keep the structural grouping instead. */
export function validate(raw, files, structural, links = []) {
  const known = new Set(files);
  const claimed = new Set();
  const groups = [];
  const dropped = [];

  for (const g of Array.isArray(raw) ? raw : []) {
    if (!g || !Array.isArray(g.files)) { dropped.push("group without a file list"); continue; }
    const kept = [];
    for (const f of g.files) {
      if (typeof f !== "string" || !known.has(f)) { dropped.push(`not a file in this project: ${JSON.stringify(f)}`); continue; }
      if (claimed.has(f)) { dropped.push(`placed twice, kept the first: ${f}`); continue; }
      claimed.add(f);
      kept.push(f);
    }
    if (kept.length) groups.push({ why: String(g.why || "").slice(0, 300), files: kept.sort() });
  }

  if (!groups.length) return null;

  // Anything the model forgot goes back where the clustering had it — with
  // whichever surviving group already holds most of its structural
  // neighbours, so a forgotten file lands beside the files it was grouped
  // with rather than in a bin of leftovers.
  const missing = files.filter((f) => !claimed.has(f));
  if (missing.length) {
    const priorOf = new Map();
    leafFiles(structural).forEach((fs, i) => fs.forEach((f) => priorOf.set(f, i)));

    for (const file of missing) {
      const bucket = priorOf.get(file);
      let best = null;
      let bestCount = 0;
      for (const g of groups) {
        const shared = g.files.filter((f) => priorOf.get(f) === bucket).length;
        if (shared > bestCount) { bestCount = shared; best = g; }
      }
      (best || groups[0]).files.push(file);
      dropped.push(`left out by the model, restored from the structural grouping: ${file}`);
    }
    groups.forEach((g) => g.files.sort());
  }

  return { groups: oneFolderEach(groups, links, dropped), dropped };
}

/** Semantic groups, flat, in the shape the rest of the pipeline expects.
 *
 *  Nesting is deliberately not applied here, and the reason is measured
 *  rather than assumed. Folding each semantic group with the clustering was
 *  tried first, and it produces containers that own no files of their own —
 *  which means describe.js has nothing to name them from and returns exactly
 *  that: "Nested Component Group", "Support Collection", "Setup Groups". A
 *  box called "Setup Groups" is worse than no box.
 *
 *  Nesting is not abandoned. It needs the model's own rationale for a group
 *  to be carried into naming so a container has something to be named after,
 *  and that is a change to the describe prompt rather than to this file. The
 *  structural path still nests, so the offline sheet keeps that behaviour.
 *
 *  The flat answer is also the one that was measured: the four-repository
 *  comparison that justified this whole change compared flat model groups
 *  against the clustering, and flat is what read well — including on a
 *  99-file repository whose largest group holds thirty files. */
export function shape(groups) {
  const flat = groups.map((g, i) => ({
    id: `g${i + 1}`, why: g.why, files: g.files, children: [],
  }));

  // Wrap the groups in one container per top-level folder, when they happen
  // to divide cleanly along one. On a repo laid out as backend/ and
  // frontend/ that restores the two blocks the sheet is really made of, with
  // the semantic groups folded inside them.
  //
  // Only folders. A container owns no files of its own, so it has nothing to
  // be named after except its children — which works when they share an
  // obvious idea ("Backend Services", "Frontend Application") and fails badly
  // when they do not. Splitting a semantic group by clustering was tried and
  // produced "Nested Component Group" and "Setup Groups", because an
  // arbitrary split gives a namer nothing. A folder every file agrees on is
  // not arbitrary.
  const folderOf = new Map();
  for (const g of flat) {
    const folders = new Set(g.files.map(topFolder));
    // A group spanning two folders is the model saying this is one feature
    // front to back, which is a better observation than the folder layout.
    // Leave it alone.
    if (folders.size !== 1) return flat;
    const only = [...folders][0];
    if (!only) return flat;                    // a file at the repo root
    folderOf.set(g, only);
  }

  const folders = [...new Set(folderOf.values())].sort();
  if (folders.length < 2) return flat;

  return folders.map((folder, i) => {
    const id = `g${i + 1}`;
    const kids = flat.filter((g) => folderOf.get(g) === folder);
    // A container holding one child is the same box with another border
    // drawn round it.
    if (kids.length === 1) return { ...kids[0], id };
    return {
      id,
      files: [],
      children: kids.map((k, j) => ({ ...k, id: `${id}.${j + 1}` })),
    };
  });
}

/** The whole thing. Returns groups shaped exactly like chooseGroups', or null
    when the structural grouping should be kept. Never throws: a scan that
    cannot reach the service is a scan with plainer groups, not a dead scan. */
export async function regroup(files, links, excerpts, structural) {
  if (files.length > MAX_FILES_FOR_SEMANTIC) {
    return { groups: null, reason: `${files.length} files is past what fits in one prompt` };
  }

  let parsed;
  try {
    ({ parsed } = await callTask({
      task: "group",
      prompt: buildPrompt(files, links, structural, excerpts),
    }));
  } catch (err) {
    return { groups: null, reason: err.message };
  }

  const checked = validate(parsed && parsed.groups, files, structural, links);
  if (!checked) return { groups: null, reason: "the model returned no usable groups" };

  return { groups: shape(checked.groups), dropped: checked.dropped };
}
