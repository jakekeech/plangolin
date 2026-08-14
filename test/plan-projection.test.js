import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedImpactKeys,
  buildPlanProjection,
  planViewNodes,
  recursiveImpactCounts,
  reviewDecisionImpacts,
  reviewMapEdges,
  setImpactDecision,
  temporaryChildren,
} from "../app/plan-projection.js";
import * as planProjectionModule from "../app/plan-projection.js";
import { validateImpacts } from "../src/plan-impact.js";

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

  assert.match(addition.id, /^plan:review-a:impact%3A2:addition:limiter$/);
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

test("validated projections never point at an invalidated proposed component", () => {
  const steps = [
    { n: 1, text: "Add a limiter and connect it to a missing component." },
    { n: 2, text: "Implement the limiter internals." },
  ];
  const validated = validateImpacts({ impacts: [
    impact({
      level: "system", targetId: "", title: "Add limiter", steps: [1],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module", intent: "Limits requests.", dir: "", files: [],
      }],
      connections: [{ from: "limiter", to: "ghost", label: "calls" }],
    }),
    impact({ key: undefined, targetId: "limiter", title: "Implement limiter", steps: [2] }),
  ] }, { nodes: NODES, edges: EDGES, steps });
  const projection = buildPlanProjection({
    id: "review-reachable", status: "partial", steps, impacts: validated.impacts,
  }, NODES, EDGES);
  const reachable = new Set([...NODES.map((node) => node.id), ...projection.nodes.map((node) => node.id)]);

  assert.ok(projection.nodes.every((node) => node.parent === null || reachable.has(node.parent)));
  assert.ok(projection.edges.every((edge) => reachable.has(edge.from) && reachable.has(edge.to)));
  assert.deepEqual(validated.impacts.flatMap((entry) => entry.steps).sort((a, b) => a - b), [1, 2]);
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

test("only internal changes appear inside their deepest targets", () => {
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
  assert.deepEqual(temporaryChildren(projection, "api"), []);
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

  assert.equal(counts.get("worker"), 1);
  assert.equal(counts.get("api"), 1);
  assert.equal(counts.get("backend"), 1);
  assert.equal(counts.get(limiter.id), 2);
});

test("support and unresolved impacts never create top-level groups", () => {
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

  assert.deepEqual(groups, []);
});

test("support and unresolved bookkeeping never become graph nodes", () => {
  const projection = buildPlanProjection(review("review-a", [
    impact({ key: "impact:internal" }),
    impact({
      key: "impact:docs", level: "support", targetId: "worker", title: "Document rollout",
      steps: [3], files: [], symbols: [],
    }),
    impact({
      key: "impact:unknown", level: "unresolved", targetId: "", title: "Place audit work",
      steps: [4], files: [], symbols: [],
    }),
  ]), NODES, EDGES);

  assert.deepEqual(projection.nodes.map((node) => [node.planType, node.impactKey]), [
    ["card", "impact:internal"],
  ]);
});

test("a failed analysis keeps unresolved bookkeeping out of the graph", () => {
  assert.equal(typeof planProjectionModule.projectionForReview, "function",
    "the browser projection policy is behavior shared with tests");
  const failed = {
    ...review("review-error", [
      impact({
        key: "impact:error-1", level: "unresolved", targetId: "", title: "Needs review",
        why: "Impact analysis failed.", size: "", steps: [1], files: [], symbols: [],
      }),
      impact({
        key: "impact:error-2", level: "unresolved", targetId: "", title: "Needs review",
        why: "Impact analysis failed.", size: "", steps: [2], files: [], symbols: [],
      }),
    ]),
    status: "error",
  };

  const projected = planProjectionModule.projectionForReview(failed, NODES, EDGES, {
    reviewId: "review-error", nodes: [], edges: [],
    annotations: { removals: [], responsibilities: [], disconnections: [] },
  });
  assert.deepEqual(projected.nodes, []);
});

test("failed, partial, and ready reviews expose their temporary projection", () => {
  assert.equal(typeof planProjectionModule.planProjectionVisible, "function");
  for (const status of ["error", "partial", "ready"]) {
    assert.equal(planProjectionModule.planProjectionVisible({ status }), true, status);
  }
  for (const status of ["working", "resolved", "skipped", ""]) {
    assert.equal(planProjectionModule.planProjectionVisible({ status }), false, status);
  }
  assert.equal(planProjectionModule.planProjectionVisible(null), false);
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

test("projection ids keep adversarial review, impact, and operation components collision-safe and stable", () => {
  const cases = [
    { reviewId: "r", impactKey: "a:b", additionId: "node", expected: "plan:r:a%3Ab:addition:node" },
    { reviewId: "r:a", impactKey: "b", additionId: "node", expected: "plan:r%3Aa:b:addition:node" },
    { reviewId: "r", impactKey: "a", additionId: "b:addition:node", expected: "plan:r:a:addition:b%3Aaddition%3Anode" },
    { reviewId: "%", impactKey: "/", additionId: "雪", expected: "plan:%25:%2F:addition:%E9%9B%AA" },
    { reviewId: "%25", impactKey: "%2F", additionId: "%E9%9B%AA", expected: "plan:%2525:%252F:addition:%25E9%259B%25AA" },
  ];

  const projected = cases.map(({ reviewId, impactKey, additionId }) => buildPlanProjection(
    review(reviewId, [impact({
      key: impactKey,
      level: "system",
      targetId: "",
      additions: [{
        id: additionId, name: "Adversarial", kind: "Module", intent: "Stays distinct.", dir: "", files: [],
      }],
      connections: [{ from: "api", to: additionId, label: "uses" }],
      removals: [{ id: "database" }],
      responsibilities: [{ id: "api", intent: "Stays safe.", why: "Exercises ids." }],
      disconnections: [{ from: "api", to: "database" }],
    })]),
    NODES,
    EDGES,
  ));
  const everyId = projected.flatMap(ids);

  assert.deepEqual(
    projected.map((projection) => projection.nodes.find((node) => node.planType === "addition").id),
    cases.map(({ expected }) => expected),
  );
  assert.equal(new Set(everyId).size, everyId.length);
  assert.deepEqual(
    projected.map(ids),
    cases.map(({ reviewId, impactKey, additionId }) => ids(buildPlanProjection(
      review(reviewId, [impact({
        key: impactKey,
        level: "system",
        targetId: "",
        additions: [{
          id: additionId, name: "Adversarial", kind: "Module", intent: "Stays distinct.", dir: "", files: [],
        }],
        connections: [{ from: "api", to: additionId, label: "uses" }],
        removals: [{ id: "database" }],
        responsibilities: [{ id: "api", intent: "Stays safe.", why: "Exercises ids." }],
        disconnections: [{ from: "api", to: "database" }],
      })]),
      NODES,
      EDGES,
    ))),
  );
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

test("reviewMapEdges adds transient repaired edges without duplicating saved ones", () => {
  const saved = [{ id: "a__b", from: "a", to: "b", label: "saved" }];
  const sourceReview = { mapEdges: [
    { id: "scan:a>b", from: "a", to: "b", label: "duplicate" },
    {
      id: "scan:b>c", from: "b", to: "c", label: "calls API",
      operations: [{ name: "/jobs/*", sends: "", returns: "" }],
    },
  ] };

  assert.deepEqual(reviewMapEdges(saved, sourceReview), [
    saved[0],
    {
      id: "scan:b>c", from: "b", to: "c", label: "calls API",
      operations: [{ name: "/jobs/*", sends: "", returns: "" }],
      reviewContext: true,
    },
  ]);
});

test("review decisions contain only graphical and nested component changes", () => {
  const sourceReview = review("review-a", [
    impact({ key: "impact:component" }),
    impact({ key: "impact:support", level: "support", targetId: "worker" }),
    impact({ key: "impact:unresolved", level: "unresolved", targetId: "" }),
    impact({
      key: "impact:system", level: "system", targetId: "", steps: [2],
      additions: [{ id: "limiter", name: "Limiter", kind: "Module", intent: "Limits.", dir: "", files: [] }],
    }),
  ]);

  assert.deepEqual(reviewDecisionImpacts(sourceReview).map((entry) => entry.key), [
    "impact:component", "impact:system",
  ]);
});
