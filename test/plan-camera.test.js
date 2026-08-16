import { test } from "node:test";
import assert from "node:assert/strict";
import { planPanDelta } from "../app/plan-camera.js";

test("an off-screen secondary target does not move a visible primary target", () => {
  assert.deepEqual(planPanDelta({
    targets: [
      { left: 80, top: 80, right: 300, bottom: 220 },
      { left: 1200, top: 80, right: 1420, bottom: 220 },
    ],
    viewport: { width: 1000, height: 700 },
  }), { x: 0, y: 0 });
});

test("an off-screen primary target moves only far enough to reveal it", () => {
  assert.deepEqual(planPanDelta({
    targets: [{ left: -20, top: 80, right: 200, bottom: 220 }],
    viewport: { width: 1000, height: 700 },
  }), { x: 60, y: 0 });
});

test("a primary target covered by the review panel moves clear of it", () => {
  assert.deepEqual(planPanDelta({
    targets: [{ left: 700, top: 100, right: 920, bottom: 240 }],
    viewport: { width: 1000, height: 700 },
    occlusion: { left: 680, top: 60, right: 980, bottom: 400 },
  }), { x: -264, y: 0 });
});
