import { expandAnchor } from "./schema.js";

const list = (value) => Array.isArray(value) ? value : [];

/** Add only relationships the current code proves and the saved map omitted.
 * Existing lines always win: their reviewed label and operations are part of
 * the user's map, while inferred lines are transient review context. */
export function completeMapEdges(nodes, edges, graph) {
  const kept = [...list(edges)];
  const files = list(graph && graph.files);
  const owner = new Map();
  for (const node of list(nodes)) {
    for (const file of expandAnchor(node, files)) owner.set(file, node.id);
  }

  const present = new Set(kept.map((edge) => edge.from + "\0" + edge.to));
  const inferred = new Map();
  for (const link of list(graph && graph.links)) {
    const from = owner.get(link.from);
    const to = owner.get(link.to);
    if (!from || !to || from === to || present.has(from + "\0" + to)) continue;
    const key = from + "\0" + to;
    if (!inferred.has(key)) inferred.set(key, { from, to, kinds: new Set(), names: new Set() });
    const entry = inferred.get(key);
    entry.kinds.add(link.kind);
    for (const name of list(link.names)) if (name) entry.names.add(name);
  }

  for (const entry of [...inferred.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
    const names = [...entry.names].sort().slice(0, 8);
    kept.push({
      id: `scan:${entry.from}>${entry.to}`,
      from: entry.from,
      to: entry.to,
      label: entry.kinds.has("http") ? "calls API" : "imports",
      origin: "scan",
      operations: names.map((name) => ({ name, sends: "", returns: "" })),
    });
  }
  return kept;
}
