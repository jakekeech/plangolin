import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTemporaryNodeAccessibility,
  applyReviewRevision,
  buildPersistedSavePayload,
  buildPlanResolvePayload,
  capturePlanFocus,
  handlePlanDeleteBoundary,
  handleTemporaryActivation,
  normalizePlanNavigation,
  navigatePlanState,
  planEvidenceHtml,
  persistentGraphActionAllowed,
  projectedEdgeEndpoints,
  restorePlanFocus,
  selectTemporaryPlanState,
} from "../app/plan-interaction.js";
import { buildPlanProjection, setImpactDecision } from "../app/plan-projection.js";

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
  closest(selector) {
    if (selector === "[data-plan-toggle]" && this.dataset.planToggle) return this;
    if (selector === "[data-plan-action]" && this.dataset.planAction) return this;
    return null;
  }
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

test("an out-of-order revision is ignored without lowering the accepted stamp", () => {
  const rebuilt = [];
  const current = applyReviewRevision("", {
    id: "review:1", status: "partial", revision: 8,
  }, (review) => rebuilt.push(review.revision));
  const stale = applyReviewRevision(current.stamp, {
    id: "review:1", status: "partial", revision: 7,
  }, () => rebuilt.push("stale"));
  const higher = applyReviewRevision(stale.stamp, {
    id: "review:1", status: "partial", revision: 9,
  }, (review) => rebuilt.push(review.revision));
  const newStatus = applyReviewRevision(higher.stamp, {
    id: "review:1", status: "complete", revision: 1,
  }, () => rebuilt.push("status"));
  const newReview = applyReviewRevision(newStatus.stamp, {
    id: "review:2", status: "complete", revision: 0,
  }, () => rebuilt.push("id"));

  assert.equal(stale.changed, false);
  assert.equal(stale.stamp, current.stamp);
  assert.equal(higher.changed, true);
  assert.equal(newStatus.changed, true);
  assert.equal(newReview.changed, true);
  assert.deepEqual(rebuilt, [8, 9, "status", "id"]);
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

test("mousedown focuses and click activates a temporary card exactly once", () => {
  const card = new FakeElement();
  applyTemporaryNodeAccessibility(card, {
    id: "plan:review-1:impact%3A1:card",
    planType: "card",
    name: "Change limiter",
    impactKey: "impact:1",
  }, { enterable: false, selected: false });
  const focused = [];
  const selected = [];
  const callbacks = {
    focus: (impactKey, id) => focused.push([impactKey, id]),
    enter() { throw new Error("card must not enter"); },
    select: (impactKey, id) => selected.push([impactKey, id]),
  };

  const pressed = handleTemporaryActivation({ type: "mousedown" }, card, {}, callbacks);
  const clicked = handleTemporaryActivation({ type: "click", detail: 1 }, card, {
    now: 1000,
    lastClick: pressed.lastClick,
  }, callbacks);

  assert.equal(pressed.action, "focus");
  assert.equal(clicked.action, "select");
  assert.equal(card.focusCount, 1);
  assert.deepEqual(focused, [["impact:1", card.dataset.planId]]);
  assert.deepEqual(selected, [["impact:1", card.dataset.planId]]);
});

test("a Space-synthesized click activates a temporary card exactly once", () => {
  const card = new FakeElement();
  applyTemporaryNodeAccessibility(card, {
    id: "plan:review-1:impact%3A1:card",
    planType: "card",
    name: "Change limiter",
    impactKey: "impact:1",
  }, { enterable: false, selected: false });
  let focusCount = 0;
  let activationCount = 0;
  const callbacks = {
    focus: () => focusCount++,
    enter() {},
    select: () => activationCount++,
  };

  const keyResult = handleTemporaryActivation({ type: "keydown", key: " " }, card, {}, callbacks);
  const clickResult = handleTemporaryActivation({ type: "click", detail: 0 }, card, {
    now: 1000,
    lastClick: keyResult.lastClick,
  }, callbacks);

  assert.equal(keyResult.handled, false);
  assert.equal(clickResult.action, "select");
  assert.equal(focusCount, 1);
  assert.equal(activationCount, 1);
});

test("a Space-synthesized click selects an enterable temporary node without opening it", () => {
  const addition = new FakeElement();
  applyTemporaryNodeAccessibility(addition, {
    id: "plan:review-1:impact%3A1:addition:limiter",
    planType: "addition",
    name: "Limiter",
    impactKey: "impact:1",
  }, { enterable: true, selected: false });
  let enterCount = 0;
  let selectCount = 0;
  const callbacks = {
    focus() {},
    enter: () => enterCount++,
    select: () => selectCount++,
  };

  const keyResult = handleTemporaryActivation({ type: "keydown", key: " " }, addition, {}, callbacks);
  const clickResult = handleTemporaryActivation({ type: "click", detail: 0 }, addition, {
    now: 1000, lastClick: keyResult.lastClick,
  }, callbacks);

  assert.equal(keyResult.handled, false);
  assert.equal(clickResult.action, "select");
  assert.equal(enterCount, 0);
  assert.equal(selectCount, 1);
});

test("a single pointer click selects a temporary root group without entering it", () => {
  const group = new FakeElement();
  applyTemporaryNodeAccessibility(group, {
    id: "plan:review-1:group:project-support",
    planType: "group",
    name: "Project Support",
  }, { enterable: true, selected: false });
  const focused = [];
  const selected = [];
  const entered = [];
  const callbacks = {
    focus: (_impactKey, id) => focused.push(id),
    enter: (id) => entered.push(id),
    selectRepresentation: (id) => selected.push(id),
    select() { throw new Error("a group has no impact to select"); },
  };

  const pressed = handleTemporaryActivation({ type: "mousedown" }, group, {
    now: 1000, lastClick: null,
  }, callbacks);
  const clicked = handleTemporaryActivation({ type: "click", detail: 1 }, group, {
    now: 1000, lastClick: pressed.lastClick,
  }, callbacks);

  assert.deepEqual(focused, [group.dataset.planId]);
  assert.deepEqual(selected, [group.dataset.planId]);
  assert.deepEqual(entered, []);
  assert.equal(clicked.action, "select");
  assert.deepEqual(clicked.lastClick, { id: group.dataset.planId, time: 1000 });
});

test("a double pointer click enters a temporary root group exactly once", () => {
  const group = new FakeElement();
  applyTemporaryNodeAccessibility(group, {
    id: "plan:review-1:group:needs-review",
    planType: "group",
    name: "Needs Review",
  }, { enterable: true, selected: false });
  const entered = [];
  const callbacks = {
    focus() {},
    enter: (id) => entered.push(id),
    select() { throw new Error("a group has no impact to select"); },
  };

  const firstPress = handleTemporaryActivation({ type: "mousedown" }, group, {
    now: 1000, lastClick: null,
  }, callbacks);
  const firstClick = handleTemporaryActivation({ type: "click", detail: 1 }, group, {
    now: 1000, lastClick: firstPress.lastClick,
  }, callbacks);
  const secondPress = handleTemporaryActivation({ type: "mousedown" }, group, {
    now: 1200, lastClick: firstClick.lastClick,
  }, callbacks);
  const secondClick = handleTemporaryActivation({
    type: "click", detail: 2, preventDefault() {},
  }, group, {
    now: 1200, lastClick: secondPress.lastClick,
  }, callbacks);

  assert.deepEqual(entered, [group.dataset.planId]);
  assert.equal(secondClick.action, "enter");
  assert.equal(secondClick.lastClick, null);
});

test("Enter opens a temporary root group exactly once", () => {
  const group = new FakeElement();
  applyTemporaryNodeAccessibility(group, {
    id: "plan:review-1:group:project-support",
    planType: "group",
    name: "Project Support",
  }, { enterable: true, selected: false });
  const entered = [];
  const event = {
    type: "keydown", key: "Enter", prevented: false,
    preventDefault() { this.prevented = true; },
  };
  const result = handleTemporaryActivation(event, group, {}, {
    focus() {},
    enter: (id) => entered.push(id),
    select() {},
  });

  assert.equal(event.prevented, true);
  assert.equal(result.action, "enter");
  assert.deepEqual(entered, [group.dataset.planId]);
});

test("a manual double click navigates an enterable proposed node exactly once", () => {
  const addition = new FakeElement();
  applyTemporaryNodeAccessibility(addition, {
    id: "plan:review-1:impact%3A1:addition:limiter",
    planType: "addition",
    name: "Limiter",
    impactKey: "impact:1",
  }, { enterable: true, selected: false });
  const entered = [];
  const selected = [];
  const callbacks = {
    focus() {},
    enter: (id) => entered.push(id),
    select: (impactKey, id) => selected.push([impactKey, id]),
  };
  const first = handleTemporaryActivation({ type: "click", detail: 1 }, addition, {
    now: 1000, lastClick: null,
  }, callbacks);
  const secondEvent = {
    type: "click", detail: 2, prevented: false,
    preventDefault() { this.prevented = true; },
  };
  const second = handleTemporaryActivation(secondEvent, addition, {
    now: 1200, lastClick: first.lastClick,
  }, callbacks);

  assert.deepEqual(selected, [["impact:1", addition.dataset.planId]]);
  assert.deepEqual(entered, [addition.dataset.planId]);
  assert.equal(secondEvent.prevented, true);
  assert.equal(second.lastClick, null);
});

test("focus restoration targets a replacement temporary action after synchronous redraw", () => {
  const oldAction = new FakeElement();
  oldAction.dataset.planAction = "true";
  oldAction.dataset.planId = "plan:review-1:impact%3A1:card";
  const replacement = new FakeElement();
  replacement.dataset.planAction = "true";
  replacement.dataset.planId = oldAction.dataset.planId;
  const other = new FakeElement();
  other.dataset.planAction = "true";
  other.dataset.planId = "plan:review-1:impact%3A2:card";
  const redrawnWorld = {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-plan-action], [data-plan-toggle]");
      return [other, replacement];
    },
  };

  const token = capturePlanFocus(oldAction);
  assert.deepEqual(token, { kind: "action", id: oldAction.dataset.planId });
  assert.equal(restorePlanFocus(redrawnWorld, token), true);
  assert.equal(replacement.focusCount, 1);
  assert.equal(other.focusCount, 0);
  assert.equal(restorePlanFocus(redrawnWorld, { kind: "action", id: "missing" }), false);
});

test("focus restoration targets the same persisted annotation control after redraw", () => {
  const oldControl = new FakeElement();
  oldControl.dataset.planToggle = "cut";
  oldControl.dataset.planOwnerId = "api";
  oldControl.dataset.impactKey = "impact:responsibility";
  oldControl.dataset.planRepresentationId = "plan:review-1:impact%3Aresponsibility:responsibility:0:api";
  const replacement = new FakeElement();
  replacement.dataset = { ...oldControl.dataset };
  const other = new FakeElement();
  other.dataset.planToggle = "keep";
  other.dataset.planOwnerId = "api";
  other.dataset.impactKey = "impact:responsibility";
  const redrawnWorld = {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-plan-action], [data-plan-toggle]");
      return [other, replacement];
    },
  };

  const token = capturePlanFocus(oldControl);
  assert.deepEqual(token, {
    kind: "control",
    ownerId: "api",
    impactKey: "impact:responsibility",
    representationId: "plan:review-1:impact%3Aresponsibility:responsibility:0:api",
    control: "cut",
  });
  assert.equal(restorePlanFocus(redrawnWorld, token), true);
  assert.equal(replacement.focusCount, 1);
  assert.equal(other.focusCount, 0);
});

test("focus restoration distinguishes removal and responsibility controls for one impact and owner", () => {
  const current = buildPlanProjection({
    id: "review-1",
    impacts: [{
      key: "impact:shared",
      level: "system",
      additions: [],
      connections: [],
      removals: [{ id: "api" }],
      responsibilities: [{ id: "api", intent: "Own retries.", why: "Centralizes policy." }],
      disconnections: [],
    }],
  }, persistedNodes, []);
  const removal = current.annotations.removals[0];
  const responsibility = current.annotations.responsibilities[0];
  const oldResponsibilityCut = new FakeElement();
  oldResponsibilityCut.dataset.planToggle = "cut";
  oldResponsibilityCut.dataset.planOwnerId = responsibility.targetId;
  oldResponsibilityCut.dataset.impactKey = responsibility.impactKey;
  oldResponsibilityCut.dataset.planRepresentationId = responsibility.id;

  const redrawnRemovalCut = new FakeElement();
  redrawnRemovalCut.dataset.planToggle = "cut";
  redrawnRemovalCut.dataset.planOwnerId = removal.targetId;
  redrawnRemovalCut.dataset.impactKey = removal.impactKey;
  redrawnRemovalCut.dataset.planRepresentationId = removal.id;
  const redrawnResponsibilityCut = new FakeElement();
  redrawnResponsibilityCut.dataset = { ...oldResponsibilityCut.dataset };
  const redrawnWorld = {
    querySelectorAll() { return [redrawnRemovalCut, redrawnResponsibilityCut]; },
  };

  const token = capturePlanFocus(oldResponsibilityCut);
  assert.deepEqual(token, {
    kind: "control",
    ownerId: "api",
    impactKey: "impact:shared",
    representationId: responsibility.id,
    control: "cut",
  });
  assert.equal(restorePlanFocus(redrawnWorld, token), true);
  assert.equal(redrawnRemovalCut.focusCount, 0);
  assert.equal(redrawnResponsibilityCut.focusCount, 1);
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

for (const key of ["Delete", "Backspace"]) {
  test(key + " on a temporary action refuses a stale persisted selection without changing the document", () => {
    const tempId = "plan:review-1:impact%3A1:card";
    const document = {
      nodes: [{ id: "api", name: "API" }],
      edges: [],
    };
    const before = JSON.stringify(document);
    const target = {
      tagName: "BUTTON",
      closest(selector) { return selector === "[data-plan-action]" ? this : null; },
    };
    const event = {
      key,
      target,
      prevented: false,
      preventDefault() { this.prevented = true; },
    };
    const result = handlePlanDeleteBoundary(event, {
      document,
      persistedSelection: { type: "node", id: "api" },
      planSelectedId: tempId,
      inspectorOpen: true,
      hunkView: { path: "src/api.js" },
    });

    assert.equal(result.handled, true);
    assert.equal(event.prevented, true);
    assert.equal(result.state.persistedSelection, null);
    assert.equal(result.state.inspectorOpen, false);
    assert.equal(result.state.hunkView, null);
    assert.equal(JSON.stringify(document), before);
    assert.equal(document.nodes[0].id, "api");
  });
}

test("text input deletion is never consumed by temporary plan selection", () => {
  const event = {
    key: "Backspace",
    target: {
      tagName: "INPUT",
      closest() { return null; },
    },
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  const state = {
    persistedSelection: { type: "node", id: "api" },
    planSelectedId: "plan:review-1:impact%3A1:card",
    inspectorOpen: true,
    hunkView: null,
  };

  assert.deepEqual(handlePlanDeleteBoundary(event, state), { handled: false, state });
  assert.equal(event.prevented, false);
});

test("a focused temporary action alone consumes graph deletion when selection state has not caught up", () => {
  const target = {
    tagName: "BUTTON",
    closest(selector) { return selector === "[data-plan-action]" ? this : null; },
  };
  const event = {
    key: "Delete",
    target,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  const state = {
    persistedSelection: { type: "node", id: "api" },
    planSelectedId: null,
    inspectorOpen: true,
    hunkView: null,
  };

  const result = handlePlanDeleteBoundary(event, state);
  assert.equal(result.handled, true);
  assert.equal(event.prevented, true);
  assert.equal(result.state.persistedSelection, null);
});

test("selecting a temporary representation clears persisted selection and inspector evidence", () => {
  const next = selectTemporaryPlanState({
    persistedSelection: { type: "node", id: "api" },
    planSelectedId: null,
    inspectorOpen: true,
    hunkView: { path: "src/api.js" },
  }, "plan:review-1:impact%3A1:card");

  assert.deepEqual(next, {
    persistedSelection: null,
    planSelectedId: "plan:review-1:impact%3A1:card",
    inspectorOpen: false,
    hunkView: null,
  });
});

test("native temporary activation clears a real stale persisted selection through the shared state boundary", () => {
  const card = new FakeElement();
  applyTemporaryNodeAccessibility(card, {
    id: "plan:review-1:impact%3A1:card",
    planType: "card",
    name: "Change limiter",
    impactKey: "impact:1",
  }, { enterable: false, selected: false });
  let state = {
    persistedSelection: { type: "node", id: "api" },
    planSelectedId: null,
    inspectorOpen: true,
    hunkView: { path: "src/api.js" },
  };
  let activationCount = 0;
  const result = handleTemporaryActivation({ type: "click", detail: 0 }, card, {
    now: 1000, lastClick: null,
  }, {
    focus: (_impactKey, id) => { state = selectTemporaryPlanState(state, id); },
    enter() {},
    select: () => activationCount++,
  });

  assert.equal(result.action, "select");
  assert.equal(activationCount, 1);
  assert.deepEqual(state, {
    persistedSelection: null,
    planSelectedId: card.dataset.planId,
    inspectorOpen: false,
    hunkView: null,
  });
});
