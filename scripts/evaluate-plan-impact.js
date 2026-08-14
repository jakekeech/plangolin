#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  buildImpactPrompt,
  remapImpactTargets,
  validateImpacts,
} from "../src/plan-impact.js";

const CASES_URL = new URL("../evaluation/plan-impact/cases.json", import.meta.url);
const OPERATION_NAMES = [
  "additions", "removals", "responsibilities", "connections", "disconnections",
];
const CONTEXT_KINDS = ["named", "provisional"];
const EFFORTS = ["high", "medium"];
const LOCAL_FAILURE_SCENARIOS = new Set(["malformed", "timeout", "quota", "refusal", "network"]);

const list = (value) => Array.isArray(value) ? value : [];
const ratio = (correct, total) => total ? correct / total : 1;
const metric = (correct, total) => ({ correct, total, ratio: ratio(correct, total) });
const coverageMetric = (covered, total) => ({ covered, total, ratio: ratio(covered, total) });

function operationIdentity(name, operation) {
  if (name === "additions" || name === "removals" || name === "responsibilities") {
    return `${name}:${operation.id}`;
  }
  return `${name}:${operation.from}>${operation.to}`;
}

function structuralOperations(impacts) {
  return impacts.flatMap((impact) => OPERATION_NAMES.flatMap((name) =>
    list(impact[name]).map((operation) => operationIdentity(name, operation))));
}

function semanticSignature(impacts) {
  return JSON.stringify(impacts.map((impact) => ({
    level: impact.level,
    targetId: impact.targetId,
    steps: [...impact.steps].sort((a, b) => a - b),
    operations: structuralOperations([impact]).sort(),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function namedContext(testCase) {
  return testCase.contexts?.named || { nodes: [], edges: [] };
}

function validationInput(testCase, raw, contextKind) {
  if (contextKind !== "provisional") return raw;
  return remapImpactTargets(raw, testCase.contexts?.provisional?.idFor || {});
}

function expectedForStep(testCase, step) {
  return list(testCase.expected?.placements).find((placement) =>
    list(placement.steps).includes(step));
}

export function scoreCase(testCase, raw, { contextKind = "named" } = {}) {
  const context = namedContext(testCase);
  const validated = validateImpacts(validationInput(testCase, raw, contextKind), {
    nodes: list(context.nodes), edges: list(context.edges), steps: list(testCase.steps),
  });
  const missingSteps = new Set(validated.diagnostics.issues
    .filter((issue) => issue.code === "missing_step")
    .map((issue) => issue.step));
  const totalSteps = list(testCase.steps).length;
  const operations = structuralOperations(validated.impacts);
  const allowedOperations = new Set(list(testCase.expected?.allowedStructuralOperations));

  let categoryCorrect = 0;
  let categoryTotal = 0;
  let targetCorrect = 0;
  let targetTotal = 0;
  let combinedCorrect = 0;
  let combinedTotal = 0;
  for (const step of list(testCase.steps)) {
    const expected = expectedForStep(testCase, step.n);
    if (!expected) continue;
    const actual = validated.impacts.find((impact) => impact.steps.includes(step.n));
    const categoryMatches = Boolean(actual && list(expected.levels).includes(actual.level));
    categoryTotal++;
    if (categoryMatches) categoryCorrect++;

    const hasTargetPredicate = Array.isArray(expected.allowedTargets);
    const targetMatches = Boolean(actual && hasTargetPredicate &&
      expected.allowedTargets.includes(actual.targetId));
    if (hasTargetPredicate) {
      targetTotal++;
      if (targetMatches) targetCorrect++;
    }
    combinedTotal++;
    if (categoryMatches && (!hasTargetPredicate || targetMatches)) combinedCorrect++;
  }
  let evidenceCorrect = 0;
  let evidenceTotal = 0;
  for (const expected of list(testCase.expected?.placements)) {
    const actualFiles = new Set(validated.impacts
      .filter((impact) => list(expected.steps).some((step) => impact.steps.includes(step)))
      .flatMap((impact) => impact.files));
    for (const file of list(expected.requiredFiles)) {
      evidenceTotal++;
      if (actualFiles.has(file)) evidenceCorrect++;
    }
  }

  return {
    caseId: testCase.id,
    clientCoverage: coverageMetric(validated.coverage.claimed, validated.coverage.total),
    rawCoverage: coverageMetric(totalSteps - missingSteps.size, totalSteps),
    generatedUnresolvedFallbacks: missingSteps.size,
    falseStructuralOperations: operations.filter((operation) => !allowedOperations.has(operation)).length,
    falseNoArchitectureConclusions:
      testCase.expected?.requiresStructuralChange === true && operations.length === 0 ? 1 : 0,
    invalidOperations: validated.diagnostics.invalidOperations,
    droppedProposals: validated.diagnostics.droppedImpacts,
    categoryAccuracy: metric(categoryCorrect, categoryTotal),
    targetAccuracy: metric(targetCorrect, targetTotal),
    targetCategoryAccuracy: metric(combinedCorrect, combinedTotal),
    evidenceAccuracy: metric(evidenceCorrect, evidenceTotal),
    structuralOperations: operations.sort(),
    semanticSignature: semanticSignature(validated.impacts),
  };
}

function failureScore(testCase, failureClass, { local = false } = {}) {
  const expected = testCase.expected?.failureClass;
  return {
    caseId: testCase.id,
    expectedFailureChecks: local || expected ? 1 : 0,
    expectedFailureMatches: expected && LOCAL_FAILURE_SCENARIOS.has(expected) &&
      LOCAL_FAILURE_SCENARIOS.has(failureClass) && expected === failureClass ? 1 : 0,
    unexpectedFailures: expected ? 0 : 1,
    failureSignature: `failure:${failureClass || "invalid-declaration"}`,
  };
}

function repeatAgreementForScores(scores) {
  const semanticScores = scores.filter((score) => typeof score.semanticSignature === "string");
  if (semanticScores.length < 2) return { agreements: 0, comparisons: 0, ratio: 1 };
  const first = semanticScores[0].semanticSignature;
  const agreements = semanticScores.slice(1)
    .filter((score) => score.semanticSignature === first).length;
  return {
    agreements,
    comparisons: semanticScores.length - 1,
    ratio: agreements / (semanticScores.length - 1),
  };
}

export function scoreRepeatAgreement(testCase, responses, options) {
  return repeatAgreementForScores(responses.map((response) => scoreCase(testCase, response, options)));
}

export function summarizeScores(scores) {
  const totals = {
    clientCoverage: { covered: 0, total: 0 },
    rawCoverage: { covered: 0, total: 0 },
    generatedUnresolvedFallbacks: 0,
    falseStructuralOperations: 0,
    falseNoArchitectureConclusions: 0,
    invalidOperations: 0,
    droppedProposals: 0,
    categoryAccuracy: { correct: 0, total: 0 },
    targetAccuracy: { correct: 0, total: 0 },
    targetCategoryAccuracy: { correct: 0, total: 0 },
    evidenceAccuracy: { correct: 0, total: 0 },
    repeatAgreement: { agreements: 0, comparisons: 0 },
    expectedFailureChecks: 0,
    expectedFailureMatches: 0,
    unexpectedFailures: 0,
  };
  for (const score of scores) {
    totals.clientCoverage.covered += score.clientCoverage?.covered || 0;
    totals.clientCoverage.total += score.clientCoverage?.total || 0;
    totals.rawCoverage.covered += score.rawCoverage?.covered || 0;
    totals.rawCoverage.total += score.rawCoverage?.total || 0;
    for (const name of [
      "generatedUnresolvedFallbacks", "falseStructuralOperations",
      "falseNoArchitectureConclusions", "invalidOperations", "droppedProposals",
      "expectedFailureChecks", "expectedFailureMatches",
      "unexpectedFailures",
    ]) totals[name] += score[name] || 0;
    for (const name of [
      "categoryAccuracy", "targetAccuracy", "targetCategoryAccuracy", "evidenceAccuracy",
    ]) {
      totals[name].correct += score[name]?.correct || 0;
      totals[name].total += score[name]?.total || 0;
    }
    totals.repeatAgreement.agreements += score.repeatAgreement?.agreements || 0;
    totals.repeatAgreement.comparisons += score.repeatAgreement?.comparisons || 0;
  }
  totals.clientCoverage.ratio = ratio(totals.clientCoverage.covered, totals.clientCoverage.total);
  totals.rawCoverage.ratio = ratio(totals.rawCoverage.covered, totals.rawCoverage.total);
  for (const name of [
    "categoryAccuracy", "targetAccuracy", "targetCategoryAccuracy", "evidenceAccuracy",
  ]) {
    totals[name].ratio = ratio(totals[name].correct, totals[name].total);
  }
  totals.repeatAgreement.ratio = ratio(
    totals.repeatAgreement.agreements, totals.repeatAgreement.comparisons,
  );
  return totals;
}

export function evaluateGate({ named, provisional, evidence, tolerance = 0.05 }) {
  const reasons = [];
  const coverageRatio = (value) => ratio(value?.covered || 0, value?.total || 0);
  const accuracyRatio = (value) => ratio(value?.correct || 0, value?.total || 0);
  const agreementRatio = (value) => ratio(value?.agreements || 0, value?.comparisons || 0);
  if (evidence !== "live") reasons.push("representative live evidence is unavailable");
  if ((named.unexpectedFailures ?? 0) > 0 || (provisional.unexpectedFailures ?? 0) > 0) {
    reasons.push("live semantic evaluation contains failed calls");
  }
  if ((named.expectedFailureMatches ?? 0) < (named.expectedFailureChecks ?? 0) ||
      (provisional.expectedFailureMatches ?? 0) < (provisional.expectedFailureChecks ?? 0)) {
    reasons.push("failure-handling scenarios did not match their expected class");
  }
  if (coverageRatio(provisional.clientCoverage) !== 1) {
    reasons.push("provisional repaired step coverage is below 100%");
  }
  if ((provisional.falseStructuralOperations ?? Infinity) >
      (named.falseStructuralOperations ?? Infinity)) {
    reasons.push("provisional false structural operations exceed the named baseline");
  }
  if ((provisional.falseNoArchitectureConclusions ?? Infinity) >
      (named.falseNoArchitectureConclusions ?? Infinity)) {
    reasons.push("provisional false no-architecture conclusions exceed the named baseline");
  }
  if (accuracyRatio(provisional.targetCategoryAccuracy) + tolerance <
      accuracyRatio(named.targetCategoryAccuracy)) {
    reasons.push("provisional target/category accuracy is outside tolerance");
  }
  if ((provisional.repeatAgreement?.comparisons ?? 0) < 1 ||
      agreementRatio(provisional.repeatAgreement) !== 1) {
    reasons.push("provisional repeat outcomes are not fully stable");
  }
  return { passed: reasons.length === 0, reasons };
}

function safeFailureClass(error) {
  const value = error?.evaluationClass;
  return ["timeout", "quota", "refusal", "network", "malformed", "service"].includes(value)
    ? value
    : "service";
}

export async function runLiveEvaluation({ cases, call, repeats = 2 }) {
  if (!Number.isInteger(repeats) || repeats < 1) throw new TypeError("repeats must be a positive integer");
  const variants = {};
  let liveEvidenceChecks = 0;
  let liveEvidenceMatches = 0;
  for (const effort of EFFORTS) {
    for (const contextKind of CONTEXT_KINDS) {
      const scores = [];
      for (const testCase of cases) {
        const repeatedScores = [];
        for (let run = 0; run < repeats; run++) {
          const declared = testCase.execution?.scenario;
          if (testCase.expected?.failureClass || LOCAL_FAILURE_SCENARIOS.has(declared)) {
            repeatedScores.push(failureScore(testCase, declared, { local: true }));
            continue;
          }
          const requiresLiveEvidence = !testCase.expected?.failureClass &&
            testCase.expected?.fixtureOnly !== true;
          if (requiresLiveEvidence) liveEvidenceChecks++;
          try {
            const context = contextKind === "named"
              ? testCase.contexts.named
              : testCase.contexts.provisional;
            const response = await call({
              caseId: testCase.id,
              contextKind,
              effort,
              scenario: testCase.execution?.scenario || "semantic",
              prompt: buildImpactPrompt(context, testCase.steps),
            });
            if (response?.appliedEffort !== effort) {
              throw new Error(`evaluation service did not acknowledge ${effort} effort`);
            }
            if (requiresLiveEvidence && response.evidence === "live-model") liveEvidenceMatches++;
            if (!response.parsed || !Array.isArray(response.parsed.impacts)) {
              repeatedScores.push(failureScore(testCase, "malformed"));
            } else {
              const score = scoreCase(testCase, response.parsed, { contextKind });
              repeatedScores.push(testCase.expected?.failureClass ? {
                ...score,
                expectedFailureChecks: 1,
                expectedFailureMatches: 0,
              } : score);
            }
          } catch (error) {
            if (/did not acknowledge/i.test(error?.message || "")) throw error;
            repeatedScores.push(failureScore(testCase, safeFailureClass(error)));
          }
        }
        const agreement = repeatAgreementForScores(repeatedScores);
        repeatedScores.forEach((score, index) => {
          scores.push(index === 0 ? { ...score, repeatAgreement: agreement } : score);
        });
      }
      variants[`${contextKind}-${effort}`] = summarizeScores(scores);
    }
  }
  const evidence = liveEvidenceChecks > 0 && liveEvidenceMatches === liveEvidenceChecks
    ? "live"
    : "fixture";
  const gate = evaluateGate({
    named: variants["named-high"],
    provisional: variants["provisional-high"],
    evidence,
  });
  return {
    mode: "live",
    liveEvaluation: true,
    decision: evidence !== "live" ? "not-evaluated" : gate.passed ? "pass" : "fail",
    caseCount: cases.length,
    caseIds: cases.map((testCase) => testCase.id),
    repeats,
    evidence: {
      verifiedLiveModelCalls: liveEvidenceMatches,
      requiredLiveModelCalls: liveEvidenceChecks,
    },
    variants,
    gate,
  };
}

async function loadCases() {
  const parsed = JSON.parse(await readFile(CASES_URL, "utf8"));
  if (!Array.isArray(parsed)) throw new TypeError("evaluation corpus must be an array");
  for (const testCase of parsed) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(testCase?.id || "")) {
      throw new TypeError("evaluation case ids must be sanitized lowercase slugs");
    }
  }
  return parsed;
}

function impactEndpoint(value, name) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${name} must be a valid HTTP(S) URL`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  if (url.search) throw new Error(`${name} must not contain a query`);
  if (url.hash) throw new Error(`${name} must not contain a fragment`);
  return new URL("/v1/impact", url).href;
}

async function requestImpact({ endpoint, body, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  } catch (cause) {
    const error = new Error("evaluation request failed", { cause });
    error.evaluationClass = cause?.name === "TimeoutError" ? "timeout" : "network";
    throw error;
  }
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error("evaluation response was malformed");
    error.evaluationClass = "malformed";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("evaluation service returned an error");
    error.evaluationClass = response.status === 429 ? "quota"
      : response.status === 403 ? "refusal"
        : "service";
    throw error;
  }
  return data;
}

function createLiveCall({ env, fetchImpl }) {
  const configuredHigh = env.PLANGOLIN_EVAL_HIGH_URL;
  const configuredMedium = env.PLANGOLIN_EVAL_MEDIUM_URL;
  if (configuredHigh || configuredMedium) {
    if (!configuredHigh || !configuredMedium) {
      throw new Error("PLANGOLIN_EVAL_HIGH_URL and PLANGOLIN_EVAL_MEDIUM_URL are both required");
    }
    const highEndpoint = impactEndpoint(configuredHigh, "PLANGOLIN_EVAL_HIGH_URL");
    const mediumEndpoint = impactEndpoint(configuredMedium, "PLANGOLIN_EVAL_MEDIUM_URL");
    if (highEndpoint === mediumEndpoint) {
      throw new Error("high- and medium-effort evaluation URLs must be distinct instances");
    }
    const byEffort = { high: highEndpoint, medium: mediumEndpoint };
    return async ({ effort, prompt }) => {
      const data = await requestImpact({
        endpoint: byEffort[effort],
        body: { installId: "plan-impact-evaluation", prompt },
        fetchImpl,
      });
      if (typeof data.provider !== "string" || data.provider.trim().length === 0 ||
          typeof data.model !== "string" || data.model.trim().length === 0) {
        const error = new Error("evaluation service did not identify its live model");
        error.evaluationClass = "malformed";
        throw error;
      }
      return { parsed: data.parsed, appliedEffort: effort, evidence: "live-model" };
    };
  }

  const serviceUrl = env.PLANGOLIN_EVAL_SERVICE_URL;
  if (!serviceUrl) {
    throw new Error(
      "configure PLANGOLIN_EVAL_SERVICE_URL or distinct PLANGOLIN_EVAL_HIGH_URL and " +
      "PLANGOLIN_EVAL_MEDIUM_URL instances",
    );
  }
  const endpoint = impactEndpoint(serviceUrl, "PLANGOLIN_EVAL_SERVICE_URL");
  return async ({ caseId, contextKind, effort, scenario, prompt }) => {
    const data = await requestImpact({
      endpoint,
      body: {
        installId: "plan-impact-evaluation",
        prompt,
        evaluation: { caseId, contextKind, effort, scenario },
      },
      fetchImpl,
    });
    return {
      parsed: data.parsed,
      appliedEffort: data.evaluation?.effort ?? data.appliedEffort,
      evidence: data.evaluation?.evidence,
    };
  };
}

export async function main({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  cases,
} = {}) {
  const corpus = cases || await loadCases();
  if (env.PLANGOLIN_EVAL_LIVE !== "1") {
    stdout.write(`${JSON.stringify({
      mode: "offline",
      liveEvaluation: false,
      decision: "not-evaluated",
      caseCount: corpus.length,
      caseIds: corpus.map((testCase) => testCase.id),
    })}\n`);
    return;
  }
  const result = await runLiveEvaluation({
    cases: corpus,
    call: createLiveCall({ env, fetchImpl }),
    repeats: Number(env.PLANGOLIN_EVAL_REPEATS || 2),
  });
  stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`plan-impact evaluation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
