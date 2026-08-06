# Generated Graph Layout and Stepper Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Position fresh graphs from their actual connections and show the rolled-pangolin progress indicator while the plan stepper is generating proposals.

**Architecture:** Move the existing pure layered-layout algorithm into a small browser ES module that can also be imported by Node tests, and derive generation coordinates from the complete move payload before paced replay begins. Add a separately testable animation controller around the existing rolled-pangolin renderer, then wire it to an explicit loading region in the stepper's `thinking` lifecycle.

**Tech Stack:** Browser ES modules, vanilla JavaScript and CSS, Node.js 20 built-in test runner, existing canvas pangolin renderer.

## Global Constraints

- Modify only `/Users/jakekee/code/plangolin-public`; do not modify any submission repository.
- Do not add a graph-layout or animation dependency.
- Do not rearrange any diagram level that already contains a saved position.
- Preserve paced generation replay and all ready-state plan controls.
- Respect `prefers-reduced-motion: reduce` with a stationary loading indicator.

---

### Task 1: Extract and Test Connection-Aware Generated Layout

**Files:**
- Create: `app/graph-layout.js`
- Create: `test/graph-layout.test.js`
- Modify: `app/app.js:4649-4819,5098-5114`
- Modify: `app/index.html:223`

**Interfaces:**
- Produces: `layeredPositions(ids, edges, options?) -> Map<string, {x: number, y: number}>`
- Produces: `generatedPositions(moves, options?) -> Map<string, {x: number, y: number}>`
- `options` supports `{ col, row, perRow, maxCols }` and defaults to the existing values `{ col: 250, row: 138, perRow: 4, maxCols: 5 }`.
- `generatedPositions` consumes browser move objects shaped as `{t: "addNode", node: {id}}` and `{t: "connect", from, to}`.

- [ ] **Step 1: Write the failing layout tests**

Create `test/graph-layout.test.js` with literal expectations:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatedPositions, layeredPositions } from "../app/graph-layout.js";

test("generated branches follow connections instead of move order", () => {
  const moves = [
    { t: "addNode", node: { id: "web" } },
    { t: "addNode", node: { id: "api" } },
    { t: "addNode", node: { id: "db" } },
    { t: "addNode", node: { id: "worker" } },
    { t: "connect", from: "web", to: "api" },
    { t: "connect", from: "api", to: "db" },
    { t: "connect", from: "worker", to: "db" },
  ];

  assert.deepEqual(Object.fromEntries(generatedPositions(moves)), {
    web: { x: 0, y: 0 },
    worker: { x: 0, y: 138 },
    api: { x: 250, y: 69 },
    db: { x: 500, y: 69 },
  });
});

test("disconnected generated nodes use the compact grid", () => {
  const moves = ["a", "b", "c", "d", "e"].map((id) => ({ t: "addNode", node: { id } }));
  assert.deepEqual(Object.fromEntries(generatedPositions(moves)), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 750, y: 0 }, e: { x: 0, y: 138 },
  });
});

test("a cycle-closing edge does not keep increasing dependency depth", () => {
  assert.deepEqual(Object.fromEntries(layeredPositions(
    ["a", "b", "c"],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
  )), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
  });
});

test("a long chain wraps after five dependency columns", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  assert.deepEqual(Object.fromEntries(layeredPositions(ids, edges)), {
    a: { x: 0, y: 0 }, b: { x: 250, y: 0 }, c: { x: 500, y: 0 },
    d: { x: 750, y: 0 }, e: { x: 1000, y: 0 }, f: { x: 0, y: 138 },
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test test/graph-layout.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/graph-layout.js`.

- [ ] **Step 3: Create the pure graph-layout module**

Create `app/graph-layout.js`. Move the existing `layeredPositions` implementation from `app/app.js` into it without changing its cycle breaking, barycentre ordering, centering, or wrapping behavior. Replace the closed-over constants with these option defaults:

```js
const DEFAULTS = { col: 250, row: 138, perRow: 4, maxCols: 5 };

export function layeredPositions(ids, edges, options = {}) {
  const { col: colGap, row: rowGap, perRow, maxCols } = { ...DEFAULTS, ...options };
  const here = new Set(ids);
  const all = edges.filter((edge) =>
    here.has(edge.from) && here.has(edge.to) && edge.from !== edge.to
  );

  if (!all.length) {
    return new Map(ids.map((id, index) => [id, {
      x: (index % perRow) * colGap,
      y: Math.floor(index / perRow) * rowGap,
    }]));
  }

  const outgoing = new Map(ids.map((id) => [id, []]));
  all.forEach((edge) => outgoing.get(edge.from).push(edge));
  const fed = new Set(all.map((edge) => edge.to));
  const state = new Map();
  const loops = new Set();
  const walk = (id) => {
    state.set(id, 1);
    outgoing.get(id).forEach((edge) => {
      const nextState = state.get(edge.to);
      if (nextState === 1) loops.add(edge);
      else if (nextState === undefined) walk(edge.to);
    });
    state.set(id, 2);
  };
  ids.filter((id) => !fed.has(id)).forEach((id) => {
    if (!state.has(id)) walk(id);
  });
  ids.forEach((id) => {
    if (!state.has(id)) walk(id);
  });
  const links = all.filter((edge) => !loops.has(edge));

  const columnOf = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    links.forEach((edge) => {
      const wanted = columnOf.get(edge.from) + 1;
      if (columnOf.get(edge.to) < wanted) {
        columnOf.set(edge.to, wanted);
        moved = true;
      }
    });
    if (!moved) break;
  }

  const lastColumn = ids.reduce((max, id) => Math.max(max, columnOf.get(id)), 0);
  const columns = [];
  for (let column = 0; column <= lastColumn; column++) {
    columns.push(ids.filter((id) => columnOf.get(id) === column));
  }

  const feeders = new Map(ids.map((id) => [id, []]));
  links.forEach((edge) => feeders.get(edge.to).push(edge.from));
  const rowOf = new Map();
  const barycentre = (id) => {
    const known = feeders.get(id).filter((feeder) => rowOf.has(feeder));
    if (!known.length) return Number.MAX_SAFE_INTEGER;
    return known.reduce((sum, feeder) => sum + rowOf.get(feeder), 0) / known.length;
  };
  columns.forEach((column, index) => {
    if (index > 0) column.sort((a, b) => barycentre(a) - barycentre(b));
    column.forEach((id, row) => rowOf.set(id, row));
  });

  const positions = new Map();
  let bandTop = 0;
  for (let start = 0; start < columns.length; start += maxCols) {
    const band = columns.slice(start, start + maxCols);
    const tallest = band.reduce((max, column) => Math.max(max, column.length), 0);
    band.forEach((column, index) => {
      const offset = (tallest - column.length) / 2;
      column.forEach((id, row) => {
        positions.set(id, {
          x: index * colGap,
          y: Math.round((bandTop + offset + row) * rowGap),
        });
      });
    });
    bandTop += tallest;
  }
  return positions;
}

export function generatedPositions(moves, options) {
  const ids = moves
    .filter((move) => move && move.t === "addNode" && move.node && move.node.id)
    .map((move) => move.node.id);
  const here = new Set(ids);
  const edges = moves.filter((move) =>
    move && move.t === "connect" && here.has(move.from) && here.has(move.to)
  );
  return layeredPositions(ids, edges, options);
}
```

Ensure the no-edge grid uses `perRow`, horizontal coordinates use `colGap`, vertical coordinates use `rowGap`, and band wrapping uses `maxCols`.

- [ ] **Step 4: Run the layout tests and verify GREEN**

Run: `node --test test/graph-layout.test.js`

Expected: four passing tests.

- [ ] **Step 5: Load the layout module in the browser**

Change the final script in `app/index.html` to:

```html
<script type="module" src="/app.js"></script>
```

Add this before the IIFE in `app/app.js`:

```js
import { generatedPositions, layeredPositions } from "./graph-layout.js";
```

Delete the in-file `layeredPositions` implementation and keep the placement constants used by late-arrival parking:

```js
const LAYOUT_COL = 250, LAYOUT_ROW = 138, LAYOUT_PER_ROW = 4;
```

`placeUnpositioned()` continues calling the imported `layeredPositions`.

- [ ] **Step 6: Make replay assign final graph-derived positions**

Replace sequential `freeSpot(lastPlaced)` placement in `replay(moves)` with one precomputation before its loop:

```js
async function replay(moves) {
  const positions = generatedPositions(moves);
  for (const move of moves) {
    applyMove(move, { transient: true });
    if (move.t === "addNode") {
      const n = node(move.node.id);
      const spot = positions.get(move.node.id);
      if (n && spot && !Number.isFinite(n.x)) {
        n.x = spot.x;
        n.y = spot.y;
      }
    }
    render();
    await new Promise((resolve) => setTimeout(resolve, REPLAY_MS));
  }
  render();
}
```

Delete `lastPlaced`; it no longer represents layout intent. Keep `freeSpot()` for manual additions and accepted single findings.

- [ ] **Step 7: Run targeted and full tests**

Run: `node --test test/graph-layout.test.js`

Expected: four passing tests.

Run: `npm test`

Expected: all tests pass with no new warnings.

- [ ] **Step 8: Commit the graph-layout fix**

```bash
git add app/graph-layout.js app/app.js app/index.html test/graph-layout.test.js
git commit -m "fix: lay out generated graphs from their connections"
```

---

### Task 2: Add a Testable Rolled-Pangolin Animation Controller

**Files:**
- Create: `app/rolled-loader.js`
- Create: `test/rolled-loader.test.js`

**Interfaces:**
- Produces: `createRolledLoader(options) -> { start(canvas, size?), stop() }`
- Consumes callbacks `draw(canvas, size, angle, palette)`, `palette()`, `reducedMotion()`, `requestFrame(callback)`, `cancelFrame(id)`, and `now()`.
- A repeated `start()` with the same active canvas is a no-op.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `test/rolled-loader.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRolledLoader } from "../app/rolled-loader.js";

function harness(reduced = false) {
  const draws = [];
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 1;
  let time = 1000;
  const loader = createRolledLoader({
    draw: (...args) => draws.push(args),
    palette: () => "palette",
    reducedMotion: () => reduced,
    requestFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame: (id) => { cancelled.push(id); frames.delete(id); },
    now: () => time,
  });
  return { loader, draws, frames, cancelled, advance(ms) { time += ms; } };
}

test("the loader starts one animation loop per canvas and stops it", () => {
  const h = harness();
  const canvas = {};
  h.loader.start(canvas, 58);
  h.loader.start(canvas, 58);
  assert.equal(h.draws.length, 1);
  assert.equal(h.frames.size, 1);

  const [id, tick] = [...h.frames.entries()][0];
  h.frames.delete(id);
  h.advance(1000);
  tick();
  assert.equal(h.draws.length, 2);
  assert.equal(h.frames.size, 1);

  const pending = [...h.frames.keys()][0];
  h.loader.stop();
  assert.deepEqual(h.cancelled, [pending]);
  assert.equal(h.frames.size, 0);
});

test("reduced motion draws one stationary frame", () => {
  const h = harness(true);
  h.loader.start({}, 58);
  assert.equal(h.draws.length, 1);
  assert.equal(h.draws[0][2], 0);
  assert.equal(h.frames.size, 0);
});
```

- [ ] **Step 2: Run the lifecycle tests and verify RED**

Run: `node --test test/rolled-loader.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/rolled-loader.js`.

- [ ] **Step 3: Implement the minimal animation controller**

Create `app/rolled-loader.js`:

```js
export function createRolledLoader(options) {
  const { draw, palette, reducedMotion, requestFrame, cancelFrame, now } = options;
  let canvas = null;
  let frame = 0;
  let startedAt = 0;

  function stop() {
    if (frame) cancelFrame(frame);
    frame = 0;
    canvas = null;
  }

  function start(nextCanvas, size = 58) {
    if (canvas === nextCanvas) return;
    stop();
    canvas = nextCanvas;
    startedAt = now();
    const still = reducedMotion();
    const colors = palette();

    function tick() {
      if (!canvas) return;
      const seconds = still ? 0 : (now() - startedAt) / 1000;
      draw(canvas, size, still ? 0 : (seconds / 4) * Math.PI * 2, colors);
      if (!still) frame = requestFrame(tick);
    }

    tick();
  }

  return { start, stop };
}
```

- [ ] **Step 4: Run the lifecycle tests and verify GREEN**

Run: `node --test test/rolled-loader.test.js`

Expected: two passing tests.

- [ ] **Step 5: Commit the animation controller**

```bash
git add app/rolled-loader.js test/rolled-loader.test.js
git commit -m "feat: add reusable rolled loader controller"
```

---

### Task 3: Wire the Stepper Thinking State to the Rolled Loader

**Files:**
- Modify: `app/app.js:1,2439-2461,2789-2796`
- Modify: `app/app.css:1307-1316`
- Modify: `app/index.html:93-105`
- Test: `test/rolled-loader.test.js`

**Interfaces:**
- Consumes: `createRolledLoader(options) -> { start(canvas, size?), stop() }` from `app/rolled-loader.js`.
- Consumes: existing `drawRolled(canvas, size, angle, palette)` and `ballPalette()` functions in `app/app.js`.

- [ ] **Step 1: Add the explicit stepper loading markup**

Insert between `#plan-note` and `#plan-body` in `app/index.html`:

```html
<div class="plan-loading" id="plan-loading" hidden>
  <canvas class="plan-loading-ball" id="plan-loading-ball" aria-hidden="true"></canvas>
  <p role="status" aria-live="polite">Reading the plan against your sheet…</p>
</div>
```

- [ ] **Step 2: Style the compact loading region**

Add to the plan-panel section in `app/app.css`:

```css
.planpanel[data-collapsed="true"] .plan-loading { display: none; }
.plan-loading {
  min-height: 150px; padding: 20px 16px 24px;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 8px; text-align: center;
}
.plan-loading[hidden] { display: none; }
.plan-loading-ball { display: block; }
.plan-loading p {
  margin: 0; font-family: var(--mono); font-size: 12px;
  color: var(--ink-soft); letter-spacing: .02em;
}
```

- [ ] **Step 3: Instantiate the loader from the existing renderer**

Add the import before the IIFE in `app/app.js`:

```js
import { createRolledLoader } from "./rolled-loader.js";
```

After `drawRolled` and `ballPalette` are defined, create one controller:

```js
const planLoader = createRolledLoader({
  draw: drawRolled,
  palette: ballPalette,
  reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => Date.now(),
});
```

- [ ] **Step 4: Connect loading start and stop to `renderPlan()`**

At the beginning of `renderPlan()`, read `#plan-loading` and `#plan-loading-ball`.

In the no-plan branch, stop the loader and hide the loading region before closing the panel:

```js
if (!plan) {
  planLoader.stop();
  loading.hidden = true;
  setPlanOpen(false);
  renderHint();
  return;
}
```

Replace the thinking branch's note-only treatment with:

```js
if (thinking) {
  renderAsk();
  note.textContent = "";
  loading.hidden = false;
  body.hidden = true;
  planLoader.start(loadingBall, 58);
  document.getElementById("plan-dots").innerHTML = "";
  document.getElementById("plan-of").textContent = "";
  foot.dataset.stage = "thinking";
  return;
}

planLoader.stop();
loading.hidden = true;
```

Then continue the existing ready-state rendering with `body.hidden = false`.

- [ ] **Step 5: Stop hidden animation when the panel collapses**

In the `#plan-close` click handler, after setting `data-collapsed`, stop the loader when collapsing and call `renderPlan()` when expanding:

```js
const collapsed = !shut;
panel.dataset.collapsed = String(collapsed);
if (collapsed) planLoader.stop();
else renderPlan();
```

Keep the existing button glyph and accessible-label updates.

- [ ] **Step 6: Run targeted and full automated tests**

Run: `node --test test/graph-layout.test.js test/rolled-loader.test.js`

Expected: six passing tests.

Run: `npm test`

Expected: all tests pass with no new warnings.

- [ ] **Step 7: Verify both UI fixes in the browser**

Start the app with `npm start` in a temporary fixture or safe sample workspace, then use the browser to verify:

1. A generated branched graph places nodes by dependency layer, not generation order.
2. A six-node chain wraps after the fifth column.
3. A `thinking` plan displays the compact rolling pangolin and status in the stepper.
4. Repeated plan polls do not visibly reset or accelerate the spinner.
5. Transitioning to `ready` removes the loader and shows proposal navigation.
6. Collapsing the thinking panel stops animation; expanding it resumes one loop.
7. With reduced motion enabled, the pangolin remains stationary.
8. The browser console contains no errors.

- [ ] **Step 8: Commit the stepper loading UI**

```bash
git add app/app.js app/app.css app/index.html
git commit -m "fix: show progress while plan review loads"
```

---

### Task 4: Final Regression Verification

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes the completed graph-layout module, replay integration, loader controller, and stepper UI.

- [ ] **Step 1: Run formatting and whitespace checks**

Run: `git diff --check HEAD~3`

Expected: no output.

- [ ] **Step 2: Run the complete test suite once more**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Review the final scope**

Run: `git status --short && git diff --stat HEAD~3`

Expected: only Plangolin graph-layout, loader, stepper, tests, and design/plan files are present; no submission repository paths appear.
