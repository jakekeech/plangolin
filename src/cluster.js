// Community detection over the file graph — the thing that decides which
// files belong in the same block, when the folders cannot say.
//
// Louvain rather than something simpler because it is natively hierarchical:
// it works by merging communities into super-communities and repeating, and
// each round is a level. That hierarchy is exactly plangolin's nesting, so
// one algorithm gives both the blocks and the blocks inside them.
//
// Every iteration order is sorted. Louvain's result depends on the order
// nodes are visited, and an unstable clustering would mean the same repo
// producing a different sheet on each scan.

/** Undirected weighted adjacency, built once per level.
 *
 *  Self-loops are load-bearing, not noise. When a level aggregates, every
 *  edge inside a community collapses into a self-loop on its super-node, and
 *  that weight is the whole reason a dense community resists being absorbed
 *  by a neighbour at the next level. Drop them and the top level merges the
 *  entire graph into one block. */
function adjacency(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n, new Map()]));
  const loops = new Map(nodes.map((n) => [n, 0]));
  let total = 0;
  for (const { from, to, weight = 1 } of edges) {
    if (!adj.has(from) || !adj.has(to)) continue;
    if (from === to) {
      loops.set(from, loops.get(from) + weight);
    } else {
      adj.get(from).set(to, (adj.get(from).get(to) || 0) + weight);
      adj.get(to).set(from, (adj.get(to).get(from) || 0) + weight);
    }
    total += weight;
  }
  return { adj, loops, total };
}

/** Degree with self-loops counted twice, as modularity requires. */
function degrees(adj, loops) {
  const deg = new Map();
  for (const [node, nbrs] of adj) {
    let d = 0;
    for (const w of nbrs.values()) d += w;
    deg.set(node, d + 2 * loops.get(node));
  }
  return deg;
}

/** One Louvain pass: move nodes between communities while modularity
    improves. Returns {node -> community}. */
function localMoving(nodes, adj, loops, total) {
  const community = new Map(nodes.map((n) => [n, n]));
  if (total === 0) return community;

  const deg = degrees(adj, loops);
  const m2 = 2 * total;
  const tot = new Map(nodes.map((n) => [n, deg.get(n)]));

  let improved = true;
  let rounds = 0;
  while (improved && rounds < 20) {
    improved = false;
    rounds += 1;

    for (const node of nodes) {                    // nodes is pre-sorted
      const own = community.get(node);
      const k = deg.get(node);
      tot.set(own, tot.get(own) - k);

      // Weight from this node into each neighbouring community.
      const into = new Map();
      for (const [nbr, w] of [...adj.get(node)].sort((a, b) => a[0].localeCompare(b[0]))) {
        const c = community.get(nbr);
        into.set(c, (into.get(c) || 0) + w);
      }

      let best = own;
      let bestGain = (into.get(own) || 0) - (tot.get(own) * k) / m2;
      for (const [c, weight] of [...into].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
        const gain = weight - (tot.get(c) * k) / m2;
        // Strict > keeps the current community on a tie, which is what makes
        // the result independent of the order communities were discovered.
        if (gain > bestGain) { bestGain = gain; best = c; }
      }

      tot.set(best, tot.get(best) + k);
      if (best !== own) { community.set(node, best); improved = true; }
    }
  }
  return community;
}

export function louvain(nodes, edges) {
  const sorted = [...new Set(nodes)].sort();
  if (!sorted.length) return [new Map()];

  const levels = [];
  let current = sorted;
  let currentEdges = edges;
  // Maps an original node to the super-node representing it at this level.
  let membership = new Map(sorted.map((n) => [n, n]));

  for (let depth = 0; depth < 10; depth++) {
    const { adj, loops, total } = adjacency(current, currentEdges);
    const community = localMoving(current, adj, loops, total);

    // Name each community after its lowest-sorting member, so ids are
    // stable and readable rather than incrementing integers.
    const canonical = new Map();
    for (const node of current) {
      const c = community.get(node);
      if (!canonical.has(c) || node < canonical.get(c)) canonical.set(c, node);
    }

    const level = new Map();
    for (const original of sorted) {
      level.set(original, canonical.get(community.get(membership.get(original))));
    }
    levels.push(level);

    const distinct = new Set(level.values());
    if (distinct.size === current.length) break;   // nothing merged; done

    membership = level;
    current = [...distinct].sort();
    // Aggregate. Edges that stayed inside a community become that
    // community's self-loop — see the note on adjacency().
    const merged = new Map();
    for (const { from, to, weight = 1 } of currentEdges) {
      const a = canonical.get(community.get(from));
      const b = canonical.get(community.get(to));
      if (a === undefined || b === undefined) continue;
      const key = a <= b ? a + " " + b : b + " " + a;
      merged.set(key, (merged.get(key) || 0) + weight);
    }
    currentEdges = [...merged.keys()].sort().map((k) => {
      const [from, to] = k.split(" ");
      return { from, to, weight: merged.get(k) };
    });
    if (!currentEdges.length) break;
  }

  return levels;
}

const DEFAULTS = { maxPerLevel: 6, maxDepth: 3, minSplit: 10, fanIn: 0.6, minForHubs: 6 };

/** Files that nearly everything imports — a `models.py`, a `types.ts`, a
    `utils.js`.
 *
 *  These wreck community detection. Clustering groups things that are densely
 *  connected to each other, and a file connected to *everything* makes
 *  everything look connected to everything, so the whole graph collapses into
 *  one box. Müller called them omnipresent modules; Bunch removes them and
 *  their edges before clustering and puts them aside, and its own case study
 *  is exactly this — high fan-in nodes that turned out to be "include files
 *  that define data types common to many of the other program modules."
 *
 *  Bunch's threshold is 3x the mean degree, and that rule cannot fire on a
 *  small graph: with nine files and twenty-one edges the mean degree is 4.67,
 *  so the threshold is 14 — higher than the largest degree the graph can hold.
 *  The two real hubs in that repo sit at 1.71x. So this uses a fraction of
 *  possible importers instead, which is scale-free by construction.
 *
 *  Only in-degree counts. A file that imports many others is an entry point,
 *  and entry points are exactly the structure worth keeping. */
export function omnipresent(files, links, opts = {}) {
  const { fanIn, minForHubs } = { ...DEFAULTS, ...opts };
  // Below a handful of files every ratio is noise: with four files, one
  // importer is already 33%.
  if (files.length < minForHubs) return new Set();

  const inside = new Set(files);
  const importers = new Map(files.map((f) => [f, new Set()]));
  for (const { from, to } of links) {
    if (inside.has(from) && importers.has(to) && from !== to) importers.get(to).add(from);
  }

  const needed = Math.max(2, Math.ceil((files.length - 1) * fanIn));
  const hubs = new Set();
  for (const [file, who] of importers) if (who.size >= needed) hubs.add(file);

  // If half the graph looks omnipresent, nothing is: that is a dense little
  // system, not a system with a shared core, and pulling it apart would
  // invent a distinction the code does not make.
  return hubs.size > files.length / 2 ? new Set() : hubs;
}

/** Longest common directory prefix. Without this, a repo where everything
    sits under one root folder would produce a single bucket named after that
    root and tell us nothing.
    Compared segment by segment, not character by character — a character
    slice can stop mid-segment ("spell" out of "spell-library-web") or, when
    the shared root is exactly one segment deep with nothing after it (a repo
    where source lives in one folder alongside root-level config files), can
    discard the whole prefix instead of using it. Neither is a real directory
    boundary, and either one collapses every file into a single bucket. */
function commonPrefix(files) {
  if (!files.length) return "";
  const dirs = files.map((f) => {
    const i = f.lastIndexOf("/");
    return i === -1 ? [] : f.slice(0, i).split("/");
  });
  let segs = dirs[0];
  for (const d of dirs) {
    let i = 0;
    while (i < segs.length && i < d.length && segs[i] === d[i]) i++;
    segs = segs.slice(0, i);
    if (!segs.length) return "";
  }
  return segs.join("/") + "/";
}

/** Files grouped by their first directory segment. Files sitting directly at
    the common root share one bucket — they have no folder to speak for them,
    and that bucket sorts first so the shape is stable. */
export function folderBuckets(files) {
  const prefix = commonPrefix(files);
  const groups = new Map();
  for (const file of files) {
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    const key = slash === -1 ? "" : rest.slice(0, slash);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, group]) => group.sort());
}

/** Folders are preferred whenever there is more than one of them. Only a
    single bucket means the directory tree cannot separate anything, and
    community detection has to do the work instead.
    This used to also reject folders when one held more than 70% of the
    files — a rule borrowed from Understand-Anything, whose containers are
    flat. plangolin nests, so a dominant folder is the thing to recurse into,
    not a reason to throw the whole partition away. Applying the flat rule
    here gave fastify (76% in test/) a single block for 297 files, and hono
    (80% in src/) ninety top-level blocks. */
export function shouldCluster(buckets) {
  return buckets.length < 2;
}

/** All files sharing a community at `level`, as sorted buckets. */
function bucketsAt(level, files) {
  const buckets = new Map();
  for (const file of files) {
    const c = level.get(file);
    if (c === undefined) continue;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(file);
  }
  return [...buckets.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([, group]) => group.sort());
}

/** Walks levels coarsest-first and takes the first that is small enough.
    If none is, the COARSEST is used — it is the closest thing to the goal,
    and everything it leaves oversized gets split by the recursion below.
    Falling back to the finest instead, as this once did, hands back the most
    fragmented partition available: hono produced ninety top-level blocks. */
function pickLevel(levels, files, maxPerLevel) {
  for (let i = levels.length - 1; i >= 0; i--) {
    const buckets = bucketsAt(levels[i], files);
    if (buckets.length > 1 && buckets.length <= maxPerLevel) return buckets;
  }
  return bucketsAt(levels[levels.length - 1], files);
}

/** Folders when they mean something, clustering when they do not. */
function partition(levels, subset, maxPerLevel) {
  const folders = folderBuckets(subset);
  if (!shouldCluster(folders)) return folders;
  return pickLevel(levels, subset, maxPerLevel);
}

export function chooseGroups(levels, files, opts = {}) {
  const { maxPerLevel, maxDepth, minSplit, links } = { ...DEFAULTS, ...opts };

  // Omnipresence is relative to the scope you are asking about, and that is
  // not a detail. In the repo this was built for, `models.py` is imported by
  // seven of the eight files beside it — plainly the shared core — but across
  // the whole project it is imported by seven of twenty-eight, which is
  // nothing at all. Measured globally it is invisible; measured within its
  // own folder it is unmissable. So it is measured per subset, on the way
  // down.
  const hubsIn = (subset) => (links ? omnipresent(subset, links, opts) : new Set());

  /** Pull the shared core out, cluster what is left without it, and hand the
      core back as a group of its own. */
  const partitionOf = (subset) => {
    const folders = folderBuckets(subset);
    if (!shouldCluster(folders)) return folders;

    const hubs = hubsIn(subset);
    if (!hubs.size) return pickLevel(levels, subset, maxPerLevel);

    const rest = subset.filter((f) => !hubs.has(f));
    const restLinks = links.filter((l) => !hubs.has(l.from) && !hubs.has(l.to));
    // Fresh levels for the subset: the global ones were computed with these
    // files still in, which is the flattening this is here to undo.
    const buckets = pickLevel(louvain(rest, restLinks), rest, Math.max(1, maxPerLevel - 1));
    return [...buckets, [...hubs].sort()];
  };

  const makeGroup = (group, depth, id) => {
    // A group under minSplit still earns a split if it has a shared core,
    // because "seven files and the two things they all lean on" is a
    // structure, and drawing it as one box throws that away. This is the
    // whole reason a nine-file backend used to render as a featureless blob.
    const splittable = (group.length >= minSplit || hubsIn(group).size > 0) && depth < maxDepth;
    const children = splittable ? build(group, depth + 1, id + ".") : [];
    // A split that produced one child has told us nothing; keep it flat.
    if (children.length <= 1) return { id, files: group, children: [] };
    return { id, files: [], children };
  };

  /** A partition earns its place only if it explains something. Splitting
      six files into six boxes is the same list with more borders drawn on
      it, so a partition that is mostly singletons is refused and the group
      stays whole. */
  const useful = (buckets) => {
    if (buckets.length <= 1) return false;
    const singletons = buckets.filter((b) => b.length === 1).length;
    return singletons <= buckets.length / 2;
  };

  const build = (subset, depth, prefix) => {
    const buckets = partitionOf(subset);
    if (!useful(buckets)) return [{ id: `${prefix}1`, files: subset, children: [] }];
    return buckets.map((group, i) => makeGroup(group, depth, `${prefix}${i + 1}`));
  };

  return build([...files].sort(), 1, "g");
}

/** The whole grouping decision, hubs included. Callers used to do
    `chooseGroups(louvain(files, links), files)`, which hands the clustering a
    graph its shared files have already flattened. Threading the links through
    lets each subset have its own shared core pulled out on the way down. */
export function groupFiles(files, links, opts = {}) {
  return chooseGroups(louvain(files, links), files, { ...opts, links });
}
