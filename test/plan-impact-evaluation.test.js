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
import { buildImpactPrompt } from "../src/plan-impact.js";

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

test("live runner executes declared failure scenarios locally without model calls", async () => {
  const failureCase = corpusCase({
    id: "malformed-response",
    execution: { scenario: "malformed" },
    expected: { failureClass: "malformed" },
  });
  let calls = 0;
  const result = await runLiveEvaluation({
    cases: [failureCase],
    repeats: 2,
    call: async () => { calls++; throw new Error("declared failures must stay local"); },
  });

  assert.equal(calls, 0);
  for (const metrics of Object.values(result.variants)) {
    assert.equal(metrics.expectedFailureChecks, 2);
    assert.equal(metrics.expectedFailureMatches, 2);
  }
  assert.equal(result.decision, "not-evaluated", "local failure checks are not live evidence");
});

test("allowlisted execution failure without an expected class fails locally", async () => {
  const failureCase = corpusCase({
    id: "unexpected-timeout-scenario",
    execution: { scenario: "timeout" },
  });
  let calls = 0;
  const result = await runLiveEvaluation({
    cases: [failureCase],
    repeats: 2,
    call: async ({ contextKind, effort }) => {
      calls++;
      const targetId = contextKind === "named" ? "auth" : "group:auth";
      return {
        parsed: { impacts: [
          impact({ targetId }),
          impact({ level: "support", targetId, steps: [2] }),
        ] },
        appliedEffort: effort,
        evidence: "live-model",
      };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.evidence, {
    verifiedLiveModelCalls: 0,
    requiredLiveModelCalls: 0,
  });
  for (const metrics of Object.values(result.variants)) {
    assert.equal(metrics.expectedFailureChecks, 2);
    assert.equal(metrics.expectedFailureMatches, 0);
    assert.equal(metrics.unexpectedFailures, 2);
    assert.deepEqual(metrics.clientCoverage, { covered: 0, total: 0, ratio: 1 });
    assert.deepEqual(metrics.repeatAgreement, { agreements: 0, comparisons: 0, ratio: 1 });
  }
  assert.equal(result.gate.passed, false);
  assert.equal(result.decision, "not-evaluated");
});

test("local failure cases do not change semantic quality aggregates", async () => {
  const semanticCase = corpusCase();
  const failureCase = corpusCase({
    id: "timeout-response",
    execution: { scenario: "timeout" },
    expected: { failureClass: "timeout" },
  });
  const call = async ({ contextKind, effort }) => {
    const targetId = contextKind === "named" ? "auth" : "group:auth";
    return {
      parsed: { impacts: [
        impact({ targetId }),
        impact({ level: "support", targetId, steps: [2], title: "Test authentication" }),
      ] },
      appliedEffort: effort,
      evidence: "live-model",
    };
  };
  const semanticOnly = await runLiveEvaluation({ cases: [semanticCase], call, repeats: 2 });
  const withLocalFailure = await runLiveEvaluation({
    cases: [semanticCase, failureCase], call, repeats: 2,
  });

  const semanticMetrics = [
    "clientCoverage", "rawCoverage", "generatedUnresolvedFallbacks",
    "falseStructuralOperations", "falseNoArchitectureConclusions", "invalidOperations",
    "droppedProposals", "categoryAccuracy", "targetAccuracy", "targetCategoryAccuracy",
    "evidenceAccuracy", "repeatAgreement",
  ];
  for (const key of Object.keys(semanticOnly.variants)) {
    for (const metricName of semanticMetrics) {
      assert.deepEqual(
        withLocalFailure.variants[key][metricName],
        semanticOnly.variants[key][metricName],
        `${key} ${metricName}`,
      );
    }
    assert.equal(withLocalFailure.variants[key].expectedFailureChecks, 2);
    assert.equal(withLocalFailure.variants[key].expectedFailureMatches, 2);
  }
});

test("local failure declarations fail closed for unknown, missing, and mismatched scenarios", async () => {
  const invalidCases = [
    corpusCase({
      id: "unknown-failure-class",
      execution: { scenario: "service" },
      expected: { failureClass: "service" },
    }),
    corpusCase({ id: "missing-failure-scenario", expected: { failureClass: "service" } }),
    corpusCase({
      id: "mismatched-failure-scenario",
      execution: { scenario: "quota" },
      expected: { failureClass: "timeout" },
    }),
  ];
  let calls = 0;
  const result = await runLiveEvaluation({
    cases: invalidCases,
    repeats: 1,
    call: async () => { calls++; throw new Error("failure declarations must stay local"); },
  });

  assert.equal(calls, 0);
  for (const metrics of Object.values(result.variants)) {
    assert.equal(metrics.expectedFailureChecks, 3);
    assert.equal(metrics.expectedFailureMatches, 0);
  }
  assert.equal(result.gate.passed, false);
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

test("ordinary effort URLs reject whitespace-only provider or model identity", async () => {
  for (const identity of [
    { provider: "   ", model: "live-model" },
    { provider: "live-provider", model: "\n\t" },
  ]) {
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
      fetchImpl: async (_url, options) => {
        const prompt = JSON.parse(options.body).prompt;
        const targetId = prompt.includes("group:auth") ? "group:auth" : "auth";
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              parsed: { impacts: [
                impact({ targetId }),
                impact({ level: "support", targetId, steps: [2] }),
              ] },
              ...identity,
            };
          },
        };
      },
    });

    const output = JSON.parse(lines.join(""));
    assert.equal(output.decision, "not-evaluated");
    assert.deepEqual(output.evidence, {
      verifiedLiveModelCalls: 0,
      requiredLiveModelCalls: 8,
    });
    assert.equal(output.variants["provisional-high"].unexpectedFailures, 2);
  }
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

test("effort URL validation rejects credentials, queries, and fragments before fetch", async () => {
  for (const unsafe of [
    "https://user:secret@high.example",
    "https://high.example?effort=high",
    "https://high.example#high",
  ]) {
    let fetches = 0;
    await assert.rejects(() => main({
      env: {
        PLANGOLIN_EVAL_LIVE: "1",
        PLANGOLIN_EVAL_HIGH_URL: unsafe,
        PLANGOLIN_EVAL_MEDIUM_URL: "https://medium.example",
      },
      cases: [corpusCase()],
      fetchImpl: async () => { fetches++; throw new Error("must reject before fetch"); },
      stdout: { write() {} },
    }), /credentials|query|fragment/i);
    assert.equal(fetches, 0);
  }
});

test("effort URL validation compares canonical root impact endpoints", async () => {
  let fetches = 0;
  await assert.rejects(() => main({
    env: {
      PLANGOLIN_EVAL_LIVE: "1",
      PLANGOLIN_EVAL_HIGH_URL: "https://EXAMPLE.com:443/high-instance",
      PLANGOLIN_EVAL_MEDIUM_URL: "https://example.com/medium-instance/../medium",
    },
    cases: [corpusCase()],
    fetchImpl: async () => { fetches++; throw new Error("must reject before fetch"); },
    stdout: { write() {} },
  }), /distinct/i);
  assert.equal(fetches, 0);
});

function expectedResponse(testCase, contextKind) {
  const provisional = contextKind === "provisional";
  const reverseIds = new Map(Object.entries(testCase.contexts.provisional.idFor || {})
    .map(([temporary, final]) => [final, temporary]));
  const mappedId = (id) => provisional ? reverseIds.get(id) || id : id;
  const operations = operationLists();
  for (const identity of testCase.expected.allowedStructuralOperations || []) {
    const [name, value] = identity.split(":");
    if (name === "additions") operations.additions.push({
      id: value, name: `Proposed ${value}`, kind: "", intent: `Owns ${value} work.`,
      dir: "", files: [],
    });
    else if (name === "removals") operations.removals.push({ id: mappedId(value) });
    else if (name === "responsibilities") operations.responsibilities.push({
      id: mappedId(value), intent: `Owns updated ${value} work.`, why: "The plan changes its role.",
    });
    else {
      const [from, to] = value.split(">");
      operations[name].push({ from: mappedId(from), to: mappedId(to), label: "uses" });
    }
  }
  return { impacts: testCase.expected.placements.map((placement, index) => ({
    level: placement.levels[0],
    targetId: mappedId(placement.allowedTargets?.[0] || ""),
    title: `Evaluate ${testCase.id} ${index + 1}`,
    why: "Matches the semantic predicate.",
    size: placement.levels[0] === "unresolved" ? "" : "small",
    steps: placement.steps,
    files: placement.requiredFiles || [],
    symbols: [],
    ...operationLists(),
    ...(index === 0 ? operations : {}),
  })) };
}

test("full corpus runs through ordinary effort URLs and passes only correct semantic outputs", async () => {
  const cases = JSON.parse(await readFile(
    new URL("../evaluation/plan-impact/cases.json", import.meta.url), "utf8",
  ));
  const responseByPrompt = new Map();
  for (const testCase of cases.filter((entry) => !entry.expected.failureClass)) {
    for (const contextKind of ["named", "provisional"]) {
      responseByPrompt.set(
        buildImpactPrompt(testCase.contexts[contextKind], testCase.steps),
        expectedResponse(testCase, contextKind),
      );
    }
  }
  const run = async ({ breakCase = false } = {}) => {
    const lines = [];
    let fetches = 0;
    await main({
      env: {
        PLANGOLIN_EVAL_LIVE: "1",
        PLANGOLIN_EVAL_HIGH_URL: "http://127.0.0.1:8787",
        PLANGOLIN_EVAL_MEDIUM_URL: "http://127.0.0.1:8788",
        PLANGOLIN_EVAL_REPEATS: "2",
      },
      cases,
      stdout: { write(chunk) { lines.push(String(chunk)); } },
      fetchImpl: async (_url, options) => {
        fetches++;
        const prompt = JSON.parse(options.body).prompt;
        const parsed = breakCase && prompt.includes("Increase the token clock-skew") &&
            prompt.includes("group:authentication")
          ? { impacts: [impact({
            level: "system",
            targetId: "",
            additions: [{
              id: "unwanted-component", name: "Unwanted Component", kind: "",
              intent: "Should not be structural.", dir: "", files: [],
            }],
          })] }
          : responseByPrompt.get(prompt);
        assert.ok(parsed, "only non-failure corpus cases reach the service");
        return {
          ok: true, status: 200,
          async json() { return { parsed, provider: "live-provider", model: "live-model" }; },
        };
      },
    });
    return { output: JSON.parse(lines.join("")), fetches };
  };

  const correct = await run();
  assert.equal(correct.output.decision, "pass");
  assert.equal(correct.fetches, 19 * 4 * 2, "five declared failure cases stay local");

  const incorrect = await run({ breakCase: true });
  assert.equal(incorrect.output.decision, "fail");
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
