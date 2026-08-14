import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, proposalKey } from "../src/plan-brief.js";

const NODES = [
  { id: "server", name: "Server", intent: "Serves the app and the API." },
  { id: "schema", name: "Schema", intent: "Loads and validates the two files." },
];

const STEPS = [
  { n: 1, text: "Add a limiter" },
  { n: 2, text: "Wire it to the server" },
  { n: 3, text: "Back it with Redis" },
  { n: 4, text: "Run the tests" },
];

const DELTA = {
  additions: [
    { id: "limiter", name: "Limiter", kind: "", intent: "Refuses requests over the ceiling.", dir: "src/limit/", files: ["src/limit/rate-limit.js", "src/limit/window.js"], steps: [1] },
    { id: "counters", name: "Counter store", kind: "Redis", intent: "Holds counts across restarts.", dir: "src/limit/redis/", steps: [3] },
  ],
  touches: [{ id: "server", why: "gains a limit check", steps: [2] }],
  connections: [{ from: "server", to: "limiter", label: "checks with", steps: [2] }],
  unplaced: [{ steps: [4], why: "test setup" }],
};

test("an accepted addition is named with its folder and its plan steps", () => {
  const brief = buildBrief({
    nodes: NODES, steps: STEPS, delta: DELTA,
    accepted: new Set([proposalKey("add", "limiter"), proposalKey("edge", "server", "limiter")]),
  });
  assert.match(brief, /BUILD/);
  assert.match(brief, /Limiter — Refuses requests over the ceiling\./);
  assert.match(brief, /lives in: src\/limit\//);
  assert.match(brief, /files:\n\s+src\/limit\/rate-limit\.js\n\s+src\/limit\/window\.js/);
  assert.match(brief, /Server ──▶ Limiter \(checks with\)/);
  assert.match(brief, /from the plan: "Add a limiter"/);
});

// The numbers are plangolin's own indices over headings, bullets and prose.
// The model reading this holds the plan and counts differently, so a bare
// number points it at the wrong lines. The words are unambiguous.
test("the brief quotes the plan's words rather than an internal step number", () => {
  const brief = buildBrief({
    nodes: NODES, steps: STEPS, delta: DELTA,
    accepted: new Set([proposalKey("add", "limiter"), proposalKey("touch", "server")]),
  });
  assert.match(brief, /from the plan: "Add a limiter"/);
  assert.match(brief, /from the plan: "Wire it to the server"/);
  assert.doesNotMatch(brief, /plan step 1/);
});

// The whole point of the feature. A rejection has to survive as an
// instruction, because the alternative — leaving it out — is silence, and
// silence is indistinguishable from an oversight.
test("a rejected addition is named under OUT OF SCOPE with do-not-build", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set([proposalKey("add", "limiter")]) });
  assert.match(brief, /OUT OF SCOPE/);
  assert.match(brief, /Do not build them\./);
  assert.match(brief, /✗ Counter store/);
  assert.doesNotMatch(brief.split("OUT OF SCOPE")[0], /Counter store/);
});

test("a rejected connection is named too", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set([proposalKey("add", "limiter")]) });
  assert.match(brief, /✗ Server ──▶ Limiter/);
});

test("an accepted touch lands under UPDATE with its reason", () => {
  const brief = buildBrief({
    nodes: NODES, steps: STEPS, delta: DELTA,
    reach: [{ id: "schema", via: "server", label: "exports API" }],
    accepted: new Set([proposalKey("touch", "server")]),
  });
  assert.match(brief, /UPDATE/);
  assert.match(brief, /Server — gains a limit check/);
  assert.match(brief, /Used by Schema \(exports API\)/);
  assert.match(brief, /from the plan: "Wire it to the server"/);
});

// Every block not named anywhere in the accepted set. Without this, a plan
// that says nothing about Schema leaves Claude free to decide Schema needs
// changing, which is the scope creep this feature exists to catch.
test("untouched blocks are listed as do not touch", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set([proposalKey("touch", "server")]) });
  assert.match(brief, /DO NOT TOUCH\n\s*Schema/);
});

test("steps that changed nothing are counted and kept as written", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set() });
  assert.match(brief, /1 plan step changes nothing about the shape of the system/);
  assert.match(brief, /build it as written/);
});

// Approving nothing is a real answer, not an empty file. It means "the plan
// changes no structure" — which is information, and Claude must be told it
// rather than handed a blank.
test("approving nothing still says something useful", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: { additions: [], touches: [], connections: [], unplaced: [] }, accepted: new Set() });
  assert.match(brief, /Reviewed in plangolin/);
  assert.match(brief, /no change to the shape of the system/i);
  assert.match(brief, /DO NOT TOUCH\n\s*Server, Schema/);
});

// A brief that says "build this line to Cache" three lines above "do not
// build Cache" is worse than useless: it is the one artefact Claude is held
// to, and it contradicts itself.
test("an accepted line to a rejected block is out of scope, not under BUILD", () => {
  const brief = buildBrief({
    nodes: NODES, steps: STEPS, delta: DELTA,
    accepted: new Set([proposalKey("edge", "server", "limiter")]),
  });
  assert.doesNotMatch(brief.split("OUT OF SCOPE")[0], /Server ──▶ Limiter/);
  assert.match(brief, /✗ Server ──▶ Limiter/);
});

// The sheet can be edited between the model call and Approve, so the posted
// node list is not guaranteed to hold every id the delta names.
test("an id the posted sheet does not know renders as the id, never as undefined", () => {
  const delta = {
    additions: [], touches: [{ id: "ghost", why: "gains a check", steps: [2] }],
    connections: [], unplaced: [],
  };
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta, accepted: new Set([proposalKey("touch", "ghost")]) });
  assert.match(brief, /ghost — gains a check/);
  assert.doesNotMatch(brief, /undefined/);
});

// Silent truncation that reads as complete coverage is the worst failure this
// feature has: the scope sections would look like they ruled on the whole plan.
test("a truncated plan says so in the brief", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set(), truncated: true });
  assert.match(brief, /only the first 4 steps/i);
});

test("a plan read in full claims no such limit", () => {
  const brief = buildBrief({ nodes: NODES, steps: STEPS, delta: DELTA, accepted: new Set() });
  assert.doesNotMatch(brief, /only the first/i);
});

test("proposalKey distinguishes an edge from a block of the same name", () => {
  assert.notEqual(proposalKey("add", "a"), proposalKey("touch", "a"));
  assert.notEqual(proposalKey("edge", "a", "b"), proposalKey("edge", "b", "a"));
});

/* The literals, hard-coded. `planKey` in app/app.js:612 builds these same
   strings by hand — the browser has no build step and cannot import this file
   — and a key the store does not recognise is read as a rejection rather than
   an error. So a drift turns every acceptance into a rejection and briefs
   Claude to build nothing, silently. Calling proposalKey() on both sides of an
   assertion would reimplement the function and prove nothing about the format;
   these strings are the contract. */
test("proposalKey's exact strings are the contract app.js copies", () => {
  assert.equal(proposalKey("add", "x"), "add:x");
  assert.equal(proposalKey("touch", "x"), "touch:x");
  assert.equal(proposalKey("edge", "a", "b"), "edge:a>b");
});
