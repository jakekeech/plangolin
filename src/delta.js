// Compares the sheet against a freshly computed file graph and reports what
// moved. Never re-clusters: block identity and file membership are fixed
// once proposed, because a sheet that regroups itself on every sync produces
// a delta made of noise rather than information.
//
// The output is a report, not a queue. plangolin's reader is often someone
// finding out how a system works — asking them "did you intend this link?"
// is a question they cannot answer. So every change is phrased as a
// statement, and the one exception is a line the user drew themselves, where
// they did make a claim worth defending.

import { expandAnchor } from "./schema.js";

/** Which block owns each file on the sheet today. */
function ownership(nodes, files) {
  const owner = new Map();
  for (const node of nodes) {
    for (const file of expandAnchor(node, files)) owner.set(file, node.id);
  }
  return owner;
}

/** The block a new file should join: the one its links point into most
    often, and only when a single block wins outright. */
function proposeBlock(file, links, owner) {
  const votes = new Map();
  for (const link of links) {
    const other = link.from === file ? link.to : link.to === file ? link.from : null;
    if (other === null) continue;
    const block = owner.get(other);
    if (!block) continue;
    votes.set(block, (votes.get(block) || 0) + 1);
  }
  if (!votes.size) return null;
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;   // no outright winner
  return ranked[0][0];
}

export function computeDelta(doc, graph, changed = null) {
  const nodes = (doc && doc.nodes) || [];
  const edges = (doc && doc.edges) || [];
  const files = graph.files || [];
  const links = graph.links || [];

  const changes = [];
  const present = new Set(files);
  const owner = ownership(nodes, files);

  // Files the sheet claims that no longer exist.
  for (const node of nodes) {
    const claimed = Array.isArray(node.anchor && node.anchor.paths) ? node.anchor.paths : [];
    for (const file of claimed) {
      if (!present.has(file)) changes.push({ type: "file-removed", block: node.id, file });
    }
    if (claimed.length && !expandAnchor(node, files).length) {
      changes.push({ type: "block-emptied", block: node.id });
    }
  }

  // Files a block still owns whose contents moved. This is the only change
  // type here that needs a baseline — every other one is computed from the
  // sheet and the file graph alone, which is why `changed` is optional and
  // its absence simply means the sheet says nothing about content.
  //
  // No overlap with file-added is possible: that fires only for files no
  // block owns yet, and this fires only for files a block already owns.
  //
  // expandAnchor filters against graph.files, which filegraph.js already
  // sorted and already excludes lockfiles and other non-source paths from.
  // So the suppression rule and the ordering guarantee both come for free.
  if (changed) {
    for (const node of nodes) {
      const touched = expandAnchor(node, files).filter((f) => changed.has(f));
      if (touched.length) {
        changes.push({ type: "block-changed-inside", block: node.id, files: touched });
      }
    }
  }

  // Files that exist but no block owns.
  for (const file of files) {
    if (owner.has(file)) continue;
    const block = proposeBlock(file, links, owner);
    changes.push(block ? { type: "file-added", block, file } : { type: "file-unmapped", file });
  }

  // What the code says about block-to-block relationships, right now.
  const backing = new Map();
  for (const { from, to, kind } of links) {
    const a = owner.get(from);
    const b = owner.get(to);
    if (!a || !b || a === b) continue;
    const key = a + " " + b;
    if (!backing.has(key)) backing.set(key, new Set());
    backing.get(key).add(kind);
  }

  const drawn = new Map(edges.map((e) => [e.from + " " + e.to, e]));
  const summary = { confirmed: 0, unverified: 0, contradicted: 0 };

  for (const edge of edges) {
    const kinds = backing.get(edge.from + " " + edge.to);
    if (kinds && kinds.has("import")) summary.confirmed += 1;
    else if (kinds) summary.unverified += 1;
    else if (edge.origin === "user") {
      summary.contradicted += 1;
      changes.push({ type: "edge-contradicted", edgeId: edge.id, from: edge.from, to: edge.to });
    } else {
      changes.push({ type: "edge-lost", edgeId: edge.id, from: edge.from, to: edge.to });
    }
  }

  for (const key of [...backing.keys()].sort()) {
    if (drawn.has(key)) continue;
    const [from, to] = key.split(" ");
    const kinds = backing.get(key);
    changes.push({ type: "edge-added", from, to, kind: kinds.has("import") ? "import" : "name" });
  }

  return { changes, summary };
}
