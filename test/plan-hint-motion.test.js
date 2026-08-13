import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dockPlanAndHint, planHintPosition } from "../app/plan-hint-motion.js";

const APP = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");

function functionSource(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " exists");
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(name + " has a complete body");
}

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

test("the browser consumes the impact projection instead of legacy deltas", () => {
  assert.match(APP, /from "\.\/plan-projection\.js"/);
  assert.doesNotMatch(APP, /plan\.delta/);
  assert.doesNotMatch(APP, /\bplanKey\b/);
  assert.match(APP, /buildPlanProjection\(plan, S\.nodes, S\.edges\)/);
  assert.match(
    functionSource(APP, "currentLevelNodes"),
    /planViewNodes\(viewRoot, S\.nodes, planProjection\)/,
  );
});

test("temporary hierarchy reuses viewRoot navigation without resetting decisions", () => {
  assert.match(functionSource(APP, "enterNode"), /hasViewChildren\(id\)/);
  assert.match(functionSource(APP, "goToView"), /navigatePlanState/);
  assert.match(APP, /handleTemporaryActivation/);
});

test("temporary cards are focusable plan controls with no ports", () => {
  const renderer = functionSource(APP, "renderTemporaryNode");
  assert.match(renderer, /plan-card/);
  assert.match(renderer, /plan-node-action/);
  assert.match(renderer, /applyTemporaryNodeAccessibility/);
  assert.match(renderer, /data-plan-toggle/);
  assert.match(renderer, /data-impact-key/);
  assert.doesNotMatch(renderer, /class="port"/);
  assert.match(CSS, /\.node\.plan-card/);
  assert.match(CSS, /\.node\.plan-group/);
  assert.match(CSS, /\.node\.plan-removal/);
  assert.match(CSS, /\.node\.plan-responsibility/);
  assert.match(CSS, /\.wire\.plan-disconnection/);
});

test("the plan panel renders literal cited steps, files, and symbols", () => {
  assert.match(HTML, /id="plan-evidence"/);
  assert.match(APP, /evidence\.innerHTML = planEvidenceHtml\(s\)/);
});

test("stepper, cards, annotations, and edges decide by the same impact key", () => {
  const decide = functionSource(APP, "planDecide");
  assert.match(decide, /setImpactDecision\(planCut, impactKey, cutIt\)/);
  assert.match(functionSource(APP, "selectPlanImpact"), /impact\.key === impactKey/);
  assert.match(APP, /buildPlanResolvePayload\(plan, planCut, S\.nodes, planProjection\)/);
  assert.match(APP, /data-impact-key/);
  assert.match(APP, /dataset\.impactKey/);
});

test("the browser wires behavioral plan helpers into every critical IIFE boundary", () => {
  assert.match(APP, /from "\.\/plan-interaction\.js"/);
  assert.match(functionSource(APP, "persist"), /buildPersistedSavePayload/);
  assert.match(functionSource(APP, "syncPlanProjection"), /normalizePlanNavigation/);
  assert.match(functionSource(APP, "renderTemporaryNode"), /applyTemporaryNodeAccessibility/);
  assert.match(functionSource(APP, "renderWires"), /projectedEdgeEndpoints/);
  assert.match(functionSource(APP, "pollPlan"), /applyReviewRevision/);
  assert.match(functionSource(APP, "goToView"), /navigatePlanState/);
  assert.match(functionSource(APP, "connect"), /persistentGraphActionAllowed/);
  assert.match(APP, /buildPlanResolvePayload/);
  assert.match(APP, /handleTemporaryActivation/);
  assert.match(APP,
    /canvas\.addEventListener\("click",[\s\S]*?const planAction = ev\.target\.closest\("\[data-plan-action\]"\)[\s\S]*?handleTemporaryActivation\(ev, planAction/);
  assert.match(APP, /capturePlanFocus/);
  assert.match(APP, /restorePlanFocus/);
  assert.match(APP, /data-plan-representation-id/);
  assert.match(APP, /handlePlanDeleteBoundary/);
  assert.match(APP, /selectTemporaryPlanState/);
});
