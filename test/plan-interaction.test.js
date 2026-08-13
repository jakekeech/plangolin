import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTemporaryNodeAccessibility,
  applyReviewRevision,
  buildPersistedSavePayload,
  buildPlanResolvePayload,
  handleTemporaryActivation,
  normalizePlanNavigation,
  navigatePlanState,
  planEvidenceHtml,
  persistentGraphActionAllowed,
  projectedEdgeEndpoints,
  restoreTemporaryFocus,
} from "../app/plan-interaction.js";
import { setImpactDecision } from "../app/plan-projection.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.tabIndex = -1;
    this.focusCount = 0;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focusCount++; }
}

const persistedNodes = [
  { id: "backend", parent: null },
  { id: "api", parent: "backend" },
];

const projection = (reviewId, nodes = []) => ({
  reviewId,
  nodes,
  edges: [],
  annotations: { removals: [], responsibilities: [], disconnections: [] },
});

test("evidence renders markup-like step numbers and text literally without creating an HTML sink", () => {
  const html = planEvidenceHtml({
    stepTexts: [{
      number: '<img src=x onerror="step()">',
      text: '<script>text()</script>',
    }],
    files: ['src/<img onerror="file()">.js'],
    symbols: ["render<unsafe>"],
  });

  assert.equal(html,
    '<div class="plan-evidence-row"><span class="plan-files-label">Plan steps</span>' +
    '<p><b>&lt;img src=x onerror=&quot;step()&quot;&gt;.</b> &lt;script&gt;text()&lt;/script&gt;</p></div>' +
    '<div class="plan-evidence-row"><span class="plan-files-label">Files</span>' +
    '<p><code>src/&lt;img onerror=&quot;file()&quot;&gt;.js</code></p></div>' +
    '<div class="plan-evidence-row"><span class="plan-files-label">Symbols</span>' +
    '<p><code>render&lt;unsafe&gt;</code></p></div>');
  assert.doesNotMatch(html, /<img|<script/);
});

test("a higher revision rebuilds a partial review with the same id and status exactly once", () => {
  const rebuilt = [];
  const first = applyReviewRevision("", {
    id: "review:1", status: "partial", revision: 7,
  }, (review) => rebuilt.push(review.revision));
  const second = applyReviewRevision(first.stamp, {
    id: "review:1", status: "partial", revision: 8,
  }, (review) => rebuilt.push(review.revision));
  const unchanged = applyReviewRevision(second.stamp, {
    id: "review:1", status: "partial", revision: 8,
  }, () => rebuilt.push("duplicate"));

  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(rebuilt, [7, 8]);
});

test("a removed proposed addition falls back to its nearest persisted ancestor", () => {
  const additionId = "plan:review-1:impact%3A1:addition:limiter";
  const previous = projection("review-1", [
    { id: additionId, planType: "addition", parent: "backend" },
    { id: additionId + ":card", planType: "card", parent: additionId },
  ]);

  assert.deepEqual(normalizePlanNavigation({
    viewRoot: additionId,
    selectedId: additionId,
    previousProjection: previous,
    projection: projection("review-1"),
    persistedNodes,
  }), { viewRoot: "backend", selectedId: null });
});

test("an emptied temporary group returns navigation to the root", () => {
  const groupId = "plan:review-1:group:project-support";
  const previous = projection("review-1", [
    { id: groupId, planType: "group", parent: null },
    { id: groupId + ":card", planType: "card", parent: groupId },
  ]);

  assert.deepEqual(normalizePlanNavigation({
    viewRoot: groupId,
    selectedId: groupId + ":card",
    previousProjection: previous,
    projection: projection("review-1", [{ id: groupId, planType: "group", parent: null }]),
    persistedNodes,
  }), { viewRoot: null, selectedId: null });
});

test("a changed review id clears a nested temporary root and selection", () => {
  const oldId = "plan:review-1:group:needs-review";
  const previous = projection("review-1", [
    { id: oldId, planType: "group", parent: null },
    { id: oldId + ":card", planType: "card", parent: oldId },
  ]);
  const nextId = "plan:review-2:group:needs-review";
  const next = projection("review-2", [
    { id: nextId, planType: "group", parent: null },
    { id: nextId + ":card", planType: "card", parent: nextId },
  ]);

  assert.deepEqual(normalizePlanNavigation({
    viewRoot: oldId,
    selectedId: oldId + ":card",
    previousProjection: previous,
    projection: next,
    persistedNodes,
  }), { viewRoot: null, selectedId: null });
});

test("a review becoming null exits a temporary nested view", () => {
  const additionId = "plan:review-1:impact%3A1:addition:limiter";
  const previous = projection("review-1", [
    { id: additionId, planType: "addition", parent: null },
    { id: additionId + ":card", planType: "card", parent: additionId },
  ]);

  assert.deepEqual(normalizePlanNavigation({
    viewRoot: additionId,
    selectedId: additionId + ":card",
    previousProjection: previous,
    projection: projection(""),
    persistedNodes,
  }), { viewRoot: null, selectedId: null });
});

test("a proposed edge resolves nested persisted endpoints to the visible level", () => {
  const nodes = [
    ...persistedNodes,
    { id: "worker", parent: "api" },
    { id: "database", parent: null },
  ];
  const limiterId = "plan:review-1:impact%3A1:addition:limiter";
  const projected = projection("review-1", [
    { id: limiterId, planType: "addition", parent: null },
  ]);
  const edge = { from: "worker", to: limiterId };

  assert.deepEqual(projectedEdgeEndpoints(edge, null, nodes, projected), {
    from: "backend", to: limiterId,
  });
  assert.equal(projectedEdgeEndpoints(edge, "backend", nodes, projected), null);
});

test("temporary node actions expose button semantics, current selection, and an Enter hint", () => {
  const addition = new FakeElement();
  applyTemporaryNodeAccessibility(addition, {
    id: "plan:review-1:impact%3A1:addition:limiter",
    planType: "addition",
    kind: "Module",
    name: "Limiter",
    impactKey: "impact:1",
  }, { enterable: true, selected: true });

  assert.equal(addition.getAttribute("role"), "button");
  assert.equal(addition.tabIndex, 0);
  assert.equal(addition.getAttribute("aria-current"), "true");
  assert.match(addition.getAttribute("aria-label"), /Module: Limiter\. Press Enter to open\./);
  assert.equal(addition.getAttribute("aria-expanded"), null);
  assert.equal(addition.getAttribute("aria-disabled"), null);

  const card = new FakeElement();
  applyTemporaryNodeAccessibility(card, {
    id: "plan:review-1:impact%3A2:card",
    planType: "card",
    cardKind: "internal change",
    name: "Change limiter internals",
    impactKey: "impact:2",
  }, { enterable: false, selected: false });

  assert.equal(card.getAttribute("aria-current"), null);
  assert.match(card.getAttribute("aria-label"), /Press Enter to select this plan change\./);
});

test("Enter opens an enterable temporary node and selects a temporary card", () => {
  const entered = [];
  const selected = [];
  const callbacks = {
    enter: (id) => entered.push(id),
    select: (impactKey, id) => selected.push([impactKey, id]),
  };
  const addition = new FakeElement();
  applyTemporaryNodeAccessibility(addition, {
    id: "plan:review-1:impact%3A1:addition:limiter",
    planType: "addition",
    name: "Limiter",
  }, { enterable: true, selected: false });
  const openEvent = {
    type: "keydown", key: "Enter", prevented: false,
    preventDefault() { this.prevented = true; },
  };
  handleTemporaryActivation(openEvent, addition, {}, callbacks);

  const card = new FakeElement();
  applyTemporaryNodeAccessibility(card, {
    id: "plan:review-1:impact%3A2:card",
    planType: "card",
    name: "Change limiter",
    impactKey: "impact:2",
  }, { enterable: false, selected: false });
  const selectEvent = {
    type: "keydown", key: "Enter", prevented: false,
    preventDefault() { this.prevented = true; },
  };
  handleTemporaryActivation(selectEvent, card, {}, callbacks);

  assert.equal(openEvent.prevented, true);
  assert.equal(selectEvent.prevented, true);
  assert.deepEqual(entered, [addition.dataset.planId]);
  assert.deepEqual(selected, [["impact:2", card.dataset.planId]]);
});

test("two presses inside the double-click window open a temporary group", () => {
  const group = new FakeElement();
  applyTemporaryNodeAccessibility(group, {
    id: "plan:review-1:group:project-support",
    planType: "group",
    name: "Project Support",
  }, { enterable: true, selected: false });
  const entered = [];
  const first = handleTemporaryActivation({ type: "mousedown", preventDefault() {} }, group, {
    now: 1000, lastClick: null,
  }, { enter: (id) => entered.push(id), select() {} });
  const secondEvent = {
    type: "mousedown", prevented: false,
    preventDefault() { this.prevented = true; },
  };
  const second = handleTemporaryActivation(secondEvent, group, {
    now: 1200, lastClick: first.lastClick,
  }, { enter: (id) => entered.push(id), select() {} });

  assert.deepEqual(entered, [group.dataset.planId]);
  assert.equal(secondEvent.prevented, true);
  assert.equal(second.lastClick, null);
});

test("focus restoration targets the replacement action after a synchronous redraw", () => {
  const oldAction = new FakeElement();
  oldAction.dataset.planId = "plan:review-1:impact%3A1:card";
  const replacement = new FakeElement();
  replacement.dataset.planId = oldAction.dataset.planId;
  const other = new FakeElement();
  other.dataset.planId = "plan:review-1:impact%3A2:card";
  const redrawnWorld = {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-plan-action]");
      return [other, replacement];
    },
  };

  assert.equal(restoreTemporaryFocus(redrawnWorld, oldAction.dataset.planId), true);
  assert.equal(replacement.focusCount, 1);
  assert.equal(other.focusCount, 0);
  assert.equal(restoreTemporaryFocus(redrawnWorld, "missing"), false);
});

test("keep and cut decisions retain the same impact key across nested navigation", () => {
  const cutKeys = setImpactDecision(new Set(), "impact:shared", true);
  const initial = { viewRoot: null, selectedId: null, cutKeys };
  const nested = navigatePlanState(initial, "plan:review-1:impact%3Ashared:addition:limiter");
  const home = navigatePlanState(nested, null);

  assert.equal(nested.cutKeys, cutKeys);
  assert.equal(home.cutKeys, cutKeys);
  assert.equal(home.cutKeys.has("impact:shared"), true);
  assert.equal(nested.viewRoot, "plan:review-1:impact%3Ashared:addition:limiter");
  assert.equal(home.viewRoot, null);
});

test("the deletion guard refuses a temporary id", () => {
  const tempId = "plan:review-1:impact%3A1:card";
  const current = projection("review-1", [{ id: tempId, planType: "card", parent: "api" }]);

  assert.equal(persistentGraphActionAllowed({ ids: [tempId] }, persistedNodes, current), false);
  assert.equal(persistentGraphActionAllowed({ ids: ["api"] }, persistedNodes, current), true);
});

test("the grouping guard refuses any temporary member or temporary view root", () => {
  const tempId = "plan:review-1:impact%3A1:addition:limiter";
  const current = projection("review-1", [{ id: tempId, planType: "addition", parent: null }]);

  assert.equal(persistentGraphActionAllowed({ ids: ["api", tempId] }, persistedNodes, current), false);
  assert.equal(persistentGraphActionAllowed({ ids: ["api"], viewRoot: tempId }, persistedNodes, current), false);
});

test("the wiring guard accepts persisted endpoints and refuses a temporary endpoint", () => {
  const tempId = "plan:review-1:impact%3A1:addition:limiter";
  const current = projection("review-1", [{ id: tempId, planType: "addition", parent: null }]);

  assert.equal(persistentGraphActionAllowed({ ids: ["backend", "api"] }, persistedNodes, current), true);
  assert.equal(persistentGraphActionAllowed({ ids: ["api", tempId] }, persistedNodes, current), false);
});

test("the actual save payload builder excludes temporary nodes, edges, notes, and layout keys", () => {
  const tempId = "plan:review-1:impact%3A1:addition:limiter";
  const tempEdgeId = "plan:review-1:impact%3A1:connection:0:api%3Elimiter";
  const current = {
    reviewId: "review-1",
    nodes: [{ id: tempId, planType: "addition", parent: null }],
    edges: [{ id: tempEdgeId, planType: "connection", from: "api", to: tempId }],
  };
  const document = {
    version: 1,
    nodes: [{ id: "api" }, { id: tempId }],
    edges: [
      { id: "backend__api", from: "backend", to: "api" },
      { id: tempEdgeId, from: "api", to: tempId },
      { id: "polluted", from: tempId, to: "api" },
    ],
    notes: [{ id: "note-1" }, { id: tempId }],
    layout: { api: { x: 1, y: 2 }, [tempId]: { x: 3, y: 4 } },
  };
  const before = JSON.stringify(document);

  assert.deepEqual(buildPersistedSavePayload(document, current), {
    version: 1,
    nodes: [{ id: "api" }],
    edges: [{ id: "backend__api", from: "backend", to: "api" }],
    notes: [{ id: "note-1" }],
    layout: { api: { x: 1, y: 2 } },
  });
  assert.equal(JSON.stringify(document), before);
});

test("the actual resolve payload builder accepts impact keys but excludes temporary node ids", () => {
  const tempId = "plan:review-1:impact%3A1:addition:limiter";
  const current = projection("review-1", [{ id: tempId, planType: "addition", parent: null }]);
  const review = {
    id: "review-1",
    impacts: [{ key: "impact:1" }, { key: "impact:2" }],
  };
  const nodes = [
    { id: "backend", name: "Backend", intent: "Runs the product." },
    { id: "api", name: "API", intent: "Serves requests." },
    { id: tempId, name: "Limiter", intent: "Temporary only.", planType: "addition" },
  ];

  assert.deepEqual(buildPlanResolvePayload(review, new Set(["impact:2"]), nodes, current), {
    id: "review-1",
    accepted: ["impact:1"],
    nodes: [
      { id: "backend", name: "Backend", intent: "Runs the product." },
      { id: "api", name: "API", intent: "Serves requests." },
    ],
  });
});
