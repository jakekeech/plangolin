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
