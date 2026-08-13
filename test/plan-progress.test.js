import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPlanPollScheduler,
  createPlanRetryController,
  planControlState,
  planPollDelay,
  planProgressCopy,
  planSummary,
} from "../app/plan-progress.js";

const APP = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const STEPS = Array.from({ length: 7 }, (_, index) => ({
  n: index + 1,
  text: `Plan step ${index + 1}`,
}));

const NODES = [
  { id: "api", name: "API Server" },
  { id: "tests", name: "Test Suite" },
  { id: "cache", name: "Legacy Cache" },
];

function impact(overrides = {}) {
  return {
    key: "impact:api",
    level: "component",
    targetId: "api",
    title: "Change request handling",
    why: "Keeps requests safe.",
    steps: [1],
    additions: [],
    removals: [],
    responsibilities: [],
    connections: [],
    disconnections: [],
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    id: "review:1",
    status: "ready",
    phase: "",
    revision: 4,
    counts: { files: 84, components: 8, steps: 12 },
    steps: STEPS,
    impacts: [
      impact(),
      impact({ key: "impact:tests", level: "support", targetId: "tests" }),
    ],
    note: "",
    ...overrides,
  };
}

test("working phases describe real progress with bounded project counts", () => {
  const cases = [
    ["mapping_project", { files: 84 }, "Mapping your project — 84 files found"],
    ["grouping_components", {}, "Grouping those files into components"],
    ["naming_and_matching", { components: 8, steps: 12 },
      "Naming 8 components and matching 12 plan steps"],
    ["loading_system_map", {}, "Loading your system map"],
    ["matching_plan", { steps: 12 }, "Matching 12 plan steps to your system map"],
    ["arranging_review", {}, "Arranging the review"],
  ];

  for (const [phase, counts, expected] of cases) {
    assert.equal(planProgressCopy(review({ status: "working", phase, counts })), expected);
  }
  assert.equal(planProgressCopy(review({
    status: "working",
    phase: "naming_and_matching",
    counts: { components: Infinity, steps: 4_000_000.9 },
  })), "Naming 0 components and matching 1000000 plan steps");
});

test("progress and outcome copy excludes obsolete implementation language", () => {
  const outputs = [
    planProgressCopy(review({ status: "working", phase: "mapping_project" })),
    planProgressCopy(review({ status: "working", phase: "unknown" })),
    planSummary(review(), { nodes: [], edges: [], annotations: {} }, NODES),
  ];

  for (const output of outputs) {
    assert.doesNotMatch(output, /sheet|node|This plan changes nothing structural\./i);
  }
});

test("an internal-only summary names affected components before the secondary shape note", () => {
  const result = planSummary(review(), {
    nodes: [
      { planType: "card", impactKey: "impact:api", parent: "api" },
      { planType: "card", impactKey: "impact:tests", parent: "tests" },
    ],
    edges: [],
    annotations: { removals: [], responsibilities: [], disconnections: [] },
  }, NODES);

  assert.equal(result,
    "7 plan steps reviewed. Work affects API Server and Test Suite. " +
    "The system shape stays the same.");
});

test("a structural summary leads with additions, removals, and connections", () => {
  const structural = review({
    impacts: [impact({
      key: "impact:structure",
      level: "system",
      targetId: "",
      additions: [{ id: "limiter", name: "Rate Limiter" }],
      removals: [{ id: "cache" }],
      connections: [{ from: "api", to: "limiter", label: "checks limits" }],
    })],
  });
  const projection = {
    nodes: [{
      id: "plan:limiter", sourceId: "limiter", name: "Rate Limiter", planType: "addition",
    }],
    edges: [{ from: "api", to: "plan:limiter", planType: "connection" }],
    annotations: {
      removals: [{ targetId: "cache" }], responsibilities: [], disconnections: [],
    },
  };

  const result = planSummary(structural, projection, NODES);

  assert.match(result, /^Adds Rate Limiter\. Removes Legacy Cache\. Connects API Server to Rate Limiter\./);
  assert.match(result, /7 plan steps reviewed\./);
  assert.doesNotMatch(result, /system shape stays the same/i);
});

test("a partial summary identifies Needs Review without claiming a settled shape", () => {
  const partial = review({
    status: "partial",
    impacts: [
      impact(),
      impact({
        key: "impact:unknown",
        level: "unresolved",
        targetId: "",
        steps: [4, 5],
      }),
    ],
  });

  const result = planSummary(partial, {
    nodes: [], edges: [], annotations: { removals: [], responsibilities: [], disconnections: [] },
  }, NODES);

  assert.match(result, /Needs Review: 2 plan steps still need a component\./);
  assert.doesNotMatch(result, /system shape stays the same/i);
});

test("an error summary reports the safe service message without claiming review coverage", () => {
  const result = planSummary(review({
    status: "error",
    note: "This Plangolin service does not support impact review yet. Retry after it updates, or skip this review.",
    impacts: [],
  }), { nodes: [], edges: [], annotations: {} }, NODES);

  assert.equal(result,
    "Review stopped safely. This Plangolin service does not support impact review yet. " +
    "Retry after it updates, or skip this review.");
  assert.doesNotMatch(result, /steps? reviewed|work affects|system shape/i);
});

test("a truncated error removes the server's stale reviewed-step coverage claim", () => {
  const result = planSummary(review({
    status: "error",
    note: "This plan is longer than plangolin reads — only the first 60 steps were reviewed. " +
      "Couldn't read this plan — review it by hand.",
    impacts: [],
  }), { nodes: [], edges: [], annotations: {} }, NODES);

  assert.equal(result, "Review stopped safely. Couldn't read this plan — review it by hand.");
  assert.doesNotMatch(result, /60|steps? reviewed/i);
});

test("poll delay is fast for every active review outcome and slow when idle or decided", () => {
  for (const status of ["working", "ready", "partial", "error"]) {
    assert.equal(planPollDelay({ status }), 500, status);
  }
  for (const current of [null, undefined, { status: "resolved" }, { status: "skipped" }]) {
    assert.equal(planPollDelay(current), 2000);
  }
});

test("poll scheduler waits for completion before scheduling the next non-overlapping poll", async () => {
  const scheduled = [];
  const gates = [];
  let active = 0;
  let maximumActive = 0;
  let current = { status: "working" };
  const scheduler = createPlanPollScheduler({
    async poll() {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => gates.push(resolve));
      active--;
    },
    review: () => current,
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout() {},
  });

  scheduler.start();
  scheduler.start();
  await Promise.resolve();
  assert.equal(active, 1);
  assert.equal(scheduled.length, 0);

  gates.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(scheduled.map(({ delay }) => delay), [500]);

  current = null;
  const next = scheduled.shift();
  next.callback();
  await Promise.resolve();
  assert.equal(active, 1);
  assert.equal(scheduled.length, 0);
  gates.shift()();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(maximumActive, 1);
  assert.deepEqual(scheduled.map(({ delay }) => delay), [2000]);
});

test("poll scheduler continues after fetch failure and stop cancels the pending timer", async () => {
  const scheduled = [];
  const cleared = [];
  let calls = 0;
  const scheduler = createPlanPollScheduler({
    async poll() {
      calls++;
      if (calls === 1) throw new Error("server restarting");
    },
    review: () => ({ status: "error" }),
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) { cleared.push(timer); },
  });

  scheduler.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(scheduled.map(({ delay }) => delay), [500]);

  scheduler.stop();
  assert.deepEqual(cleared, [scheduled[0]]);
  scheduled[0].callback();
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("control state exposes only safe actions for error, partial, and working reviews", () => {
  assert.deepEqual(planControlState({ status: "error" }), {
    keep: false, cut: false, approve: false, retry: true, skip: true,
    navigation: false, warning: "",
  });
  assert.deepEqual(planControlState({ status: "partial" }), {
    keep: true, cut: true, approve: true, retry: false, skip: false,
    navigation: true, warning: "Needs Review — check unresolved plan steps before approving.",
  });
  assert.deepEqual(planControlState({ status: "working" }), {
    keep: false, cut: false, approve: false, retry: false, skip: false,
    navigation: false, warning: "",
  });
});

test("retry posts once, immediately publishes working state, and preserves the failed plan", async () => {
  let current = review({
    status: "error",
    phase: "",
    note: "Provider unavailable.",
    impacts: [impact()],
  });
  const failed = current;
  const published = [];
  const requests = [];
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const retry = createPlanRetryController({
    review: () => current,
    publish(next) { current = next; published.push(next); },
    fetch(path, options) {
      requests.push({ path, options });
      return response;
    },
  });

  const first = retry();
  const duplicate = await retry();

  assert.equal(duplicate, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/plan/retry");
  assert.deepEqual(requests[0].options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "review:1" }),
  });
  assert.equal(current.status, "working");
  assert.equal(current.phase, "loading_system_map");
  assert.equal(current.note, "");
  assert.equal(current.steps, failed.steps);
  assert.equal(current.impacts, failed.impacts);

  release({ ok: true, json: async () => ({ ok: true }) });
  assert.equal(await first, true);
  assert.equal(published.length, 1);
});

test("a failed retry restores the actionable error only if polling has not advanced", async () => {
  let current = review({ status: "error", note: "Provider unavailable." });
  const failed = current;
  const published = [];
  const retry = createPlanRetryController({
    review: () => current,
    publish(next) { current = next; published.push(next); },
    async fetch() { throw new Error("offline"); },
  });

  assert.equal(await retry(), false);
  assert.equal(current.status, "error");
  assert.match(current.note, /didn't reach Plangolin/i);
  assert.equal(current.steps, failed.steps);
  assert.equal(current.impacts, failed.impacts);
  assert.equal(published.length, 2);
});

test("the browser consumes the tested progress, control, retry, and polling behavior", () => {
  assert.match(APP, /from "\.\/plan-progress\.js"/);
  for (const helper of [
    "planProgressCopy", "planSummary", "planControlState",
    "createPlanRetryController", "createPlanPollScheduler",
  ]) assert.match(APP, new RegExp("\\b" + helper + "\\b"), helper);
  assert.doesNotMatch(APP, /setInterval\(pollPlan/);
  assert.match(APP, /addEventListener\("pagehide"/);
  assert.match(HTML, /id="plan-progress"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(HTML, /id="plan-retry"/);
  assert.match(HTML, /id="plan-skip"/);
  assert.doesNotMatch(HTML, /Preparing the plan against your system map/);
});
