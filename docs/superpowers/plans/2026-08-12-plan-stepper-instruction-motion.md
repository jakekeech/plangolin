# Plan Stepper Instruction Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plan-review keyboard hint track and dock with the draggable stepper panel without the current 360 ms lag.

**Architecture:** Extract the hint target calculation and synchronous panel/hint destination update into a small browser ES module that Node can test directly. Keep the existing drag and dock algorithm in `app/app.js`; on release, call the new helper once so both elements receive final coordinates in the same event, while CSS gives them one shared motion token.

**Tech Stack:** Browser ES modules, vanilla JavaScript and CSS, Node.js 20 built-in test runner.

## Global Constraints

- Preserve the existing five dock choices and nearest-dock selection.
- Preserve the existing eight-pixel gap and above-panel fallback near the bottom edge.
- Disable transitions for both elements during direct pointer drag.
- Use one 340 ms `cubic-bezier(.22, 1, .36, 1)` motion for both elements.
- Keep the existing global `prefers-reduced-motion: reduce` behavior.
- Add no dependencies and do not restructure the plan panel DOM.

---

### Task 1: Synchronize Plan Panel and Hint Docking

**Files:**
- Create: `app/plan-hint-motion.js`
- Create: `test/plan-hint-motion.test.js`
- Modify: `app/app.js:1-2,1958-1979,2746-2763`
- Modify: `app/app.css:26-45,302-304,1254-1262`

**Interfaces:**
- Produces: `planHintPosition({ panelX, panelY, panelHeight, hintHeight, canvasHeight, gap?, edge? }) -> { left: number, top: number }`.
- Produces: `dockPlanAndHint(panel, hint, dock, dimensions) -> { left: number, top: number }`.
- `panel` and `hint` expose mutable `.style` objects. `dock` is `{ x, y }`. `dimensions` is `{ panelHeight, hintHeight, canvasHeight }`.
- `gap` and `edge` both default to `8` pixels.

- [ ] **Step 1: Write the failing synchronous-docking tests**

Create `test/plan-hint-motion.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dockPlanAndHint, planHintPosition } from "../app/plan-hint-motion.js";

test("docking assigns the panel and below-panel hint destinations together", () => {
  const panel = { style: {} };
  const hint = { style: {} };

  const target = dockPlanAndHint(panel, hint, { x: 40, y: 60 }, {
    panelHeight: 200,
    hintHeight: 24,
    canvasHeight: 500,
  });

  assert.deepEqual(target, { left: 40, top: 268 });
  assert.deepEqual(panel.style, { left: "40px", top: "60px" });
  assert.deepEqual(hint.style, {
    right: "auto",
    bottom: "auto",
    left: "40px",
    top: "268px",
  });
});

test("a low dock puts the hint above the panel", () => {
  assert.deepEqual(planHintPosition({
    panelX: 40,
    panelY: 270,
    panelHeight: 200,
    hintHeight: 24,
    canvasHeight: 500,
  }), { left: 40, top: 238 });
});
```

The first test catches the reported regression: removing the hint update from
the release operation, or deferring it to a timer outside the helper, leaves
`hint.style.left/top` unset when the assertion runs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/plan-hint-motion.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/plan-hint-motion.js`.

- [ ] **Step 3: Implement the minimal motion helper**

Create `app/plan-hint-motion.js`:

```js
export function planHintPosition({
  panelX,
  panelY,
  panelHeight,
  hintHeight,
  canvasHeight,
  gap = 8,
  edge = 8,
}) {
  const below = panelY + panelHeight + gap;
  const fitsBelow = below + hintHeight + edge < canvasHeight;
  return {
    left: Math.round(panelX),
    top: Math.round(fitsBelow ? below : panelY - hintHeight - gap),
  };
}

export function dockPlanAndHint(panel, hint, dock, dimensions) {
  const target = planHintPosition({
    panelX: dock.x,
    panelY: dock.y,
    ...dimensions,
  });
  panel.style.left = dock.x + "px";
  panel.style.top = dock.y + "px";
  hint.style.right = "auto";
  hint.style.bottom = "auto";
  hint.style.left = target.left + "px";
  hint.style.top = target.top + "px";
  return target;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/plan-hint-motion.test.js`

Expected: both tests PASS.

- [ ] **Step 5: Wire direct drag and docking to the tested calculation**

At the top of `app/app.js`, add:

```js
import { dockPlanAndHint, planHintPosition } from "./plan-hint-motion.js";
```

Replace `positionHint()` with an optional dock-aware version:

```js
function positionHint(dock) {
  const el = document.getElementById("plan-keys");
  const panel = document.getElementById("planpanel");
  if (!el) return;
  if (!plan || !planOpen()) {
    el.style.left = ""; el.style.top = "";
    el.style.right = ""; el.style.bottom = "";
    return;
  }
  const c = canvas.getBoundingClientRect(), p = panel.getBoundingClientRect();
  const target = planHintPosition({
    panelX: dock ? dock.x : p.left - c.left,
    panelY: dock ? dock.y : p.top - c.top,
    panelHeight: p.height,
    hintHeight: el.offsetHeight,
    canvasHeight: c.height,
  });
  el.style.right = "auto"; el.style.bottom = "auto";
  el.style.left = target.left + "px";
  el.style.top = target.top + "px";
}
```

In `land()`, replace the separate panel assignments and delayed
`setTimeout(positionHint, 360)` with one synchronous operation:

```js
panel.dataset.dragging = "false";
const hint = document.getElementById("plan-keys");
if (hint) {
  dockPlanAndHint(panel, hint, d, {
    panelHeight: panel.offsetHeight,
    hintHeight: hint.offsetHeight,
    canvasHeight: canvas.clientHeight,
  });
} else {
  panel.style.left = d.x + "px";
  panel.style.top = d.y + "px";
}
drag = null;
```

This call must remain in the same pointer-release handler that enables the
transition so both style changes enter the browser's next paint together.

- [ ] **Step 6: Give the panel and hint one shared CSS motion**

Add the token to `:root` in `app/app.css`:

```css
--plan-dock-motion: .34s cubic-bezier(.22, 1, .36, 1);
```

Change the panel transition and add the same transition to the hint:

```css
.hint-plan {
  right: auto; bottom: auto;
  transition: left var(--plan-dock-motion), top var(--plan-dock-motion);
}

.planpanel {
  transition: left var(--plan-dock-motion), top var(--plan-dock-motion);
}

.planpanel[data-dragging="true"],
.planpanel[data-dragging="true"] ~ .hint-plan {
  transition: none;
}
.planpanel[data-dragging="true"] {
  box-shadow: 0 12px 34px rgba(27, 27, 25, .22);
}
```

The existing reduced-motion media query remains unchanged because its universal
`transition: none !important` already covers both elements.

- [ ] **Step 7: Run focused and complete automated verification**

Run: `node --test test/plan-hint-motion.test.js`

Expected: 2 tests PASS.

Run: `npm test`

Expected: all tests PASS with no failures, uncaught errors, or warnings.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 8: Verify the browser interaction**

Run the review command against the checked-in implementation plan:

```bash
PLANGOLIN_REVIEW_PORT=4300 node src/cli.js review \
  docs/superpowers/plans/2026-08-12-plan-stepper-instruction-motion.md
```

Open `http://127.0.0.1:4300`. Once the review is ready, drag the plan panel and
release it at upper-left, upper-right, and both bottom docks. Confirm the hint
tracks without easing during the drag, then the panel and hint begin and finish
the 340 ms glide together with an eight-pixel gap. Enable reduced motion in the
browser and repeat one drag; confirm both jump to the dock in one paint. Inspect
the browser console after repeated drags and expect no errors. Stop the review
command with Ctrl-C without approving the review, because this run exists only
to exercise the UI.

- [ ] **Step 9: Commit the implementation**

```bash
git add app/app.js app/app.css app/plan-hint-motion.js test/plan-hint-motion.test.js
git commit -m "fix: synchronize stepper instruction motion"
```
