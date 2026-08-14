import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief } from "../src/plan-brief.js";

const NODES = [
  { id: "api", name: "API Server", intent: "Serves requests." },
  { id: "database", name: "Database", intent: "Stores records." },
  { id: "schema", name: "Schema", intent: "Validates records." },
  { id: "docs", name: "Documentation", intent: "Explains the project." },
];

const STEPS = [
  { n: 1, text: "Add a cache in src/cache.js and connect the API to it." },
  { n: 2, text: "Remove the old database connection." },
  { n: 3, text: "Serve cached requests from the API." },
  { n: 4, text: "Add cache eviction inside the API." },
  { n: 5, text: "Add API cache tests." },
  { n: 6, text: "Document the cache rollout." },
  { n: 7, text: "Move the cache policy somewhere appropriate." },
  { n: 8, text: "Tune the cache expiry." },
];

const IMPACTS = [
  {
    key: "impact:1", level: "system", targetId: "", title: "Add cache layer",
    why: "Keeps repeated responses available.", size: "substantial", steps: [1],
    files: ["src/cache.js"], symbols: [],
    additions: [{ id: "cache", name: "Cache", kind: "Module", intent: "Stores reusable responses.", dir: "src/cache", files: ["src/cache.js"] }],
    removals: [], responsibilities: [],
    connections: [{ from: "api", to: "cache", label: "reads and writes" }],
    disconnections: [],
  },
  {
    key: "impact:2", level: "system", targetId: "", title: "Retire direct database access",
    why: "The cache takes over request reads.", size: "substantial", steps: [2], files: [], symbols: [],
    additions: [], removals: [{ id: "database" }], responsibilities: [], connections: [],
    disconnections: [{ from: "api", to: "database" }],
  },
  {
    key: "impact:3", level: "system", targetId: "", title: "Update API responsibility",
    why: "The API no longer reads the database directly.", size: "small", steps: [3], files: [], symbols: [],
    additions: [], removals: [],
    responsibilities: [{ id: "api", intent: "Serves cached requests.", why: "Stops direct database reads." }],
    connections: [], disconnections: [],
  },
  {
    key: "impact:4", level: "component", targetId: "api", title: "Add cache eviction",
    why: "Bounds cache memory.", size: "small", steps: [4], files: [], symbols: [],
    additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
  },
  {
    key: "impact:5", level: "support", targetId: "api", title: "Add API cache tests",
    why: "Covers cache behavior.", size: "small", steps: [5], files: [], symbols: [],
    additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
  },
  {
    key: "impact:6", level: "support", targetId: "", title: "Document cache rollout",
    why: "Explains the release.", size: "small", steps: [6], files: [], symbols: [],
    additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
  },
  {
    key: "impact:7", level: "unresolved", targetId: "", title: "Place cache policy",
    why: "The intended component is not known.", size: "", steps: [7], files: [], symbols: [],
    additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
  },
  {
    key: "impact:8", level: "component", targetId: "cache", title: "Tune cache expiry",
    why: "The expiry policy needs a decision.", size: "small", steps: [8], files: [], symbols: [],
    additions: [], removals: [], responsibilities: [], connections: [], disconnections: [],
  },
];

const ALL_BUT_LAST = new Set(IMPACTS.slice(0, -1).map((impact) => impact.key));

function brief(accepted = ALL_BUT_LAST, options = {}) {
  return buildBrief({
    nodes: NODES, steps: STEPS, impacts: IMPACTS,
    reach: [{ id: "schema", via: "api", label: "validates requests" }],
    accepted,
    ...options,
  });
}

test("one accepted system impact keeps its addition and connection together", () => {
  const out = buildBrief({
    nodes: NODES, steps: STEPS, impacts: [IMPACTS[0]], reach: [],
    accepted: new Set(["impact:1"]), truncated: false,
  });

  assert.match(out, /BUILD/);
  assert.match(out, /Cache — Stores reusable responses\./);
  assert.match(out, /API Server ──▶ Cache \(reads and writes\)/);
  assert.match(out, /from the plan: "Add a cache in src\/cache\.js and connect the API to it\."/);
  assert.doesNotMatch(out, /OUT OF SCOPE/);
});

test("rejecting a system impact cuts all of its structural operations together", () => {
  const out = buildBrief({
    nodes: NODES, steps: STEPS, impacts: [IMPACTS[0]], reach: [],
    accepted: new Set(), truncated: false,
  });

  assert.doesNotMatch(out, /BUILD/);
  assert.match(out, /OUT OF SCOPE/);
  assert.match(out, /✗ Add cache layer — Keeps repeated responses available\./);
  assert.match(out, /from the plan: "Add a cache in src\/cache\.js and connect the API to it\."/);
});

test("the populated brief keeps the mandated section order", () => {
  const out = brief();
  const headings = [
    "BUILD", "REMOVE", "UPDATE RESPONSIBILITY", "INTERNAL WORK", "SUPPORTING WORK",
    "OUT OF SCOPE", "NEEDS REVIEW", "DO NOT TOUCH",
  ];
  const positions = headings.map((heading) => out.indexOf(`\n${heading}\n`));

  assert.ok(positions.every((position) => position > -1));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("accepted removals, disconnections, and responsibility changes retain their cited steps", () => {
  const out = brief();

  assert.match(out, /REMOVE\n\s+Remove Database\./);
  assert.match(out, /Disconnect API Server ──▶ Database\./);
  assert.match(out, /UPDATE RESPONSIBILITY\n\s+API Server — Serves cached requests\. Stops direct database reads\./);
  assert.match(out, /Used by Schema \(validates requests\)/);
  assert.match(out, /from the plan: "Remove the old database connection\."/);
  assert.match(out, /from the plan: "Serve cached requests from the API\."/);
});

test("internal and supporting work are grouped by their target or Project Support", () => {
  const out = brief();

  assert.match(out, /INTERNAL WORK\n\s+API Server\n\s+Add cache eviction — Bounds cache memory\./);
  assert.match(out, /SUPPORTING WORK\n\s+API Server\n\s+Add API cache tests — Covers cache behavior\./);
  assert.match(out, /Project Support\n\s+Document cache rollout — Explains the release\./);
  assert.match(out, /from the plan: "Add API cache tests\."/);
  assert.match(out, /from the plan: "Document the cache rollout\."/);
});

test("component-scoped support protects its target from DO NOT TOUCH", () => {
  const support = IMPACTS.find((impact) => impact.key === "impact:5");
  const out = buildBrief({
    nodes: NODES,
    steps: STEPS,
    impacts: [support],
    reach: [],
    accepted: new Set([support.key]),
  });

  assert.match(out, /SUPPORTING WORK\n\s+API Server\n\s+Add API cache tests/);
  assert.doesNotMatch(out.split("DO NOT TOUCH")[1] || "", /API Server/);
  assert.match(out, /DO NOT TOUCH\n\s+Database, Schema, Documentation/);
});

test("accepted unresolved work directs the worker to confirm scope", () => {
  const out = brief();

  assert.match(out, /NEEDS REVIEW/);
  assert.match(out, /Confirm the intended component before inferring missing scope\./);
  assert.match(out, /Place cache policy — The intended component is not known\./);
  assert.match(out, /from the plan: "Move the cache policy somewhere appropriate\."/);
});

test("rejected impacts cite their original plan steps and accepted changes protect affected components", () => {
  const out = brief();

  assert.match(out, /OUT OF SCOPE\n\s+The user removed these\. Do not build them\./);
  assert.match(out, /✗ Tune cache expiry — The expiry policy needs a decision\./);
  assert.match(out, /from the plan: "Tune the cache expiry\."/);
  assert.match(out, /DO NOT TOUCH\n\s+Schema, Documentation/);
  assert.doesNotMatch(out.split("DO NOT TOUCH")[1], /API Server|Database/);
});

test("the brief guards its trusted impact contract and keeps truncation explicit", () => {
  assert.throws(() => buildBrief({ nodes: NODES, steps: STEPS, accepted: new Set() }), /impacts must be an array/i);
  assert.throws(() => buildBrief({ nodes: NODES, steps: STEPS, impacts: [], accepted: [] }), /accepted must be a set/i);

  const out = brief(ALL_BUT_LAST, { truncated: true });
  assert.match(out, /Only the first 8 steps of this plan were reviewed in plangolin\./);
  assert.doesNotMatch(out, /changes nothing structural/i);
  assert.doesNotMatch(out, /approved no change to the shape/i);
});
