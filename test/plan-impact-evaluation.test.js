import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  evaluateGate,
  main,
  runLiveEvaluation,
  scoreCase,
  scoreRepeatAgreement,
  summarizeScores,
} from "../scripts/evaluate-plan-impact.js";

const operationLists = () => ({
  additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
});

const context = {
  nodes: [
    { id: "api", name: "API", intent: "Serves requests.", files: ["src/api.js"] },
    { id: "auth", name: "Authentication", intent: "Authenticates users.", files: ["src/auth.js"] },
  ],
  edges: [],
};

function corpusCase(overrides = {}) {
  return {
    id: "placement-case",
    contexts: {
      named: context,
      provisional: {
        groups: [
          { ref: "group:api", name: "group:api", files: ["src/api.js"] },
          { ref: "group:auth", name: "group:auth", files: ["src/auth.js"] },
        ],
        edges: [],
        idFor: { "group:api": "api", "group:auth": "auth" },
      },
    },
    steps: [
      { n: 1, text: "Update request authentication" },
      { n: 2, text: "Add focused tests" },
    ],
    expected: {
      placements: [
        { steps: [1], levels: ["component"], allowedTargets: ["auth"] },
        { steps: [2], levels: ["support"], allowedTargets: ["auth"] },
      ],
      allowedStructuralOperations: [],
      requiresStructuralChange: false,
    },
    ...overrides,
  };
}

function impact(overrides = {}) {
  return {
    level: "component",
    targetId: "auth",
    title: "Update authentication",
    why: "Keeps request checks current.",
    size: "small",
    steps: [1],
    files: [],
    symbols: [],
    ...operationLists(),
    ...overrides,
  };
}

test("scores repaired client coverage separately from raw model placement", () => {
  const score = scoreCase(corpusCase(), { impacts: [impact()] });

  assert.deepEqual(score.clientCoverage, { covered: 2, total: 2, ratio: 1 });
  assert.deepEqual(score.rawCoverage, { covered: 1, total: 2, ratio: 0.5 });
  assert.equal(score.generatedUnresolvedFallbacks, 1);
});

test("counts kept structural operations that semantic predicates do not allow", () => {
  const score = scoreCase(corpusCase({
    steps: [{ n: 1, text: "Refactor request authentication" }],
    expected: {
      placements: [{ steps: [1], levels: ["component"], allowedTargets: ["auth"] }],
      allowedStructuralOperations: [],
      requiresStructuralChange: false,
    },
  }), { impacts: [impact({
    level: "system",
    targetId: "",
    additions: [{
      id: "auth-helper", name: "Auth Helper", kind: "", intent: "Helps authentication.",
      dir: "", files: [],
    }],
  })] });

  assert.equal(score.falseStructuralOperations, 1);
  assert.deepEqual(score.structuralOperations, ["additions:auth-helper"]);
});

test("detects a false no-architecture conclusion when structure was required", () => {
  const score = scoreCase(corpusCase({
    steps: [{ n: 1, text: "Add an audit component" }],
    expected: {
      placements: [{ steps: [1], levels: ["system"], allowedTargets: [""] }],
      allowedStructuralOperations: ["additions:audit"],
      requiresStructuralChange: true,
    },
  }), { impacts: [impact({ targetId: "auth" })] });

  assert.equal(score.falseNoArchitectureConclusions, 1);
});

test("uses the production validator's invalid-operation diagnostics", () => {
  const score = scoreCase(corpusCase({
    steps: [{ n: 1, text: "Remove the legacy worker" }],
    expected: {
      placements: [{ steps: [1], levels: ["system"], allowedTargets: [""] }],
      allowedStructuralOperations: ["removals:legacy-worker"],
      requiresStructuralChange: true,
    },
  }), { impacts: [impact({
    level: "system", targetId: "", removals: [{ id: "missing-worker" }],
  })] });

  assert.equal(score.invalidOperations, 1);
  assert.equal(score.droppedProposals, 0);
  assert.equal(score.generatedUnresolvedFallbacks, 0);
});

test("repeat agreement ignores prose but detects semantic placement changes", () => {
  const first = { impacts: [impact()] };
  const sameSemantics = { impacts: [impact({
    title: "Refresh auth checks", why: "Different safe wording.",
  })] };
  const differentPlacement = { impacts: [impact({
    level: "support", targetId: "api",
  })] };

  assert.deepEqual(scoreRepeatAgreement(corpusCase(), [first, sameSemantics]), {
    agreements: 1, comparisons: 1, ratio: 1,
  });
  assert.deepEqual(scoreRepeatAgreement(corpusCase(), [first, sameSemantics, differentPlacement]), {
    agreements: 1, comparisons: 2, ratio: 0.5,
  });
});

test("scores target and category accuracy for each labeled plan step", () => {
  const score = scoreCase(corpusCase(), { impacts: [
    impact({ steps: [1] }),
    impact({ level: "component", targetId: "auth", steps: [2], title: "Test authentication" }),
  ] });

  assert.deepEqual(score.categoryAccuracy, { correct: 1, total: 2, ratio: 0.5 });
  assert.deepEqual(score.targetAccuracy, { correct: 2, total: 2, ratio: 1 });
  assert.deepEqual(score.targetCategoryAccuracy, { correct: 1, total: 2, ratio: 0.5 });
});

test("scores required file evidence without matching response prose", () => {
  const score = scoreCase(corpusCase({
    steps: [{ n: 1, text: "Update request checks in src/auth.js" }],
    expected: {
      placements: [{
        steps: [1], levels: ["component"], allowedTargets: ["auth"],
        requiredFiles: ["src/auth.js", "src/missing.js"],
      }],
      allowedStructuralOperations: [],
      requiresStructuralChange: false,
    },
  }), { impacts: [impact({ files: ["src/auth.js"] })] });

  assert.deepEqual(score.evidenceAccuracy, { correct: 1, total: 2, ratio: 0.5 });
});

test("the gate compares provisional metrics with the named baseline", () => {
  const named = summarizeScores([{
    clientCoverage: { covered: 2, total: 2 }, falseStructuralOperations: 0,
    falseNoArchitectureConclusions: 0, targetCategoryAccuracy: { correct: 2, total: 2 },
    repeatAgreement: { agreements: 1, comparisons: 1 },
  }]);
  const provisional = structuredClone(named);

  assert.deepEqual(evaluateGate({ named, provisional, evidence: "live", tolerance: 0.05 }), {
    passed: true,
    reasons: [],
  });
  provisional.targetCategoryAccuracy.correct = 1;
  assert.equal(evaluateGate({ named, provisional, evidence: "live", tolerance: 0.05 }).passed, false);
  assert.equal(evaluateGate({ named, provisional: named, evidence: "fixture" }).passed, false);
  assert.equal(evaluateGate({
    named,
    provisional: { ...named, unexpectedFailures: 1 },
    evidence: "live",
  }).passed, false, "a repaired failed model call is not passing live evidence");
});

test("offline main performs zero network calls and reports only sanitized corpus metadata", async () => {
  let fetches = 0;
  const lines = [];
  await main({
    env: {},
    fetchImpl: async () => { fetches++; throw new Error("network must stay off"); },
    stdout: { write(chunk) { lines.push(String(chunk)); } },
    cases: [corpusCase()],
  });

  assert.equal(fetches, 0);
  assert.deepEqual(JSON.parse(lines.join("")), {
    mode: "offline",
    liveEvaluation: false,
    decision: "not-evaluated",
    caseCount: 1,
    caseIds: ["placement-case"],
  });
  assert.doesNotMatch(lines.join(""), /Update request authentication|Serves requests/);
});

test("live runner crosses named and provisional contexts with high and medium effort safely", async () => {
  const calls = [];
  const originalEffort = process.env.PLANGOLIN_EVAL_EFFORT;
  const result = await runLiveEvaluation({
    cases: [corpusCase()],
    repeats: 2,
    call: async ({ caseId, contextKind, effort }) => {
      calls.push({ caseId, contextKind, effort });
      const targetId = contextKind === "named" ? "auth" : "group:auth";
      return { parsed: { impacts: [impact({ targetId }), impact({
        level: "support", targetId, steps: [2], title: "Test authentication",
      })] }, appliedEffort: effort };
    },
  });

  assert.equal(process.env.PLANGOLIN_EVAL_EFFORT, originalEffort);
  assert.deepEqual(calls, [
    { caseId: "placement-case", contextKind: "named", effort: "high" },
    { caseId: "placement-case", contextKind: "named", effort: "high" },
    { caseId: "placement-case", contextKind: "provisional", effort: "high" },
    { caseId: "placement-case", contextKind: "provisional", effort: "high" },
    { caseId: "placement-case", contextKind: "named", effort: "medium" },
    { caseId: "placement-case", contextKind: "named", effort: "medium" },
    { caseId: "placement-case", contextKind: "provisional", effort: "medium" },
    { caseId: "placement-case", contextKind: "provisional", effort: "medium" },
  ]);
  assert.deepEqual(result.caseIds, ["placement-case"]);
  assert.equal("responses" in result, false);
  assert.deepEqual(result.variants["provisional-high"].repeatAgreement, {
    agreements: 1, comparisons: 1, ratio: 1,
  });
  assert.equal(result.decision, "not-evaluated", "fixture calls cannot enable the live gate");
});

test("live runner rejects a service that does not acknowledge the requested effort", async () => {
  await assert.rejects(() => runLiveEvaluation({
    cases: [corpusCase()], repeats: 1,
    call: async () => ({ parsed: { impacts: [impact()] } }),
  }), /did not acknowledge/i);
});

test("live runner records an unexpected success for every failure-labeled case run", async () => {
  const failureCase = corpusCase({
    id: "malformed-response",
    expected: { failureClass: "malformed" },
  });
  const result = await runLiveEvaluation({
    cases: [corpusCase(), failureCase],
    repeats: 2,
    call: async ({ contextKind, effort }) => {
      const targetId = contextKind === "named" ? "auth" : "group:auth";
      return {
        parsed: { impacts: [
          impact({ targetId }),
          impact({ level: "support", targetId, steps: [2], title: "Test authentication" }),
        ] },
        appliedEffort: effort,
        evidence: "live-model",
      };
    },
  });

  for (const metrics of Object.values(result.variants)) {
    assert.equal(metrics.expectedFailureChecks, 2);
    assert.equal(metrics.expectedFailureMatches, 0);
  }
  assert.equal(result.decision, "fail");
  assert.ok(result.gate.reasons.some((reason) => /failure-handling scenarios/i.test(reason)));
});

test("separate effort URLs run against the ordinary service response contract", async () => {
  const urls = [];
  const requestBodies = [];
  const lines = [];
  await main({
    env: {
      PLANGOLIN_EVAL_LIVE: "1",
      PLANGOLIN_EVAL_HIGH_URL: "https://high-effort.example",
      PLANGOLIN_EVAL_MEDIUM_URL: "https://medium-effort.example",
      PLANGOLIN_EVAL_REPEATS: "2",
    },
    cases: [corpusCase()],
    stdout: { write(chunk) { lines.push(String(chunk)); } },
    fetchImpl: async (url, options) => {
      urls.push(url);
      const body = JSON.parse(options.body);
      requestBodies.push(body);
      const targetId = body.prompt.includes("group:auth") ? "group:auth" : "auth";
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            parsed: { impacts: [
              impact({ targetId }),
              impact({ level: "support", targetId, steps: [2], title: "Test authentication" }),
            ] },
            provider: "live-provider",
            model: "live-model",
          };
        },
      };
    },
  });

  assert.deepEqual(urls, [
    ...Array(4).fill("https://high-effort.example/v1/impact"),
    ...Array(4).fill("https://medium-effort.example/v1/impact"),
  ]);
  assert.ok(requestBodies.every((body) =>
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["installId", "prompt"])));
  const output = JSON.parse(lines.join(""));
  assert.equal(output.decision, "pass");
  assert.deepEqual(output.evidence, {
    verifiedLiveModelCalls: 8,
    requiredLiveModelCalls: 8,
  });
});

test("separate effort URL attestation rejects one shared service URL", async () => {
  await assert.rejects(() => main({
    env: {
      PLANGOLIN_EVAL_LIVE: "1",
      PLANGOLIN_EVAL_HIGH_URL: "https://same.example",
      PLANGOLIN_EVAL_MEDIUM_URL: "https://same.example/",
    },
    cases: [corpusCase()],
    fetchImpl: async () => { throw new Error("must reject before fetch"); },
    stdout: { write() {} },
  }), /distinct/i);
});

test("fixed corpus covers every specified semantic and resilience scenario", async () => {
  const text = await readFile(new URL("../evaluation/plan-impact/cases.json", import.meta.url), "utf8");
  const cases = JSON.parse(text);
  const ids = new Set(cases.map((entry) => entry.id));
  const required = [
    "new-component-connection",
    "responsibility-changing-edit",
    "internal-only-refactor",
    "small-internal-change",
    "tests-and-documentation-only",
    "component-scoped-support",
    "project-wide-support",
    "existing-file-step",
    "vague-unresolved-step",
    "empty-project",
    "unreadable-project",
    "large-capped-project",
    "nested-hand-edited-diagram",
    "malformed-model-output",
    "invalid-addition-reference",
    "invalid-removal-reference",
    "invalid-responsibility-reference",
    "invalid-connection-reference",
    "invalid-disconnection-reference",
    "timeout-failure",
    "quota-failure",
    "refusal-failure",
    "network-failure",
    "repeated-identical-cold-runs",
  ];
  for (const id of required) assert.equal(ids.has(id), true, `missing ${id}`);
  for (const entry of cases) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(Array.isArray(entry.steps) && entry.steps.length > 0, entry.id);
    assert.ok(entry.contexts?.named && entry.contexts?.provisional, entry.id);
    assert.ok(Array.isArray(entry.expected?.placements) || entry.expected?.failureClass, entry.id);
  }
  assert.doesNotMatch(text, /api[_-]?key|authorization|sourceExcerpt|exactResponse|rawOutput/i);
});
