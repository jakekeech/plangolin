import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedImpactKeys,
  buildPlanProjection,
  planViewNodes,
  recursiveImpactCounts,
  setImpactDecision,
  temporaryChildren,
} from "../app/plan-projection.js";

const NODES = [
  { id: "backend", name: "Backend", kind: "System", intent: "Runs the product.", x: 20, y: 30 },
  { id: "api", name: "API", kind: "Service", intent: "Serves requests.", parent: "backend", x: 40, y: 50 },
  { id: "worker", name: "Worker", kind: "Service", intent: "Runs jobs.", parent: "api", x: 60, y: 70 },
  { id: "database", name: "Database", kind: "Store", intent: "Stores records.", x: 340, y: 30 },
];

const EDGES = [
  { id: "api__database", from: "api", to: "database", label: "reads", operations: [] },
];

function impact(overrides = {}) {
  return {
    key: "impact:1",
    level: "component",
    targetId: "worker",
    title: "Change worker internals",
    why: "Keeps jobs reliable.",
    size: "small",
    steps: [1],
    files: ["src/worker.js"],
    symbols: ["runJob"],
    additions: [],
    removals: [],
    responsibilities: [],
    connections: [],
    disconnections: [],
    ...overrides,
  };
}

function review(id, impacts) {
  return {
    id,
    status: "ready",
    steps: [
      { n: 1, text: "Change runJob in src/worker.js." },
      { n: 2, text: "Add limiter and connect API to it." },
      { n: 3, text: "Document the rollout." },
      { n: 4, text: "Decide where the audit work belongs." },
    ],
    impacts,
  };
}

function ids(projection) {
  return [
    ...projection.nodes.map((node) => node.id),
    ...projection.edges.map((edge) => edge.id),
    ...projection.annotations.removals.map((annotation) => annotation.id),
    ...projection.annotations.responsibilities.map((annotation) => annotation.id),
    ...projection.annotations.disconnections.map((annotation) => annotation.id),
  ];
}

test("system additions and proposed connections project at the root", () => {
  const system = impact({
    key: "impact:2",
    level: "system",
    targetId: "",
    title: "Add rate limiting",
    why: "Protects the API.",
    steps: [2],
    files: [],
    symbols: [],
    additions: [{
      id: "limiter", name: "Limiter", kind: "Module", intent: "Limits requests.", dir: "src/limit", files: [],
    }],
    connections: [{ from: "api", to: "limiter", label: "checks limits" }],
  });

  const projection = buildPlanProjection(review("review-a", [system]), NODES, EDGES);
  const addition = projection.nodes.find((node) => node.planType === "addition");

  assert.match(addition.id, /^plan:review-a:impact:2:addition:limiter$/);
  assert.equal(addition.parent, null);
  assert.equal(addition.sourceId, "limiter");
  assert.equal(addition.impactKey, "impact:2");
  assert.deepEqual(projection.edges.map(({ from, to, label, impactKey }) => ({ from, to, label, impactKey })), [{
    from: "api", to: addition.id, label: "checks limits", impactKey: "impact:2",
  }]);
  assert.deepEqual(
    planViewNodes(null, NODES, projection).map((node) => node.id),
    ["backend", "database", addition.id],
  );
});

test("removal, responsibility, and disconnection operations annotate persisted items", () => {
  const system = impact({
    key: "impact:retire",
    level: "system",
    targetId: "",
    title: "Retire direct database access",
    why: "The worker owns persistence now.",
    additions: [],
    removals: [{ id: "database" }],
    responsibilities: [{ id: "api", intent: "Serves cached requests.", why: "Stops direct reads." }],
    connections: [],
    disconnections: [{ from: "api", to: "database" }],
  });

  const projection = buildPlanProjection(review("review-a", [system]), NODES, EDGES);

  assert.deepEqual(projection.annotations.removals.map(({ targetId, impactKey }) => ({ targetId, impactKey })), [
    { targetId: "database", impactKey: "impact:retire" },
  ]);
  assert.deepEqual(
    projection.annotations.responsibilities.map(({ targetId, intent, why, impactKey }) => ({ targetId, intent, why, impactKey })),
    [{ targetId: "api", intent: "Serves cached requests.", why: "Stops direct reads.", impactKey: "impact:retire" }],
  );
  assert.deepEqual(
    projection.annotations.disconnections.map(({ edgeId, from, to, impactKey }) => ({ edgeId, from, to, impactKey })),
    [{ edgeId: "api__database", from: "api", to: "database", impactKey: "impact:retire" }],
  );
});

test("component and scoped support cards appear only inside their deepest targets", () => {
  const impacts = [
    impact(),
    impact({
      key: "impact:tests", level: "support", targetId: "api", title: "Exercise API limits",
      why: "Prevents regressions.", steps: [2], files: [], symbols: [],
    }),
  ];
  const projection = buildPlanProjection(review("review-a", impacts), NODES, EDGES);

  assert.deepEqual(temporaryChildren(projection, "worker").map((node) => [node.cardKind, node.impactKey]), [
    ["internal change", "impact:1"],
  ]);
  assert.deepEqual(temporaryChildren(projection, "api").map((node) => [node.cardKind, node.impactKey]), [
    ["supporting change", "impact:tests"],
  ]);
  assert.equal(temporaryChildren(projection, "backend").length, 0);
  assert.equal(temporaryChildren(projection, null).length, 0);
});

test("recursive impact badges propagate through persisted and proposed ancestors", () => {
  const impacts = [
    impact(),
    impact({
      key: "impact:tests", level: "support", targetId: "worker", title: "Exercise job retries",
      why: "Prevents regressions.", steps: [2], files: [], symbols: [],
    }),
    impact({
      key: "impact:add", level: "system", targetId: "", title: "Add limiter", steps: [3],
      files: [], symbols: [], additions: [{
        id: "limiter", name: "Limiter", kind: "Module", intent: "Limits requests.", dir: "", files: [],
      }],
    }),
    impact({
      key: "impact:limiter-work", targetId: "limiter", title: "Implement the limiter",
      why: "Makes limiting work.", steps: [4], files: [], symbols: [],
    }),
  ];
  const projection = buildPlanProjection(review("review-a", impacts), NODES, EDGES);
  const counts = recursiveImpactCounts(projection, NODES);
  const limiter = projection.nodes.find((node) => node.sourceId === "limiter");

  assert.equal(counts.get("worker"), 2);
  assert.equal(counts.get("api"), 2);
  assert.equal(counts.get("backend"), 2);
  assert.equal(counts.get(limiter.id), 2);
});

test("Project Support and Needs Review groups exist only when populated", () => {
  const none = buildPlanProjection(review("review-a", [impact()]), NODES, EDGES);
  assert.equal(none.nodes.some((node) => node.planType === "group"), false);

  const populated = buildPlanProjection(review("review-a", [
    impact({
      key: "impact:docs", level: "support", targetId: "", title: "Document rollout",
      why: "Explains deployment.", steps: [3], files: [], symbols: [],
    }),
    impact({
      key: "impact:unknown", level: "unresolved", targetId: "", title: "Place audit work",
      why: "No component is justified.", size: "", steps: [4], files: [], symbols: [],
    }),
  ]), NODES, EDGES);
  const groups = populated.nodes.filter((node) => node.planType === "group");

  assert.deepEqual(groups.map((node) => node.name), ["Project Support", "Needs Review"]);
  assert.deepEqual(groups.map((group) => temporaryChildren(populated, group.id).map((card) => card.impactKey)), [
    ["impact:docs"], ["impact:unknown"],
  ]);
});

test("a proposed addition can contain a component change card", () => {
  const projection = buildPlanProjection(review("review-a", [
    impact({
      key: "impact:add", level: "system", targetId: "", title: "Add limiter", steps: [2],
      files: [], symbols: [], additions: [{
        id: "limiter", name: "Limiter", kind: "Module", intent: "Limits requests.", dir: "", files: [],
      }],
    }),
    impact({
      key: "impact:inside", targetId: "limiter", title: "Implement token buckets",
      why: "Enforces the limit.", steps: [3], files: [], symbols: [],
    }),
  ]), NODES, EDGES);
  const addition = projection.nodes.find((node) => node.sourceId === "limiter");
  const card = temporaryChildren(projection, addition.id)[0];

  assert.equal(card.impactKey, "impact:inside");
  assert.deepEqual(planViewNodes(addition.id, NODES, projection).map((node) => node.id), [card.id]);
});

test("the projected graph stops after one temporary card layer", () => {
  const projection = buildPlanProjection(review("review-a", [impact()]), NODES, EDGES);
  const card = temporaryChildren(projection, "worker")[0];

  assert.equal(temporaryChildren(projection, card.id).length, 0);
  assert.equal(planViewNodes(card.id, NODES, projection).length, 0);
});

test("projection ids cannot collide across reviews", () => {
  const impacts = [impact({
    key: "impact:retire",
    level: "system",
    targetId: "",
    additions: [{ id: "limiter", name: "Limiter", kind: "Module", intent: "Limits.", dir: "", files: [] }],
    removals: [{ id: "database" }],
    responsibilities: [{ id: "api", intent: "Serves cached requests.", why: "Stops direct reads." }],
    connections: [{ from: "api", to: "limiter", label: "checks" }],
    disconnections: [{ from: "api", to: "database" }],
  })];
  const first = new Set(ids(buildPlanProjection(review("review-a", impacts), NODES, EDGES)));
  const second = new Set(ids(buildPlanProjection(review("review-b", impacts), NODES, EDGES)));

  assert.equal([...first].some((id) => second.has(id)), false);
});

test("building and querying a projection leaves persisted review and graph bytes untouched", () => {
  const impacts = [impact()];
  const sourceReview = review("review-a", impacts);
  const persisted = { nodes: NODES, edges: EDGES, review: sourceReview };
  const before = JSON.stringify(persisted);

  const projection = buildPlanProjection(sourceReview, NODES, EDGES);
  temporaryChildren(projection, "worker");
  recursiveImpactCounts(projection, NODES);
  planViewNodes("worker", NODES, projection);

  assert.equal(JSON.stringify(persisted), before);
});

test("one impact key keeps or cuts every structural representation atomically", () => {
  const structural = impact({
    key: "impact:structural",
    level: "system",
    targetId: "",
    additions: [{ id: "limiter", name: "Limiter", kind: "Module", intent: "Limits.", dir: "", files: [] }],
    connections: [{ from: "api", to: "limiter", label: "checks" }],
  });
  const sourceReview = review("review-a", [structural, impact({ key: "impact:internal" })]);

  const cut = setImpactDecision(new Set(), "impact:structural", true);
  assert.deepEqual(acceptedImpactKeys(sourceReview, cut), ["impact:internal"]);
  assert.equal(cut.has("impact:structural"), true);

  const kept = setImpactDecision(cut, "impact:structural", false);
  assert.deepEqual(acceptedImpactKeys(sourceReview, kept), ["impact:structural", "impact:internal"]);
  assert.equal(cut.has("impact:structural"), true, "the prior decision set remains immutable");
});
