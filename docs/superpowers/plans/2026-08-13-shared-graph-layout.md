# Shared Graph Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use one deterministic graph layout engine for fresh sheet generation and anchored plan proposals.

**Architecture:** `app/graph-layout.js` will expose a pure `layoutGraph` solver with full and incremental modes. Existing wrappers will delegate to full mode, while `app/app.js` will replace its private index-driven ghost layout with the incremental mode, fixing real and manually moved positions.

**Tech Stack:** Browser-native ES modules, Node.js 20 built-in test runner, no runtime dependencies.

## Global Constraints

- Existing sheet nodes and manually dragged proposals must never move during incremental layout.
- The solver must be deterministic and dependency-free.
- Proposal-to-proposal edges must affect proposal positions.
- Directed runs wrap after three columns by default.
- Existing document persistence and plan acceptance formats remain unchanged.

---

### Task 1: Shared full-layout contract

**Files:**
- Modify: `test/graph-layout.test.js`
- Modify: `app/graph-layout.js`

**Interfaces:**
- Produces: `layoutGraph(nodes, edges, options) -> Map<string, {x, y}>`
- Preserves: `layeredPositions(ids, edges, options)` and `generatedPositions(moves, options)`

- [ ] **Step 1: Write failing full-mode tests**

Add tests which import `layoutGraph` and assert:

```js
const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
const edges = [
  { from: "a", to: "b" }, { from: "b", to: "c" },
  { from: "c", to: "d" },
];
assert.deepEqual(Object.fromEntries(layoutGraph(nodes, edges)), {
  a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
  d: { x: 0, y: 138 },
});
```

Also assert repeated calls are deeply equal and a cycle remains bounded.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/graph-layout.test.js`

Expected: FAIL because `layoutGraph` is not exported.

- [ ] **Step 3: Implement the full-mode solver**

In `app/graph-layout.js`, normalize string/object nodes, retain the existing
cycle-safe rank seed, add degree and stable-order tie-breaks, change the
default maximum run from five to three, and export:

```js
export function layoutGraph(nodes, edges, options = {})
```

Make `layeredPositions` delegate to it using `{ mode: "full" }`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/graph-layout.test.js`

Expected: all focused tests pass.

### Task 2: Incremental fixed-anchor layout

**Files:**
- Modify: `test/graph-layout.test.js`
- Modify: `app/graph-layout.js`

**Interfaces:**
- Extends: `layoutGraph(nodes, edges, { mode: "incremental", ...options })`
- Consumes fixed nodes shaped as `{ id, x, y, width, height, fixed: true }`

- [ ] **Step 1: Write failing incremental tests**

Add separate tests asserting:

```js
const at = layoutGraph([
  { id: "api", x: 0, y: 0, width: 198, height: 80, fixed: true },
  { id: "worker" }, { id: "queue" },
], [
  { from: "api", to: "worker" }, { from: "worker", to: "queue" },
], { mode: "incremental", nodeWidth: 198, nodeHeight: 220 });

assert.deepEqual(at.get("api"), { x: 0, y: 0 });
assert.notDeepEqual(at.get("worker"), at.get("queue"));
```

Add fixtures for two fixed anchors, a four-node proposal chain wrapping after
three columns, no overlaps against variable-height fixed boxes, a manually
fixed proposal, and deterministic repeated calls.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/graph-layout.test.js`

Expected: FAIL because full mode does not yet honor fixed nodes or incremental
candidate scoring.

- [ ] **Step 3: Implement incremental component placement**

In `app/graph-layout.js`:

- build movable connected components using all internal edges;
- order components by fixed-neighbour count, degree, then stable input order;
- seed every component with the same layered placement function as full mode;
- generate translations around fixed-neighbour barycentres and beneath the
  occupied bounding box;
- reject overlapping translations;
- score remaining candidates by crossings, squared edge length,
  backward-flow, area/aspect penalty, then coordinates;
- add each selected component to the occupied boxes before placing the next.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/graph-layout.test.js`

Expected: all focused tests pass with deterministic coordinates.

### Task 3: Plan review integration

**Files:**
- Modify: `app/app.js`
- Modify: `test/graph-layout.test.js`

**Interfaces:**
- Consumes: `layoutGraph` incremental mode
- Preserves: `ghostAt -> Map<string, {x, y}>`

- [ ] **Step 1: Write a failing browser-input adapter test**

Export a pure helper from `app/graph-layout.js`:

```js
proposalPositions({ realNodes, additions, edges, moved, options })
```

Test that it fixes every real node, fixes every entry in `moved`, includes
proposal-to-proposal edges, and returns only proposal ids from its public map.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/graph-layout.test.js`

Expected: FAIL because `proposalPositions` is not exported.

- [ ] **Step 3: Implement the pure adapter and wire the browser**

Implement `proposalPositions` as a thin call to incremental `layoutGraph`.
In `app/app.js`, import it and replace the private `settle`/index-based
`ghostPositions` logic with a call supplying:

- `currentLevelNodes()` and their measured heights;
- `plan.delta.additions`;
- `plan.delta.connections`;
- `movedGhosts`;
- `NODE_W` and `GHOST_H`.

Keep `ghostPositions` as the browser-local input collector so rendering and
dragging call sites remain unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/graph-layout.test.js`

Expected: all graph-layout tests pass.

### Task 4: Regression verification and review handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-shared-graph-layout-design.md` only if implementation discoveries change the contract

**Interfaces:**
- Verifies all interfaces from Tasks 1-3.

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`

Expected: exit 0 with zero failing tests.

- [ ] **Step 2: Run deterministic stress fixtures**

Run the focused graph-layout test ten times:

```bash
for run in 1 2 3 4 5 6 7 8 9 10; do node --test test/graph-layout.test.js || exit 1; done
```

Expected: every run exits 0 with identical asserted coordinates.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git diff --stat`.

Expected: no whitespace errors; changes limited to the solver, its browser
integration, focused tests, and design/plan documents.

- [ ] **Step 4: Prepare Claude review notes**

Report the two-mode API, fixed-position invariant, chain wrapping fixture,
proposal-edge integration fixture, exact verification commands, and any known
visual trade-offs. Do not claim browser visuals were checked unless a live
plan was actually rendered and inspected.
