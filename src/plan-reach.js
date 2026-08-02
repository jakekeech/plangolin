export function planReach(edges, changedIds) {
  const changed = new Set(changedIds || []);
  const seen = new Set();
  const out = [];

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || !changed.has(edge.to)) continue;
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.label}`;
    // A repeated sheet edge should not become two identical reading prompts.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: edge.from, via: edge.to, label: edge.label });
  }

  return out;
}
