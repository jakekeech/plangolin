# Total Plan Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every successful plan review contain complete visible system or nested component decisions, with no unresolved/support-only success path and no empty approval.

**Architecture:** The hosted LLM chooses semantic placement from only `system` and `component`; the plugin validates that choice, repairs only unambiguous file-owner omissions, and retries invalid items once with constrained choices. Compact section parsing prevents prose and ordering paragraphs from becoming separate decisions, while the store and browser fail closed if complete visible coverage is not achieved.

**Tech Stack:** Node.js ESM, `node:test`, JSON Schema structured output, browser-native JavaScript, Markdown plugin skills.

**Spec:** `docs/superpowers/specs/2026-08-14-total-plan-placement-design.md`

## Global Constraints

- A successful review contains at least one visible decision.
- Final review decisions use only `system` and `component` levels.
- Every actionable parsed item is covered exactly once.
- Deterministic repair may select one unambiguous existing owner; it may not invent nodes, names, responsibilities, or connections.
- Invalid placement receives at most one constrained model retry.
- Placement failure exposes Retry and Skip, never Approve.
- Supporting details attach to a visible decision and never create graph nodes.
- Normal warm/prepared reviews retain one model call.
- Plan projection remains transient and never enters `system.json`.
- Preserve unrelated changes in both repositories.

---

## Repository and file map

The plugin repository is `/Users/jakekee/code/plangolin-public`.

- `src/plan-steps.js`: extracts actionable numbered decision sections.
- `src/plan-impact.js`: builds prompts, validates operations, repairs owner targets, performs constrained retry, and assigns trusted keys.
- `src/plan-store.js`: converts placement results into review lifecycle state and gates server-side resolution.
- `src/plan-brief.js`: emits accepted visible decisions and their attached source details.
- `app/plan-progress.js`: derives browser copy and approval controls.
- `app/plan-projection.js`: creates transient system and nested component projections.
- `app/app.js`: renders the stepper and removes legacy Needs Review behavior.
- `skills/plangolin/SKILL.md`: instructs agents to produce compact numbered decision sections.
- `scripts/evaluate-plan-impact.js`: evaluates placement quality and no longer treats unresolved as a valid semantic class.

The hosted service repository is `/Users/jakekee/code/launchpad`.

- `service/tasks.js`: defines the `impact` prompt and structured-output schema.
- `service/task-metrics.js`: records content-free system/component counts.
- `test/tasks.test.js` and `test/task-metrics.test.js`: protect the hosted contract.

---

### Task 1: Parse numbered decision sections as single items

**Files:**
- Modify: `src/plan-steps.js`
- Modify: `test/plan-steps.test.js`
- Create: `test/fixtures/pushpush-auth-plan.md`

**Interfaces:**
- Consumes: Markdown supplied to `splitSteps(markdown)` and `stepCount(markdown)`.
- Produces: the existing `{ n: number, text: string }[]` interface, with numbered Markdown headings grouped with their bodies.

- [ ] **Step 1: Add the sanitized Pushpush reproduction fixture**

Create `test/fixtures/pushpush-auth-plan.md` with eight numbered `## N.` sections matching the reproduced shapes: User Store, Auth Module, Auth Endpoints, Protected API, Job Ownership, Client API, Client Session, and Tests. Include a preamble, an unnumbered `## Also proposed` section, and an unnumbered `## Order` section so the regression covers the exact paragraph inflation.

```markdown
# User accounts and authentication

Defaults: email/password, JWT, and SQLite.

## 1. New component — user store (`server/db.py`)

Persist accounts and job ownership.

Supporting: configure `DATABASE_URL`.

## 2. Auth module (`server/auth.py`)

Hash passwords and validate bearer tokens.

## 3. Auth endpoints (`server/routes_auth.py`)

Register, login, and return the current user.

## 4. Protect the existing API (`server/api.py`)

Require the current user for analysis and job routes.

## 5. Job ownership (`server/api.py`)

Scope every job to its owner.

## 6. Authenticated client API (`app/lib/api.ts`)

Attach the bearer token to requests.

## 7. Client session (`app/lib/auth.tsx`)

Add secure token storage and login/register screens.

## 8. Tests (`server/test_auth.py`)

Cover authentication and cross-user job isolation.

## Also proposed

An optional history screen.

## Order

Build the backend before the client.
```

- [ ] **Step 2: Write the failing section-mode tests**

Add tests that read the fixture and require exactly eight items, preserve each numbered heading with its section body, keep the supporting database detail inside item 1, and exclude the preamble, Also proposed, and Order sections.

```js
test("numbered heading plans become one decision per numbered section", () => {
  const source = readFileSync(new URL("./fixtures/pushpush-auth-plan.md", import.meta.url), "utf8");
  const steps = splitSteps(source);
  assert.equal(steps.length, 8);
  assert.match(steps[0].text, /New component — user store/);
  assert.match(steps[0].text, /DATABASE_URL/);
  assert.match(steps[6].text, /Client session/);
  assert.doesNotMatch(steps.map((step) => step.text).join("\n"), /Also proposed|Build the backend before/);
  assert.equal(stepCount(source), 8);
});
```

Also retain a regression proving plans without numbered headings use the existing heading/list/paragraph parser unchanged.

- [ ] **Step 3: Run the parser tests and capture RED**

Run: `node --test test/plan-steps.test.js`

Expected: the fixture test fails because the current parser produces more than eight steps.

- [ ] **Step 4: Implement numbered-section mode**

Add a detection pass for headings matching `^ {0,3}#{1,6}\s+\d+[.)]\s+`. When at least one exists, collect text from each numbered heading through the next heading at the same or higher level. Ignore content before the first numbered heading and stop collecting when an unnumbered heading at the numbered section's level or higher begins.

```js
const NUMBERED_HEADING = /^ {0,3}(#{1,6})\s+(\d+)[.)]\s+(.*)$/;

function splitNumberedSections(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => NUMBERED_HEADING.test(line))) return null;
  const sections = [];
  let current = null;
  for (const line of lines) {
    const numbered = line.match(NUMBERED_HEADING);
    const heading = line.match(HEADING);
    if (numbered) {
      if (current) sections.push(current);
      current = { depth: numbered[1].length, lines: [numbered[3].trim()] };
      continue;
    }
    if (current && heading && line.match(/^ {0,3}(#{1,6})/)?.[1].length <= current.depth) {
      sections.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push(line.trim());
  }
  if (current) sections.push(current);
  return sections.map(({ lines }) => lines.join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean).map((text) => text.slice(0, MAX_STEP_CHARS));
}
```

Call this before `splitAll`'s legacy parser and use the returned array when non-null.

- [ ] **Step 5: Run parser tests GREEN**

Run: `node --test test/plan-steps.test.js`

Expected: all parser tests pass and the fixture yields eight items.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/plan-steps.js test/plan-steps.test.js test/fixtures/pushpush-auth-plan.md
git commit -m "fix: parse compact plan decisions"
```

---

### Task 2: Restrict the hosted impact contract to visible decisions

**Files (service repository):**
- Modify: `service/tasks.js`
- Modify: `service/task-metrics.js`
- Modify: `test/tasks.test.js`
- Modify: `test/task-metrics.test.js`

**Interfaces:**
- Consumes: `/v1/impact` prompts containing a project map and numbered decisions.
- Produces: the existing `impacts` response shape with `level` restricted to `system | component`.

- [ ] **Step 1: Write failing hosted-contract tests**

Change the schema test to require only visible levels and add prompt assertions that forbid unresolved/support outputs while requiring every step to choose a target or structural operation.

```js
test("impact returns only visible review decisions", () => {
  const impact = TASKS.impact;
  assert.deepEqual(impact.schema.properties.impacts.items.properties.level.enum, ["system", "component"]);
  assert.doesNotMatch(impact.system, /Use "unresolved"/);
  assert.doesNotMatch(impact.system, /Use "support"/);
  assert.match(impact.system, /Every supplied step must belong to exactly one visible decision/);
  assert.match(impact.system, /tests, docs, config, CI, rollout, and sequencing.*same decision/is);
});
```

Update metric tests to expect `{ system, component }` only and prove legacy categories are ignored without logging content.

- [ ] **Step 2: Run the service tests and capture RED**

Run from `/Users/jakekee/code/launchpad`: `node --test test/tasks.test.js test/task-metrics.test.js`

Expected: enum, prompt, and metric category assertions fail.

- [ ] **Step 3: Rewrite the impact system prompt**

Replace the category rules with:

```text
Every supplied step must belong to exactly one visible decision.
Use "system" for additions, removals, responsibility changes, connections,
and disconnections. Use "component" for meaningful work inside the deepest
justified existing or response-local proposed component. Tests, docs, config,
CI, rollout, and sequencing belong to the same system or component decision
they support. Never return a catch-all, unplaced, support, or unresolved item.
For every component impact choose a supplied or response-local targetId. For
every system impact return at least one valid structural operation.
```

Set `IMPACT_ITEM.properties.level.enum` to `['system', 'component']`.

- [ ] **Step 4: Narrow content-free metrics**

Set `CATEGORIES` and the returned category object to system/component only:

```js
const CATEGORIES = ["system", "component"];
const categories = { system: 0, component: 0 };
```

- [ ] **Step 5: Run the full tracked service suite GREEN**

Run from `/Users/jakekee/code/launchpad`: `node --test test/*.test.js`

Expected: all service tests pass.

- [ ] **Step 6: Commit Task 2 in the service repository**

Stage only the four listed service files; preserve every unrelated tracked or untracked file.

```bash
git add service/tasks.js service/task-metrics.js test/tasks.test.js test/task-metrics.test.js
git commit -m "fix: require visible plan placements"
```

---

### Task 3: Validate total placement and repair one unambiguous owner

**Files:**
- Modify: `src/plan-impact.js`
- Modify: `test/plan-impact.test.js`

**Interfaces:**
- Consumes: first-pass responses, `{ nodes, edges, steps }`, and literal file evidence.
- Produces: `validateImpacts(...) -> { impacts, diagnostics, coverage }`, where final impacts contain only valid system/component entries and `coverage.complete` is explicit.

- [ ] **Step 1: Replace unresolved-success tests with failing total-placement tests**

Add tests for these exact behaviors:

```js
test("repairs a blank component target from one unambiguous file owner", () => {
  const result = validate([impact({ targetId: "", files: ["src/api.js"], steps: [2] })], {
    steps: [STEPS[1]],
  });
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.impacts.map(({ level, targetId }) => ({ level, targetId })), [
    { level: "component", targetId: "api" },
  ]);
});

test("does not invent placement when evidence has multiple or no owners", () => {
  const result = validate([impact({ targetId: "", files: [], steps: [2] })], {
    steps: [STEPS[1]],
  });
  assert.deepEqual(result.impacts, []);
  assert.deepEqual(result.coverage, { claimed: 0, total: 1, complete: false });
  assert.deepEqual(result.rejectedSteps, [2]);
});

test("legacy support with a valid target becomes nested component detail", () => {
  const result = validate([impact({ level: "support", targetId: "api", steps: [2] })], {
    steps: [STEPS[1]],
  });
  assert.equal(result.impacts[0].level, "component");
  assert.equal(result.impacts[0].targetId, "api");
});
```

Update invalid-operation, orphan-reference, missing-step, conflict, and blank-title tests to expect rejected step numbers and incomplete coverage rather than generated unresolved impacts.

- [ ] **Step 2: Run validator tests and capture RED**

Run: `node --test test/plan-impact.test.js`

Expected: new coverage and repair assertions fail; old unresolved assertions identify every behavior that must be migrated.

- [ ] **Step 3: Add deepest owner resolution**

Add pure helpers that compare safe literal evidence paths to `anchor.paths` and `anchor.dir`, then choose the deepest single owner.

```js
function nodeOwnsFile(node, path) {
  const paths = list(node?.anchor?.paths).map(safePath);
  const dir = safePath(node?.anchor?.dir);
  return paths.includes(path) || (dir && (path === dir || path.startsWith(dir + "/")));
}

function deepestSingleOwner(nodes, files) {
  const parents = new Map(nodes.map((node) => [node.id, node.parent || ""]));
  const depth = (id) => { let n = 0; for (let p = parents.get(id); p; p = parents.get(p)) n++; return n; };
  const candidates = nodes.filter((node) => files.length && files.every((file) => nodeOwnsFile(node, file)));
  if (!candidates.length) return "";
  const deepest = Math.max(...candidates.map((node) => depth(node.id)));
  const winners = candidates.filter((node) => depth(node.id) === deepest);
  return winners.length === 1 ? winners[0].id : "";
}
```

Before candidate validation, normalize legacy `support` with a valid target to `component`. Normalize `support`, `unresolved`, or blank-target component entries to `component` only when `deepestSingleOwner` returns one id.

- [ ] **Step 4: Stop generating unresolved impacts**

Replace `unresolvedCandidate` and `addMissingAsUnresolved` with internal rejection metadata. Invalid candidates contribute their still-valid step numbers to a `rejectedSteps` set and do not enter the returned impact list.

Return:

```js
const claimed = new Set(impacts.flatMap((impact) => impact.steps));
const rejectedSteps = steps.map((step) => step.n).filter((step) => !claimed.has(step));
return {
  impacts,
  rejectedSteps,
  diagnostics,
  coverage: {
    claimed: claimed.size,
    total: steps.length,
    complete: impacts.length > 0 && claimed.size === steps.length && rejectedSteps.length === 0,
  },
};
```

Keep raw legacy category counts in diagnostics for rollout observability, but require kept counts to contain only system/component values.

- [ ] **Step 5: Run focused validator tests GREEN**

Run: `node --test test/plan-impact.test.js`

Expected: all validator tests pass with no returned unresolved/support impact.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/plan-impact.js test/plan-impact.test.js
git commit -m "fix: validate total plan placement"
```

---

### Task 4: Retry invalid placement once with constrained choices

**Files:**
- Modify: `src/plan-impact.js`
- Modify: `src/plan-store.js`
- Modify: `test/plan-impact.test.js`
- Modify: `test/plan-store.test.js`

**Interfaces:**
- Produces: `buildPlacementRetryPrompt(context, rejectedSteps, diagnostics)`.
- Preserves: `planImpact(context, steps, { call, deferValidation })`.
- Guarantees: ordinary complete response makes one call; incomplete response makes exactly one retry; invalid retry throws a user-facing placement error.

- [ ] **Step 1: Write failing call-count and retry tests**

```js
test("planImpact retries only rejected steps with valid target choices", async () => {
  const calls = [];
  const responses = [
    { parsed: { impacts: [impact({ targetId: "", files: [], steps: [2] })] }, provider: "p", model: "m" },
    { parsed: { impacts: [impact({ targetId: "api", steps: [2] })] }, provider: "p", model: "m" },
  ];
  const result = await planImpact({ nodes: NODES, edges: EDGES }, [STEPS[1]], {
    call: async (request) => { calls.push(request); return responses.shift(); },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /Valid target choices:/);
  assert.match(calls[1].prompt, /api — API Server/);
  assert.equal(result.outcome, "ready");
  assert.equal(result.impacts[0].targetId, "api");
});

test("planImpact does not retry a complete first response", async () => {
  let calls = 0;
  const result = await planImpact({ nodes: NODES, edges: EDGES }, [STEPS[1]], {
    call: async () => { calls++; return { parsed: { impacts: [impact()] }, provider: "p", model: "m" }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "ready");
});

test("planImpact fails closed after one invalid retry", async () => {
  await assert.rejects(
    planImpact({ nodes: NODES, edges: EDGES }, [STEPS[1]], {
      call: async () => ({ parsed: { impacts: [] }, provider: "p", model: "m" }),
    }),
    (error) => error.userFacing && /could not place every change/i.test(error.message),
  );
});
```

- [ ] **Step 2: Run focused tests and capture RED**

Run: `node --test test/plan-impact.test.js test/plan-store.test.js`

Expected: retry call-count, prompt, and terminal error tests fail.

- [ ] **Step 3: Build the constrained retry prompt**

Append the full map context plus only rejected numbered steps, valid targets, and sanitized diagnostic codes:

```js
export function buildPlacementRetryPrompt(context, steps, diagnostics) {
  const choices = list(context.nodes)
    .map((node) => `${node.id} — ${node.name}${node.parent ? ` (inside ${node.parent})` : ""}`)
    .join("\n");
  const reasons = [...new Set(list(diagnostics?.issues).map((issue) => issue.code))].join(", ");
  return [
    buildImpactPrompt(context, steps),
    "",
    "The previous placement was rejected: " + (reasons || "incomplete coverage") + ".",
    "Valid target choices:", choices || "(none — declare a justified system addition)",
    "Return every listed step as one system or component decision. Do not return support or unresolved.",
  ].join("\n");
}
```

Do not include rejected model text or user content in diagnostics.

- [ ] **Step 4: Implement one retry and trusted merge**

Validate the first response. If incomplete, retain its valid impacts without keys, request only `rejectedSteps`, merge the retry response with retained valid impacts, and validate once more against the complete original step list. Throw a validation/user-facing error when the merged result is incomplete.

For `deferValidation`, preserve the current raw response interface. In the cold provisional reconciliation path, if final-map validation is incomplete, call the normal `planImpact` once against the named final map rather than publishing a partial result. Keep `COLD_IMPACT_CONCURRENCY=false`.

- [ ] **Step 5: Make store completion accept only complete ready results**

In `completeAttempt`, require `result.outcome === 'ready'`, `result.coverage.complete`, at least one impact, and every level in `system/component`. Anything else enters `failAttempt` with the safe placement message. Remove partial publication from both warm and provisional cold paths.

- [ ] **Step 6: Run retry/store tests GREEN**

Run: `node --test test/plan-impact.test.js test/plan-store.test.js`

Expected: normal path calls once, invalid placement calls twice, invalid retry becomes error, and no partial review is published.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/plan-impact.js src/plan-store.js test/plan-impact.test.js test/plan-store.test.js
git commit -m "fix: retry invalid plan placement once"
```

---

### Task 5: Fail closed across browser controls, projection, and brief

**Files:**
- Modify: `app/plan-progress.js`
- Modify: `app/plan-projection.js`
- Modify: `app/app.js`
- Modify: `src/plan-store.js`
- Modify: `src/plan-brief.js`
- Modify: `test/plan-progress.test.js`
- Modify: `test/plan-projection.test.js`
- Modify: `test/plan-hint-motion.test.js`
- Modify: `test/plan-store.test.js`
- Modify: `test/plan-brief.test.js`

**Interfaces:**
- Produces: `completeVisibleReview(review): boolean` in `app/plan-progress.js` for browser controls.
- Enforces independently: `planStore.resolve(...)` accepts only a complete ready review.

- [ ] **Step 1: Write failing approval-safety tests**

Add tests requiring:

```js
test("zero visible decisions can never be approved", () => {
  const review = { status: "ready", steps: [{ n: 1, text: "Add auth" }], impacts: [] };
  assert.equal(completeVisibleReview(review), false);
  assert.equal(planControlState(review).approve, false);
  assert.equal(planControlState(review).retry, true);
  assert.equal(planControlState(review).skip, true);
});

test("complete system and component coverage enables approval", () => {
  const review = {
    status: "ready",
    steps: [{ n: 1, text: "Add store" }, { n: 2, text: "Protect API" }],
    impacts: [
      { key: "impact:1", level: "system", steps: [1] },
      { key: "impact:2", level: "component", steps: [2] },
    ],
  };
  assert.equal(completeVisibleReview(review), true);
  assert.equal(planControlState(review).approve, true);
});
```

Add a store route test proving a forged `ready` review with empty or incomplete impacts cannot resolve. Add brief tests proving legacy support/unresolved inputs are rejected rather than emitted as `SUPPORTING WORK` or `NEEDS REVIEW`.

- [ ] **Step 2: Run UI/store/brief tests and capture RED**

Run: `node --test test/plan-progress.test.js test/plan-projection.test.js test/plan-hint-motion.test.js test/plan-store.test.js test/plan-brief.test.js`

Expected: current partial/empty approval and legacy brief expectations fail.

- [ ] **Step 3: Implement browser completeness and controls**

```js
export function completeVisibleReview(review) {
  if (!review || review.status !== "ready") return false;
  const impacts = list(review.impacts);
  if (!impacts.length) return false;
  if (impacts.some((impact) => !["system", "component"].includes(impact.level))) return false;
  const claimed = new Set(impacts.flatMap((impact) => list(impact.steps)));
  return list(review.steps).length > 0 && claimed.size === list(review.steps).length &&
    list(review.steps).every((step) => claimed.has(step.n));
}
```

`planControlState` exposes Keep/Cut/Approve/navigation only for a complete visible review. Every other completed non-working state exposes Retry/Skip with no Needs Review warning.

- [ ] **Step 4: Remove legacy projection and copy paths**

Make projection visible only for a complete ready review. Remove partial review navigation, partial keyboard handling, Needs Review counts from `renderAsk`, and Needs Review/Project Support copy from the app and README. Error rendering keeps the base graph visible and shows “Plangolin could not place every change on this system map.”

- [ ] **Step 5: Enforce server-side resolution and simplify the brief**

Before resolving, independently require ready status, nonempty impacts, only system/component levels, and exact step coverage. `buildBrief` emits structural and internal sections plus attached cited source details; delete support/unresolved sections and their acceptance behavior.

- [ ] **Step 6: Run focused UI/store/brief tests GREEN**

Run: `node --test test/plan-progress.test.js test/plan-projection.test.js test/plan-hint-motion.test.js test/plan-store.test.js test/plan-brief.test.js`

Expected: all focused tests pass; no empty or incomplete review can approve.

- [ ] **Step 7: Commit Task 5**

```bash
git add app/plan-progress.js app/plan-projection.js app/app.js src/plan-store.js src/plan-brief.js test/plan-progress.test.js test/plan-projection.test.js test/plan-hint-motion.test.js test/plan-store.test.js test/plan-brief.test.js
git commit -m "fix: block incomplete plan approval"
```

---

### Task 6: Lock the Pushpush outcome and release 0.4.2

**Files:**
- Modify: `skills/plangolin/SKILL.md`
- Modify: `scripts/evaluate-plan-impact.js`
- Modify: `test/plan-impact-evaluation.test.js`
- Modify: `test/version.test.js`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`
- Modify: service `README.md`

**Interfaces:**
- Produces: plugin version `0.4.2` in all three manifests.
- Produces: evaluation labels and metrics containing only system/component outcomes plus terminal placement failure.

- [ ] **Step 1: Tighten the agent plan format**

Require one numbered Markdown heading per meaningful decision and explicitly forbid separate preamble, support, alternatives, and order sections in the saved plan:

```markdown
Write 3–8 sections in exactly this shape:

## 1. <change and location>
<connections plus supporting implementation/testing detail>

Every meaningful change must be a numbered section. Do not add an unnumbered
preamble, alternatives section, support section, or repeated order section.
```

- [ ] **Step 2: Add the Pushpush end-to-end fixture test**

Use the Task 1 fixture and a deterministic two-response call stub. Require the final result to include:

- a `system` impact adding `user-store` and connecting `pii-analysis-api -> user-store`;
- a `component` impact targeting `pii-analysis-api` for auth/routes/jobs;
- a `component` impact targeting `privacy-analysis-app` for client auth/session;
- all eight parsed items covered exactly once;
- no support/unresolved impacts; and
- one existing App-to-API map edge retained by projection tests.

- [ ] **Step 3: Update evaluation contracts**

Replace unresolved/support expected classes with:

- `system`;
- `component`;
- `terminal-placement-failure` for deliberately vague or invalid cases.

The offline evaluator remains network-free. Live evaluation still requires the explicit live environment flag and must report retry rate and terminal placement failures without logging plan content.

- [ ] **Step 4: Update release documentation and version tests RED**

Change `test/version.test.js` to require exact `0.4.2`, then run:

`node --test test/version.test.js test/plan-impact-evaluation.test.js`

Expected: version assertion fails before the manifests are updated; evaluation assertions fail until the harness is migrated.

- [ ] **Step 5: Bump all manifests and document the new contract**

Set `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` to `0.4.2`. Update plugin/service README text to describe visible-only placement, one constrained retry, and failure without Approve.

- [ ] **Step 6: Run focused release tests GREEN**

Run: `node --test test/plan-steps.test.js test/plan-impact.test.js test/plan-store.test.js test/plan-progress.test.js test/plan-projection.test.js test/plan-brief.test.js test/plan-impact-evaluation.test.js test/version.test.js`

Expected: all focused plugin tests pass.

- [ ] **Step 7: Run complete verification**

Plugin repository:

```bash
npm test
npm pack --dry-run --json
git diff --check
```

Service repository:

```bash
node --test test/*.test.js
git diff --check
```

Expected: zero test failures, package version `0.4.2`, required runtime/skill files included, and no whitespace errors.

- [ ] **Step 8: Run a local no-network Pushpush projection rehearsal**

Use the real Pushpush `system.json`, the sanitized fixture plan, and a deterministic impact stub. Assert/report:

- four persisted nodes;
- the existing Privacy Analysis App to PII Analysis API edge;
- one proposed User Store node and its API connection;
- nested API and App decisions;
- eight covered items; and
- no unresolved/support/partial/Needs Review output.

Do not send the real Pushpush plan or code-derived data to a hosted service without separate user approval. Do not deploy or push either repository in this task unless the user asks after reviewing the local result.

- [ ] **Step 9: Commit Task 6 in each repository**

Plugin repository:

```bash
git add skills/plangolin/SKILL.md scripts/evaluate-plan-impact.js test/plan-impact-evaluation.test.js test/version.test.js package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json README.md
git commit -m "chore: release total plan placement 0.4.2"
```

Service repository, if its README changed after Task 2:

```bash
git add README.md
git commit -m "docs: describe visible plan placement"
```

---

## Final review gates

- Re-read `docs/superpowers/specs/2026-08-14-total-plan-placement-design.md` and map every acceptance criterion to fresh evidence.
- Verify plugin and service worktrees contain no unrelated staged changes.
- Verify `.superpowers` and local evaluation artifacts remain ignored/untracked as required by repository policy.
- Request independent code review before merging because this changes a hosted schema, client validation, and approval safety.
- Keep hosted deployment, live Pushpush data transmission, merge, and push as explicit user-controlled gates.
