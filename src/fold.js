// Which blocks belong inside another block.
//
// The test is whether you can understand the parent without knowing the child
// exists. That sounds like a judgement, but the import graph answers it:
//
//   used by exactly one thing  ->  an implementation detail of that thing
//   used by two or more        ->  shared, and hiding it inside one of them
//                                  would be a lie
//
// This is the rule the canvas already suggests by hand — "blocks that hang
// off exactly one hub and talk to nothing else" (app.js) — applied by the
// scan so a sheet arrives folded rather than needing to be folded.
//
// What it deliberately is NOT is size. "This box has nine files, split it in
// half" was tried and produced containers called "Nested Component Group" and
// "Setup Groups", because a border drawn through the middle of one idea
// leaves the parent with nothing to be named after. Size is a reason to want
// to fold something; it is not a rule for what to fold.

/** Which block directly owns each file. Files live on leaves. */
function ownerOf(groups) {
  const owner = new Map();
  const walk = (gs) => gs.forEach((g) => { g.files.forEach((f) => owner.set(f, g.id)); walk(g.children); });
  walk(groups);
  return owner;
}

/** Block-to-block edges, as directed pairs. Computed here rather than
    imported from adopt.js, which would be a cycle. */
function blockEdges(groups, links) {
  const owner = ownerOf(groups);
  const edges = new Set();
  for (const { from, to } of links) {
    const a = owner.get(from);
    const b = owner.get(to);
    if (a && b && a !== b) edges.add(a + " " + b);
  }
  return [...edges].map((k) => k.split(" "));
}

/** Everything each block touches, in either direction, and who uses it. */
function connections(edges) {
  const touches = new Map();
  const usedBy = new Map();
  const see = (id) => {
    if (!touches.has(id)) touches.set(id, new Set());
    if (!usedBy.has(id)) usedBy.set(id, new Set());
  };
  for (const [from, to] of edges) {
    see(from); see(to);
    touches.get(from).add(to);
    touches.get(to).add(from);
    usedBy.get(to).add(from);          // an edge from -> to means `from` uses `to`
  }
  return { touches, usedBy };
}

/** Fold every block that serves exactly one master into that master.
 *
 *  Only siblings are considered, which keeps a fold inside one region: a
 *  frontend block can never be folded into a backend one, and the lines that
 *  cross between them — the network calls, the most interesting lines on the
 *  sheet — are exactly the ones that give a block a second connection and so
 *  stop it being foldable at all.
 *
 *  `minChildren` is 2 because folding a single block into another is a border
 *  drawn for no reason: it hides one name and adds one box. */
export function fold(groups, links, opts = {}) {
  const { minChildren = 2 } = opts;
  const { touches, usedBy } = connections(blockEdges(groups, links));

  const foldInto = (siblings) => {
    const leaves = siblings.filter((g) => g.files.length && !g.children.length);
    const byHub = new Map();

    for (const child of leaves) {
      const near = touches.get(child.id);
      if (!near || near.size !== 1) continue;              // shared, or an island
      const hub = [...near][0];
      // The single connection must be someone using this block. A block that
      // only reaches OUT to one other is a consumer, not a detail of it —
      // folding an entry point into the thing it calls hides the way in.
      if (!usedBy.get(child.id)?.has(hub)) continue;
      if (!leaves.some((g) => g.id === hub)) continue;      // not a sibling; leave it
      if (!byHub.has(hub)) byHub.set(hub, []);
      byHub.get(hub).push(child);
    }

    const moved = new Set();
    for (const [hubId, children] of byHub) {
      if (children.length < minChildren) continue;
      const hub = siblings.find((g) => g.id === hubId);
      if (!hub) continue;
      hub.children = [
        ...hub.children,
        ...children.map((c, i) => ({ ...c, id: `${hubId}.${hub.children.length + i + 1}` })),
      ];
      children.forEach((c) => moved.add(c.id));
    }

    return siblings.filter((g) => !moved.has(g.id));
  };

  const walk = (gs) => foldInto(gs.map((g) => ({ ...g, children: walk(g.children) })));
  return walk(groups);
}
