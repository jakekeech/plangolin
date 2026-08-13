# Shared Graph Layout Design

**Date:** 2026-08-13

## Problem

Freshly generated sheets use `layeredPositions`, while plan proposals use a
separate index-driven `ghostPositions` path. Proposal-to-proposal connections
therefore do not influence placement, high-degree proposals are not pulled
toward their neighbours, and a plan commonly appears as a straight row.

The existing base layout is Sugiyama-inspired rather than a complete
Sugiyama implementation. Its layered seed is useful, but sharing the current
static call verbatim would move user-arranged nodes during a plan review and
would still treat a long chain as a desirable straight line.

## Decision

Create one deterministic, dependency-free layout engine with two modes:

- `full`: every node is movable. Used for generated sheets and completely
  unpositioned levels.
- `incremental`: existing nodes and manually dragged proposals are fixed;
  only new proposals move. Used by plan review.

Both modes consume the same node and edge representation and use the same
ordering and placement rules. The mode changes which nodes are fixed, not
which layout algorithm is selected.

## Layout contract

`layoutGraph(nodes, edges, options)` returns a `Map<string, {x, y}>`.

Each node has:

```js
{
  id: "api",
  x: 250,             // required only when fixed
  y: 0,               // required only when fixed
  width: 198,         // optional
  height: 80,         // optional
  fixed: true         // optional
}
```

The solver must:

1. return the same coordinates for the same input;
2. return fixed coordinates byte-for-byte unchanged;
3. prevent node-box overlap;
4. use edges, including proposal-to-proposal edges, during placement;
5. place higher-degree nodes nearer the neighbours they connect;
6. wrap directed runs after three columns by default;
7. handle cycles without unbounded rank growth;
8. preserve the compact grid for disconnected nodes.

`layeredPositions` remains as a compatibility wrapper for the full mode, and
`generatedPositions` continues to extract a graph from generated moves.

## Placement strategy

The solver first computes a deterministic layered seed:

- remove DFS cycle-closing links from rank assignment while keeping them in
  the placement score;
- assign dependency ranks;
- order nodes inside each rank by neighbour barycentre, degree, and stable
  input order;
- wrap ranks into bands no wider than `maxStraightRun`, reversing alternate
  bands so the transition edge stays short instead of crossing the drawing.

For incremental layout, fixed boxes seed the occupied set. Movable connected
components are ordered by their number of links to fixed nodes, total degree,
and stable input order. Each component uses the same layered seed, then tests
deterministic translations around the barycentre of its fixed neighbours and
below the current drawing. Candidate translations are scored by:

1. overlap rejection;
2. edge crossings;
3. total squared edge length;
4. backward-flow penalty;
5. bounding-box area and aspect-ratio penalty;
6. deterministic coordinate tie-break.

This makes degree matter naturally: a node with many incident edges receives
multiple edge-length terms, so moving it away from its neighbours is more
expensive.

## Integration

Base generation passes all generated nodes as movable. `placeUnpositioned`
uses the same full mode for an entirely blank parent level.

Plan review passes visible real nodes and manually moved proposals as fixed,
remaining visible proposals as movable, and visible/projected plan edges to
incremental mode. Rendering reads the returned proposal positions exactly as
it reads `ghostAt` today. No existing sheet position is persisted or changed.

## Verification

Automated fixtures cover branches, cycles, disconnected nodes, long chains,
fixed anchors, proposal-only chains, multiple anchors, overlap avoidance, and
determinism. The full repository suite must pass. A browser review should
compare before/after screenshots for a chain, diamond, fan-in, and mixed
existing/proposed plan.

## Non-goals

- Adding ELK.js or another layout dependency.
- Moving nodes the user has already arranged.
- Inferring proposed containers with Louvain.
- Adding navigation for proposed nested containers. Explicit proposed
  containment requires a separate plan-delta and review-navigation design.
