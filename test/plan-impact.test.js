import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildImpactPrompt,
  planImpact,
  remapImpactTargets,
  validateImpacts,
} from "../src/plan-impact.js";
import { splitSteps } from "../src/plan-steps.js";
import {
  buildPlanProjection,
  reviewMapEdges,
  temporaryChildren,
} from "../app/plan-projection.js";

const NODES = [
  {
    id: "api",
    name: "API Server",
    kind: "Node HTTP",
    intent: "Serves requests.",
    parent: "backend",
    anchor: { paths: ["src/api.js", "src/routes.js"] },
  },
  {
    id: "database",
    name: "Database",
    kind: "Postgres",
    intent: "Stores records.",
    anchor: { dir: "src/db" },
  },
];
const EDGES = [{ from: "api", to: "database", label: "queries" }];
const STEPS = [
  { n: 1, text: "Add limiter in src/limit.js and connect API to it through enforceLimit." },
  { n: 2, text: "Update the API request handler." },
  { n: 3, text: "Document the rollout." },
  { n: 4, text: "Remove the old database link." },
];
const API_FILE_STEP = { n: 2, text: "Update the request handler in src/api.js." };

const EMPTY_OPERATIONS = {
  additions: [],
  removals: [],
  responsibilities: [],
  connections: [],
  disconnections: [],
};

function impact(overrides = {}) {
  return {
    level: "component",
    targetId: "api",
    title: "Update request handling",
    why: "Keeps request behavior current.",
    size: "small",
    steps: [2],
    files: [],
    symbols: [],
    ...EMPTY_OPERATIONS,
    ...overrides,
  };
}

function validate(impacts, options = {}) {
  return validateImpacts({ impacts }, {
    nodes: options.nodes || NODES,
    edges: options.edges || EDGES,
    steps: options.steps || STEPS,
  });
}

test("keeps one system decision for an addition and its connection", () => {
  const result = validate([
    impact({
      level: "system",
      targetId: "",
      title: "Add request limiting",
      why: "Introduces request control.",
      size: "substantial",
      steps: [1],
      files: ["src\\limit.js"],
      symbols: ["enforceLimit"],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module",
        intent: "Limits repeated requests.", dir: "src/limit", files: ["src/limit.js"],
      }],
      connections: [{ from: "api", to: "limiter", label: "checks limits" }],
    }),
  ], { steps: [STEPS[0]] });

  assert.equal(result.impacts.length, 1);
  assert.equal(result.impacts[0].key, "impact:1");
  assert.equal(result.impacts[0].level, "system");
  assert.equal(result.impacts[0].additions[0].id, "limiter");
  assert.deepEqual(result.impacts[0].connections[0], {
    from: "api", to: "limiter", label: "checks limits",
  });
  assert.deepEqual(result.impacts[0].files, ["src/limit.js"]);
  assert.deepEqual(result.impacts[0].symbols, ["enforceLimit"]);
});

test("keeps valid responsibility, removal, and directed disconnection operations", () => {
  const result = validate([impact({
    level: "system",
    targetId: "",
    title: "Retire database access",
    steps: [4],
    responsibilities: [{ id: "api", intent: "Serves cached requests.", why: "Stops direct queries." }],
    removals: [{ id: "database" }],
    disconnections: [{ from: "api", to: "database" }],
  })], { steps: [STEPS[3]] });

  assert.deepEqual(result.impacts[0].responsibilities, [
    { id: "api", intent: "Serves cached requests.", why: "Stops direct queries." },
  ]);
  assert.deepEqual(result.impacts[0].removals, [{ id: "database" }]);
  assert.deepEqual(result.impacts[0].disconnections, [{ from: "api", to: "database" }]);
});

test("keeps component work on an existing component", () => {
  const result = validate([impact()], { steps: [STEPS[1]] });
  assert.deepEqual(result.impacts.map(({ level, targetId, steps }) => ({ level, targetId, steps })), [
    { level: "component", targetId: "api", steps: [2] },
  ]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 1, complete: true });
});

test("repairs a blank component target from one unambiguous file owner", () => {
  const result = validate([impact({ targetId: "", files: ["src/api.js"], steps: [2] })], {
    steps: [API_FILE_STEP],
  });
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.impacts.map(({ level, targetId }) => ({ level, targetId })), [
    { level: "component", targetId: "api" },
  ]);
});

test("does not repair a blank target from an unsupported owned file", () => {
  const result = validate([impact({ targetId: "", files: ["src/api.js"], steps: [2] })], {
    steps: [STEPS[1]],
  });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 1, complete: false });
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "unsupported_evidence"));
});

test("uses every supported file to disprove ownership beyond the display cap", () => {
  const ownedFiles = [
    "src/api-1.js", "src/api-2.js", "src/api-3.js",
    "src/api-4.js", "src/api-5.js", "src/api-6.js",
  ];
  const files = [...ownedFiles, "src/outside.js"];
  const result = validate([impact({ targetId: "", files, steps: [2] })], {
    nodes: [{ ...NODES[0], anchor: { paths: ownedFiles } }],
    steps: [{ n: 2, text: `Update ${files.join(", ")}.` }],
  });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 1, complete: false });
});

test("does not invent placement when evidence has multiple or no owners", () => {
  const withoutOwner = validate([impact({ targetId: "", files: [], steps: [2] })], {
    steps: [API_FILE_STEP],
  });
  assert.deepEqual(withoutOwner.impacts, []);
  assert.deepEqual(withoutOwner.coverage, { claimed: 0, total: 1, complete: false });
  assert.deepEqual(withoutOwner.rejectedSteps, [2]);

  const ambiguous = validate([impact({ targetId: "", files: ["src/api.js"], steps: [2] })], {
    nodes: [
      NODES[0],
      { ...NODES[0], id: "api-shadow" },
    ],
    steps: [API_FILE_STEP],
  });
  assert.deepEqual(ambiguous.impacts, []);
  assert.deepEqual(ambiguous.rejectedSteps, [2]);
});

test("legacy support with a valid target becomes nested component detail", () => {
  const result = validate([impact({ level: "support", targetId: "api", steps: [2] })], {
    steps: [STEPS[1]],
  });
  assert.equal(result.impacts[0].level, "component");
  assert.equal(result.impacts[0].targetId, "api");
});

test("repairs legacy unplaced work to the deepest literal file owner", () => {
  const nodes = [
    {
      id: "backend", name: "Backend", kind: "Layer", intent: "Owns server code.",
      anchor: { dir: "src" },
    },
    NODES[0],
  ];
  const result = validate([
    impact({ level: "unresolved", targetId: "", files: ["src/api.js"], steps: [2], size: "" }),
  ], { nodes, steps: [API_FILE_STEP] });

  assert.deepEqual(result.impacts.map(({ level, targetId }) => ({ level, targetId })), [
    { level: "component", targetId: "api" },
  ]);
});

test("does not use unsafe or directory-prefix-lookalike paths as ownership evidence", () => {
  const nodes = [{
    id: "app", name: "App", kind: "Module", intent: "Owns app code.",
    anchor: { dir: "src/app" },
  }];
  const result = validate([
    impact({ targetId: "", files: ["../src/app/secret.js"], steps: [2] }),
    impact({ targetId: "", files: ["src/application/main.js"], steps: [2] }),
  ], { nodes, steps: [STEPS[1]] });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
});

test("groups internal work into one nested change per component", () => {
  const steps = [
    { n: 1, text: "Update handleRequest in src/api.js." },
    { n: 2, text: "Add validateToken in src/routes.js." },
  ];
  const result = validate([
    impact({
      title: "Update request handling", steps: [1], files: ["src/api.js"], symbols: ["handleRequest"],
    }),
    impact({
      title: "Validate credentials", steps: [2], files: ["src/routes.js"], symbols: ["validateToken"],
    }),
  ], { steps });

  assert.equal(result.impacts.length, 1);
  assert.deepEqual(result.impacts[0].steps, [1, 2]);
  assert.deepEqual(result.impacts[0].files, ["src/api.js", "src/routes.js"]);
  assert.deepEqual(result.impacts[0].symbols, ["handleRequest", "validateToken"]);
});

test("accepts a component target declared by a later addition", () => {
  const result = validate([
    impact({ targetId: "limiter", title: "Tune the limiter", steps: [2] }),
    impact({
      level: "system", targetId: "", title: "Add limiter", steps: [1],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module",
        intent: "Limits requests.", dir: "src/limit", files: [],
      }],
    }),
  ], { steps: STEPS.slice(0, 2) });

  assert.deepEqual(result.impacts.map(({ level, targetId }) => ({ level, targetId })), [
    { level: "component", targetId: "limiter" },
    { level: "system", targetId: "" },
  ]);
});

test("rejects orphan dependents when their proposed component is invalidated", () => {
  const result = validate([
    impact({
      level: "system", targetId: "", title: "Add limiter", steps: [1],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module",
        intent: "Limits requests.", dir: "src/limit", files: [],
      }],
      connections: [{ from: "limiter", to: "ghost", label: "calls" }],
    }),
    impact({ targetId: "limiter", title: "Tune limiter", steps: [2] }),
  ], { steps: STEPS.slice(0, 2) });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [1, 2]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 2, complete: false });
});

test("rejects orphan dependents when their proposed component loses its steps", () => {
  const result = validate([
    impact({
      level: "system", targetId: "", title: "Update API", steps: [1],
      responsibilities: [{ id: "api", intent: "Serves limited requests.", why: "Adds control." }],
    }),
    impact({
      level: "system", targetId: "", title: "Add limiter", steps: [1],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module",
        intent: "Limits requests.", dir: "src/limit", files: [],
      }],
    }),
    impact({ targetId: "limiter", title: "Tune limiter", steps: [2] }),
  ], { steps: STEPS.slice(0, 2) });

  assert.deepEqual(result.impacts.map(({ level, targetId, steps }) => ({ level, targetId, steps })), [
    { level: "system", targetId: "", steps: [1] },
  ]);
  assert.deepEqual(result.rejectedSteps, [1, 2]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 2, complete: false });
});

test("normalizes targeted support and rejects unplaced project-wide support", () => {
  const result = validate([
    impact({ level: "support", targetId: "api", title: "Test API", steps: [2], size: "" }),
    impact({ level: "support", targetId: "", title: "Document rollout", steps: [3], size: "" }),
  ], { steps: STEPS.slice(1, 3) });

  assert.deepEqual(result.impacts.map(({ level, targetId, steps }) => ({ level, targetId, steps })), [
    { level: "component", targetId: "api", steps: [2] },
  ]);
  assert.deepEqual(result.rejectedSteps, [3]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 2, complete: false });
});

test("rejects unresolved work without unambiguous file ownership", () => {
  const result = validate([impact({
    level: "unresolved", targetId: "", title: "Place request work", steps: [2], size: "",
  })], { steps: [STEPS[1]] });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 1, complete: false });
});

test("reports a missing input step as rejected and incomplete", () => {
  const result = validate([impact({
    level: "system", targetId: "", title: "Update API responsibility", steps: [1],
    responsibilities: [{ id: "api", intent: "Serves controlled requests.", why: "Adds limiting." }],
  })], { steps: STEPS.slice(0, 2) });

  assert.deepEqual(result.impacts.map(({ key, level, steps }) => ({ key, level, steps })), [
    { key: "impact:1", level: "system", steps: [1] },
  ]);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 2, complete: false });
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "missing_step"));
});

test("counts duplicate input step occurrences as incomplete coverage", () => {
  const result = validate([impact({ steps: [2] })], { steps: [STEPS[1], STEPS[1]] });

  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 2, complete: false });
});

test("resolves duplicate steps by level precedence and then response order", () => {
  const result = validate([
    impact({ level: "support", targetId: "api", title: "Support first", steps: [2, 3], size: "" }),
    impact({ title: "Component winner", steps: [2] }),
    impact({ title: "Component later", steps: [2] }),
    impact({
      level: "system", targetId: "", title: "System winner", steps: [3],
      responsibilities: [{ id: "api", intent: "Serves requests safely.", why: "Adds controls." }],
    }),
  ], { steps: STEPS.slice(1, 3) });

  assert.deepEqual(result.impacts.map(({ title, steps }) => ({ title, steps })), [
    { title: "Support first", steps: [2] },
    { title: "System winner", steps: [3] },
  ]);
  assert.equal(result.diagnostics.conflicts, 3);
  assert.deepEqual(result.rejectedSteps, [2, 3]);
  assert.deepEqual(result.coverage, { claimed: 2, total: 2, complete: false });
});

test("drops an impact left with no owned steps", () => {
  const result = validate([
    impact({ title: "First", steps: [2] }),
    impact({ title: "Second", steps: [2] }),
  ], { steps: [STEPS[1]] });

  assert.deepEqual(result.impacts.map(({ title }) => title), ["First"]);
  assert.equal(result.diagnostics.droppedImpacts, 1);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 1, complete: false });
});

test("rejects invalid level, size, target, endpoint, and disconnection impacts", () => {
  const result = validate([
    impact({ level: "invented", steps: [1] }),
    impact({ size: "huge", steps: [2] }),
    impact({ targetId: "ghost", steps: [3] }),
    impact({
      level: "system", targetId: "", steps: [4],
      connections: [{ from: "api", to: "ghost", label: "calls" }],
    }),
    impact({
      level: "system", targetId: "", steps: [1],
      disconnections: [{ from: "database", to: "api" }],
    }),
  ]);

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [1, 2, 3, 4]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 4, complete: false });
  assert.equal(result.diagnostics.invalidOperations, 2);
});

test("rejects a proposed connection that already exists in the reviewed graph", () => {
  const result = validate([impact({
    level: "system", targetId: "", steps: [1],
    connections: [{ from: "api", to: "database", label: "queries" }],
  })], { steps: [STEPS[0]] });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [1]);
  assert.equal(result.coverage.complete, false);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "invalid_connection"));
});

test("rejects malformed target and structural array shapes", () => {
  const malformedTarget = impact({ targetId: null, steps: [1] });
  const malformedOperations = impact({ steps: [2] });
  delete malformedOperations.disconnections;

  const result = validate([malformedTarget, malformedOperations], { steps: STEPS.slice(0, 2) });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [1, 2]);
  assert.equal(result.coverage.complete, false);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "invalid_target"));
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "invalid_operations_shape"));
});

test("rejects non-system structural operations", () => {
  const result = validate([impact({
    steps: [2],
    additions: [{
      id: "limiter", name: "Limiter", kind: "Module",
      intent: "Limits requests.", dir: "src/limit", files: [],
    }],
  })], { steps: [STEPS[1]] });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.diagnostics.invalidOperations, 1);
});

test("rejects a system impact with no valid structural operation", () => {
  const result = validate([impact({ level: "system", targetId: "", steps: [1] })], {
    steps: [STEPS[0]],
  });
  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [1]);
  assert.equal(result.coverage.complete, false);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "system_without_operation"));
});

test("keeps only safe normalized evidence literally present in a cited step", () => {
  const result = validate([impact({
    steps: [1],
    files: ["src\\limit.js", "/etc/passwd", "../secret", "src/missing.js"],
    symbols: ["enforceLimit", "unknownSymbol"],
  })], { steps: [STEPS[0]] });

  assert.deepEqual(result.impacts[0].files, ["src/limit.js"]);
  assert.deepEqual(result.impacts[0].symbols, ["enforceLimit"]);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "unsafe_path"));
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "unsupported_evidence"));
});

test("applies cited-step evidence rules to proposed addition files", () => {
  const result = validate([impact({
    level: "system",
    targetId: "",
    title: "Add request limiting",
    steps: [1],
    additions: [{
      id: "limiter", name: "Limiter", kind: "Module", intent: "Limits requests.",
      dir: "src/./limit", files: ["./src/limit.js", "src/invented.js", "../secret"],
    }],
  })], { steps: [STEPS[0]] });

  assert.deepEqual(result.impacts[0].additions[0].files, ["src/limit.js"]);
  assert.equal(result.impacts[0].additions[0].dir, "src/limit");
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "unsafe_path"));
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "unsupported_evidence"));
});

test("diagnoses blank titles, oversized strings, and out-of-range step numbers", () => {
  const result = validate([impact({
    title: " ",
    why: "w".repeat(500),
    steps: [2, 99],
  })], { steps: [STEPS[1]] });

  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.rejectedSteps, [2]);
  assert.deepEqual(result.coverage, { claimed: 0, total: 1, complete: false });
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "blank_title"));
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "oversized_string"));
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === "invalid_step"));
});

test("scrubs nonnumeric invalid step values from diagnostics", () => {
  const privatePlanText = "Deploy the customer-only launch sequence";
  const result = validate([impact({ steps: [2, privatePlanText, { text: privatePlanText }] })], {
    steps: [STEPS[1]],
  });

  assert.doesNotMatch(JSON.stringify(result.diagnostics), /customer-only launch sequence/);
  assert.deepEqual(
    result.diagnostics.issues.filter((issue) => issue.code === "invalid_step"),
    [
      { code: "invalid_step", sourceIndex: 0, stepType: "string" },
      { code: "invalid_step", sourceIndex: 0, stepType: "object" },
    ],
  );
});

test("assigns stable client keys in preserved final order", () => {
  const raw = { impacts: [
    impact({ title: "First", steps: [1] }),
    impact({ level: "support", targetId: "database", title: "Second", steps: [2], size: "" }),
  ] };
  const context = { nodes: NODES, edges: EDGES, steps: STEPS.slice(0, 2) };

  const first = validateImpacts(raw, context);
  const second = validateImpacts(structuredClone(raw), context);
  assert.deepEqual(first.impacts.map(({ key }) => key), ["impact:1", "impact:2"]);
  assert.deepEqual(first.impacts, second.impacts);
  assert.ok(first.impacts.every((entry) => !Object.hasOwn(entry, "id")));
});

test("reports raw and kept category and operation counts", () => {
  const result = validate([
    impact({
      level: "system", targetId: "", title: "Add limiter", steps: [1],
      additions: [{
        id: "limiter", name: "Limiter", kind: "Module",
        intent: "Limits requests.", dir: "src/limit", files: [],
      }],
      connections: [{ from: "api", to: "limiter", label: "checks" }],
    }),
    impact({ level: "support", targetId: "", title: "Document", steps: [3], size: "" }),
  ], { steps: [STEPS[0], STEPS[2]] });

  assert.deepEqual(result.diagnostics.raw.categories, {
    system: 1, component: 0, support: 1, unresolved: 0,
  });
  assert.deepEqual(result.diagnostics.kept.categories, {
    system: 1, component: 0,
  });
  assert.deepEqual(result.diagnostics.raw.operations, {
    additions: 1, removals: 0, responsibilities: 0, connections: 1, disconnections: 0,
  });
  assert.deepEqual(result.diagnostics.kept.operations, {
    additions: 1, removals: 0, responsibilities: 0, connections: 1, disconnections: 0,
  });
  assert.deepEqual(result.rejectedSteps, [3]);
  assert.deepEqual(result.coverage, { claimed: 1, total: 2, complete: false });
});

test("buildImpactPrompt includes final component context, directed edges, and original step numbers", () => {
  const prompt = buildImpactPrompt({ nodes: NODES, edges: EDGES }, [{ n: 7, text: "Change routing" }]);

  assert.match(prompt, /id: api/);
  assert.match(prompt, /name: API Server/);
  assert.match(prompt, /kind: Node HTTP/);
  assert.match(prompt, /intent: Serves requests\./);
  assert.match(prompt, /parent: backend/);
  assert.match(prompt, /src\/api\.js/);
  assert.match(prompt, /api -> database/);
  assert.match(prompt, /7\. Change routing/);
  assert.doesNotMatch(prompt, /1\. Change routing/);
});

test("buildImpactPrompt includes provisional group refs, rationale, and dependencies", () => {
  const prompt = buildImpactPrompt({
    nodes: [], edges: [],
    groups: [{
      ref: "group:api", name: "API files", kind: "group", intent: "Handles HTTP.",
      parent: "group:backend", files: ["src/api.js"], rationale: "Shares route imports.",
      dependencies: ["group:db"],
    }],
  }, [{ n: 3, text: "Adjust API" }]);

  assert.match(prompt, /id: group:api/);
  assert.match(prompt, /rationale: Shares route imports\./);
  assert.match(prompt, /dependencies: group:db/);
});

test("remapImpactTargets remaps temporary component references without mutating raw output", () => {
  const raw = { impacts: [impact({
    targetId: "group:api",
    removals: [{ id: "group:api" }],
    responsibilities: [{ id: "group:api", intent: "Serves.", why: "Named." }],
    connections: [{ from: "group:api", to: "limiter", label: "calls" }],
    disconnections: [{ from: "group:api", to: "group:db" }],
  })] };
  const mapped = remapImpactTargets(raw, new Map([
    ["group:api", "api"], ["group:db", "database"],
  ]));

  assert.equal(mapped.impacts[0].targetId, "api");
  assert.equal(mapped.impacts[0].removals[0].id, "api");
  assert.equal(mapped.impacts[0].responsibilities[0].id, "api");
  assert.deepEqual(mapped.impacts[0].connections[0], { from: "api", to: "limiter", label: "calls" });
  assert.deepEqual(mapped.impacts[0].disconnections[0], { from: "api", to: "database" });
  assert.equal(raw.impacts[0].targetId, "group:api");
});

test("planImpact retries only rejected steps with valid target choices", async () => {
  const calls = [];
  const responses = [
    {
      parsed: { impacts: [
        impact({ steps: [1] }),
        impact({ targetId: "", title: "REJECTED MODEL TEXT", steps: [2] }),
      ] },
      provider: "openai",
      model: "first-model",
    },
    {
      parsed: { impacts: [impact({ targetId: "api", steps: [2] })] },
      provider: "openai",
      model: "repair-model",
    },
  ];
  const result = await planImpact({ nodes: NODES, edges: EDGES }, STEPS.slice(0, 2), {
    call: async (request) => {
      calls.push(request);
      return responses.shift();
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].task, "impact");
  assert.match(calls[0].prompt, /1\. Add limiter/);
  assert.match(calls[1].prompt, /Valid target choices:/);
  assert.match(calls[1].prompt, /api — API Server/);
  assert.match(calls[1].prompt, /invalid_target/);
  assert.match(calls[1].prompt, /2\. Update the API request handler\./);
  assert.doesNotMatch(calls[1].prompt, /1\. Add limiter|REJECTED MODEL TEXT/);
  assert.deepEqual(result.impacts[0].steps, [1, 2]);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "repair-model");
  assert.equal(result.outcome, "ready");
});

test("planImpact can defer provisional validation until group refs are remapped", async () => {
  const raw = { impacts: [impact({ targetId: "group:api", steps: [1] })] };
  const result = await planImpact({ nodes: [], edges: [], groups: [
    { ref: "group:api", files: ["src/api.js"], dependencies: [] },
  ] }, [STEPS[0]], {
    deferValidation: true,
    call: async () => ({ parsed: raw, provider: "openai", model: "test-model" }),
  });

  assert.equal(result.raw, raw);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "test-model");
  assert.equal("impacts" in result, false);
  assert.equal("outcome" in result, false);
});

test("planImpact does not retry a complete first response", async () => {
  let calls = 0;
  const result = await planImpact({ nodes: NODES, edges: EDGES }, [STEPS[1]], {
    call: async () => {
      calls++;
      return { parsed: { impacts: [impact()] }, provider: "openai", model: "test-model" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "ready");
});

test("planImpact fails closed after one invalid retry", async () => {
  let calls = 0;
  await assert.rejects(
    planImpact({ nodes: NODES, edges: EDGES }, [STEPS[1]], {
      call: async () => {
        calls++;
        return { parsed: { impacts: [] }, provider: "openai", model: "test-model" };
      },
    }),
    (error) => error.userFacing && /could not place every change/i.test(error.message),
  );
  assert.equal(calls, 2);
});

test("Pushpush authentication projects every decision visibly after one constrained retry", async () => {
  const nodes = [
    {
      id: "privacy-analysis-app", name: "Privacy Analysis App", kind: "Expo app",
      intent: "Lets users upload media and review detected personal information.",
      anchor: { paths: ["app/_layout.tsx", "app/analyse.tsx", "app/index.tsx"] },
    },
    {
      id: "pii-analysis-api", name: "PII Analysis API", kind: "Python API",
      intent: "Accepts media analysis jobs and returns transcript-based PII findings.",
      anchor: { paths: ["server/api.py", "server/video_pii_analyzer.py"] },
    },
    {
      id: "service-test-tools", name: "Service Test Tools", kind: "Python CLI",
      intent: "Checks local services and exercises media analysis with test files.",
      anchor: { paths: ["server/health_monitor.py", "server/test_with_files.py"] },
    },
    {
      id: "expo-tooling-config", name: "Expo Tooling Config", kind: "Expo config",
      intent: "Supplies type and lint settings for the Expo project.",
      anchor: { paths: ["eslint.config.js", "expo-env.d.ts"] },
    },
  ];
  const edges = [{
    id: "privacy-analysis-app__pii-analysis-api",
    from: "privacy-analysis-app", to: "pii-analysis-api", label: "submits media",
  }];
  const plan = readFileSync(new URL("./fixtures/pushpush-auth-plan.md", import.meta.url), "utf8");
  const steps = splitSteps(plan);
  const responses = [
    {
      parsed: { impacts: [
        impact({
          level: "system", targetId: "", title: "Add user storage",
          why: "Accounts and job ownership need durable storage.", steps: [1],
          files: ["server/db.py"],
          additions: [{
            id: "user-store", name: "User Store", kind: "SQLite",
            intent: "Persists accounts and job ownership.", dir: "server", files: ["server/db.py"],
          }],
          connections: [{ from: "pii-analysis-api", to: "user-store", label: "stores users" }],
        }),
        impact({
          targetId: "pii-analysis-api", title: "Authenticate API requests and jobs",
          why: "Routes and jobs must belong to the current user.", steps: [2, 3, 4, 5],
          files: ["server/auth.py", "server/routes_auth.py", "server/api.py"],
        }),
        impact({
          targetId: "privacy-analysis-app", title: "Add authenticated client sessions",
          why: "The app must authenticate API calls and manage the user session.", steps: [6, 7],
          files: ["app/lib/api.ts", "app/lib/auth.tsx"],
        }),
        impact({
          level: "support", targetId: "", title: "Exercise authentication",
          why: "The first response leaves the test placement invalid.", steps: [8],
          files: ["server/test_auth.py"],
        }),
      ] },
      provider: "fixture", model: "canned-first",
    },
    {
      parsed: { impacts: [impact({
        targetId: "pii-analysis-api", title: "Verify authentication and job isolation",
        why: "The API owns authentication and job-isolation behavior.", steps: [8],
        files: ["server/test_auth.py"],
      })] },
      provider: "fixture", model: "canned-retry",
    },
  ];
  let calls = 0;
  const result = await planImpact({ nodes, edges }, steps, {
    call: async () => {
      calls++;
      return responses.shift();
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.outcome, "ready");
  assert.deepEqual(result.coverage, { claimed: 8, total: 8, complete: true });
  assert.deepEqual(result.impacts.flatMap((entry) => entry.steps).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(result.impacts.every((entry) => entry.level === "system" || entry.level === "component"));

  const system = result.impacts.find((entry) => entry.level === "system");
  assert.deepEqual(system.additions.map((addition) => addition.id), ["user-store"]);
  assert.deepEqual(system.connections, [
    { from: "pii-analysis-api", to: "user-store", label: "stores users" },
  ]);
  assert.deepEqual(
    result.impacts.filter((entry) => entry.level === "component")
      .map((entry) => [entry.targetId, entry.steps]),
    [["pii-analysis-api", [2, 3, 4, 5, 8]], ["privacy-analysis-app", [6, 7]]],
  );

  const review = { id: "pushpush-auth", status: "ready", steps, impacts: result.impacts };
  const projection = buildPlanProjection(review, nodes, edges);
  const userStore = projection.nodes.find((node) => node.sourceId === "user-store");
  assert.ok(userStore);
  assert.equal(projection.edges[0].from, "pii-analysis-api");
  assert.equal(projection.edges[0].to, userStore.id);
  assert.equal(temporaryChildren(projection, "pii-analysis-api").length, 1);
  assert.equal(temporaryChildren(projection, "privacy-analysis-app").length, 1);
  assert.deepEqual(reviewMapEdges(edges, review), edges);
});

test("planImpact propagates call failures and rejects a malformed successful envelope", async () => {
  const failure = new Error("service unavailable");
  await assert.rejects(
    planImpact({ nodes: NODES, edges: EDGES }, STEPS, { call: async () => { throw failure; } }),
    (error) => error === failure,
  );
  await assert.rejects(
    planImpact({ nodes: NODES, edges: EDGES }, STEPS, {
      call: async () => ({ parsed: {}, provider: "openai", model: "test-model" }),
    }),
    (error) => error.validation === true,
  );
});
