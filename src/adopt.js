// "Scan my code" — the cold-start counterpart to generate.js, grounded in
// real files instead of a one-sentence description.
//
// Structure is computed, not asked for. filegraph.js works out what
// references what, cluster.js works out what groups with what, and only then
// does a model get asked what to call the result. The previous version asked
// a model to spot connections in a handful of excerpts and — correctly, given
// what it could see — found none, which is why this repo produced a sheet
// with three blocks and no lines at all.
//
// See the graph-sync design doc for the whole pipeline, and design.md §16
// for why this writes in one shot rather than through a review queue.

import path from "node:path";
import { buildFileGraph } from "./filegraph.js";
import { groupFiles } from "./cluster.js";
import { regroup, EXCERPT_FILES } from "./regroup.js";
import { fold } from "./fold.js";
import { describeGroups } from "./describe.js";

const MAX_EXCERPT_FILES = 4;
const MAX_EXCERPT_CHARS = 1400;

/** Every group, flattened, each carrying its own files and those of its
    descendants — a container's dependencies are its contents'. */
function flatten(groups) {
  const out = [];
  const walk = (gs, parent) => {
    for (const g of gs) {
      const all = [...g.files];
      const collect = (kids) => kids.forEach((k) => { all.push(...k.files); collect(k.children); });
      collect(g.children);
      out.push({
        id: g.id,
        parent,
        files: g.files,
        allFiles: all,
        children: g.children,
        rationale: g.why || "",
      });
      walk(g.children, g.id);
    }
  };
  walk(groups, null);
  return out;
}

/** Which group owns each file. Files live on leaves, so an edge is drawn at
    the deepest pair of groups that actually holds its two ends apart. */
function ownerOf(groups) {
  const owner = new Map();
  const walk = (gs) => {
    for (const g of gs) {
      for (const f of g.files) owner.set(f, g.id);
      walk(g.children);
    }
  };
  walk(groups);
  return owner;
}

/** Names shown on one line. Enough to say what crosses without turning the
    line into a directory listing. */
const MAX_OPERATIONS = 8;

export function rollUpEdges(groups, links) {
  const owner = ownerOf(groups);
  const pairs = new Map();

  for (const { from, to, kind, names } of links) {
    const a = owner.get(from);
    const b = owner.get(to);
    if (!a || !b || a === b) continue;
    const key = a + " " + b;
    if (!pairs.has(key)) pairs.set(key, { kinds: new Set(), names: new Set() });
    pairs.get(key).kinds.add(kind);
    for (const n of names || []) pairs.get(key).names.add(n);
  }

  return [...pairs.keys()].sort().map((key) => {
    const [from, to] = key.split(" ");
    const { kinds, names } = pairs.get(key);
    return {
      from,
      to,
      kinds: [...kinds].sort(),
      names: [...names].sort().slice(0, MAX_OPERATIONS),
    };
  });
}

export function groupDeps(groups, links) {
  const deps = new Map(flatten(groups).map((g) => [g.id, new Set()]));
  for (const { from, to } of rollUpEdges(groups, links)) {
    if (deps.has(from)) deps.get(from).add(to);
  }
  return new Map([...deps].map(([id, set]) => [id, [...set].sort()]));
}

/** Used when the model call fails or drops a block. A graph with plain
    names beats no graph — never a dead end. */
export function fallbackName(files) {
  if (!files.length) return "Group";
  const base = path.posix.basename(files[0]).replace(/\.[^.]+$/, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function slugFor(files, used) {
  const raw = files.length
    ? path.posix.basename(files[0]).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    : "group";
  const base = /^[a-z]/.test(raw) ? raw : "g-" + raw;
  let id = base;
  let n = 2;
  while (used.has(id)) { id = `${base}-${n}`; n++; }
  return id;
}

/** What the scan already knows before the model is asked anything.
 *
 *  The whole deterministic half — read every file, resolve every import,
 *  work out the groups — takes about fifteen milliseconds. Naming takes
 *  fifteen seconds. Past ten seconds a wait is meant to say more than "still
 *  going" (Nielsen's third response-time limit), and the honest thing to say
 *  here is what has actually been found. So the counts are offered on their
 *  own, immediately, and the sheet fills in when the names arrive.
 *
 *  Recomputes rather than caching: it costs milliseconds, and a cache keyed
 *  on nothing is how a scan starts describing a repo as it was a minute ago. */
export async function survey(ws) {
  const graph = await buildFileGraph(ws);
  if (!graph.files.length) return { files: 0, links: 0, blocks: 0, capped: graph.capped };

  const groups = groupFiles(graph.files, graph.links);
  let blocks = 0;
  const count = (gs) => gs.forEach((g) => { blocks++; count(g.children); });
  count(groups);

  return { files: graph.files.length, links: graph.links.length, blocks, capped: graph.capped };
}

export async function discoverProject(ws, { graph: injectedGraph, onProgress } = {}) {
  const graph = injectedGraph === undefined ? await buildFileGraph(ws) : injectedGraph;
  await onProgress?.({
    phase: "mapping_project",
    counts: { files: graph.files.length, links: graph.links.length },
  });

  const dropped = [];
  if (graph.capped) dropped.push("the project is larger than the scan cap; some files were not read");
  if (!graph.files.length) {
    const groups = [];
    const flatGroups = [];
    await onProgress?.({ phase: "grouping_components", counts: { components: 0 } });
    return {
      graph,
      groups,
      flatGroups,
      dependencies: new Map(),
      excerpts: new Map(),
      dropped: ["no source files found"],
    };
  }

  // Clustering first, always. It is the hint the model is given, and it is
  // the answer kept when the model cannot be reached, when the project is too
  // large to fit in a prompt, or when the reply cannot be trusted.
  const structural = groupFiles(graph.files, graph.links);

  // Read once at the larger budget and let both consumers take what they
  // need: regrouping wants a little from many files, describing wants a lot
  // from a few.
  const excerpts = new Map();
  const readInto = async (file) => {
    if (excerpts.has(file)) return;
    const text = await ws.read(file);
    if (text) excerpts.set(file, text.slice(0, MAX_EXCERPT_CHARS));
  };
  for (const file of graph.files.slice(0, EXCERPT_FILES)) await readInto(file);

  const semantic = await regroup(graph.files, graph.links, excerpts, structural);
  if (!semantic.groups) dropped.push(`grouped by imports alone: ${semantic.reason}`);
  else dropped.push(...(semantic.dropped || []));
  // Blocks that serve exactly one master go inside it. See fold.js — the
  // test is whether the parent can be understood without knowing the child
  // exists, and the import graph answers it.
  const groups = fold(semantic.groups || structural, graph.links);

  const flatGroups = flatten(groups);
  const dependencies = groupDeps(groups, graph.links);
  for (const g of flatGroups) {
    for (const file of g.files.slice(0, MAX_EXCERPT_FILES)) await readInto(file);
  }

  await onProgress?.({
    phase: "grouping_components",
    counts: { components: flatGroups.length },
  });

  return { graph, groups, flatGroups, dependencies, excerpts, dropped };
}

export async function nameProject(
  discovery,
  { describe = describeGroups, onProgress } = {},
) {
  await onProgress?.({
    phase: "naming_and_matching",
    counts: { components: discovery.flatGroups.length },
  });

  let described = { blocks: [], labels: new Map(), dropped: [], provider: null, model: null };
  try {
    described = await describe(
      discovery.groups,
      discovery.dependencies,
      discovery.excerpts,
    );
  } catch (err) {
    // A dead model call must never mean a dead scan.
    described.dropped.push(`naming failed, using file names instead: ${err.message}`);
  }

  return described;
}

export function movesFromDiscovery(discovery, described) {
  const byGroup = new Map(described.blocks.map((b) => [b.groupId, b]));
  const usedIds = new Set(described.blocks.map((b) => b.id));
  const idFor = new Map();
  const moves = [];

  for (const g of discovery.flatGroups) {
    const block = byGroup.get(g.id);
    const id = block ? block.id : slugFor(g.allFiles, usedIds);
    if (!block) usedIds.add(id);
    idFor.set(g.id, id);

    const node = {
      id,
      name: block ? block.name : fallbackName(g.allFiles),
      kind: block ? block.kind : "",
      intent: block ? block.intent : "",
      details: block ? block.details : "",
    };
    if (g.files.length) node.anchor = { paths: g.files };
    if (g.parent) node.parent = idFor.get(g.parent);
    moves.push({ t: "addNode", node });
  }

  for (const edge of rollUpEdges(discovery.groups, discovery.graph.links)) {
    const from = idFor.get(edge.from);
    const to = idFor.get(edge.to);
    if (!from || !to || from === to) continue;
    moves.push({
      t: "connect",
      from,
      to,
      // The model names the relationship; the import graph decided the line
      // exists. "imports" is true of every line on the sheet and therefore
      // says nothing, so it is only the fallback when a label went missing.
      label: described.labels.get(`${edge.from} ${edge.to}`) || "imports",
      origin: "scan",
      // What actually crosses, taken straight from the import statements —
      // no model involved. A line with none is drawn dashed and raises a
      // "what crosses this?" check, which is right for a line nobody has
      // pinned down, and wrong for one the code already answers.
      operations: edge.names.map((name) => ({ name, sends: "", returns: "" })),
    });
  }

  return { moves, idFor };
}

export function provisionalImpactContext(discovery) {
  const groups = discovery.flatGroups.map((group) => ({
    ref: group.id,
    parent: group.parent,
    files: [...group.files],
    rationale: group.rationale,
    dependencies: [...(discovery.dependencies.get(group.id) || [])],
  }));
  const edges = [];
  for (const group of groups) {
    for (const dependency of group.dependencies) {
      edges.push({ from: group.ref, to: dependency });
    }
  }

  return { nodes: [], edges, groups };
}

export async function adopt(ws, options = {}) {
  const { graph, describe, onProgress } = options;
  const discovery = await discoverProject(ws, { graph, onProgress });
  if (!discovery.graph.files.length) {
    return { moves: [], dropped: discovery.dropped, provider: null, model: null };
  }

  const described = await nameProject(discovery, { describe, onProgress });
  const { moves } = movesFromDiscovery(discovery, described);
  return {
    moves,
    dropped: [...discovery.dropped, ...described.dropped],
    provider: described.provider,
    model: described.model,
  };
}
