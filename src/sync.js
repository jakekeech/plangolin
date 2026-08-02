// "Check against code" — free, read-only, no key and no network. Reports
// where the sheet and the code disagree, and never writes anything.
//
// The import guessing this file used to do by regex over one folder is gone:
// filegraph.js now computes every reference in the project properly, so this
// only has to compare. Results are never persisted — "never store what you
// can compute", and a drift detector that cached stale state would be
// self-defeating.

import path from "node:path";
import { buildFileGraph } from "./filegraph.js";
import { computeDelta } from "./delta.js";
import { expandAnchor } from "./schema.js";
import { makeGit } from "./git.js";
import { resolveBaseline } from "./baseline.js";
import { groupChanges } from "./changesets.js";

export { SOURCE_EXT } from "./filegraph.js";

/** The existing UI lists one folder per block. A block owning a set of
    files reports the directory they share, so that surface keeps working. */
function folderOf(node, files) {
  if (node.anchor && typeof node.anchor.dir === "string") return node.anchor.dir;
  const owned = expandAnchor(node, files);
  if (owned.length) return path.posix.dirname(owned[0]);
  const claimed = (node.anchor && node.anchor.paths) || [];
  return claimed.length ? path.posix.dirname(claimed[0]) : "";
}

export async function runSync(ws, doc, spec, git = makeGit(ws.root)) {
  const nodes = (doc && doc.nodes) || [];
  const graph = await buildFileGraph(ws);

  // Resolved before the delta because the delta needs the file set, and
  // resolved leniently because a project with no git is not a broken project.
  const baseline = spec ? await resolveBaseline(git, spec) : null;
  const files = baseline ? baseline.files : null;

  const { changes, summary } = computeDelta(doc || { nodes: [], edges: [] }, graph, files);

  /* Group the changed blocks into separate changes. Grouped on what the code
     does, not on what the sheet draws: a line someone hasn't drawn yet is
     still a reason two blocks moved together, and a change the diagram is
     behind on is exactly the case this exists for. */
  const moved = changes.filter((c) => c.type === "block-changed-inside").map((c) => c.block);
  const owner = new Map();
  for (const node of nodes) for (const f of expandAnchor(node, graph.files)) owner.set(f, node.id);
  const between = [];
  const seenPair = new Set();
  for (const { from, to } of graph.links) {
    const a = owner.get(from), b = owner.get(to);
    if (!a || !b || a === b) continue;
    const key = a + ">" + b;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    between.push({ from: a, to: b });
  }
  const groups = groupChanges(moved, between);

  const folders = nodes
    .filter((n) => n.anchor)
    .map((n) => ({
      id: n.id,
      name: n.name,
      dir: folderOf(n, graph.files),
      exists: expandAnchor(n, graph.files).length > 0,
      invalid: false,
    }));

  return {
    root: ws.root,
    folders,
    summary,
    changes,
    capped: graph.capped,
    groups,
    // The ref actually used, echoed back so the app can say what it compared
    // against rather than what it asked for — those differ whenever git is
    // absent, and a UI that shows the request rather than the result lies.
    // `fellBack` travels with it: the app must be able to tell "everything
    // since you last looked" from "we could not work out when that was, so
    // here is your uncommitted work instead".
    baseline: baseline && {
      kind: baseline.kind, ref: baseline.ref,
      ...(baseline.against ? { against: baseline.against } : {}),
      ...(baseline.fellBack ? { fellBack: true } : {}),
      ...(baseline.rootCommit ? { rootCommit: true } : {}),
    },
  };
}
