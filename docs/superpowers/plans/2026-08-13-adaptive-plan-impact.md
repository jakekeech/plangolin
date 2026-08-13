# Adaptive Plan Impact Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace structural-or-empty plan review with a complete, nested impact review in which every extracted plan step is visible, while preparing project maps early and exposing truthful progress so reviews feel materially faster.

**Architecture:** Add a backwards-compatible `impact` task to the hosted service, validate and repair its untrusted response in the plugin, and store one accepted-by-default decision per disjoint impact. Refactor cold project adoption into reusable discovery and naming stages so `plangolin prepare` can produce a fingerprinted cache outside the repository and review can share that exact result. The browser renders a transient projection over the persisted graph—structural operations at root, internal/support cards inside the deepest honest component, and generated Needs Review coverage for anything unsafe or missing.

**Tech Stack:** Node.js 20 ESM, `node:test`, dependency-free HTTP server and browser JavaScript, JSON Schema structured model output, Railway-hosted service.

**Spec:** `docs/superpowers/specs/2026-08-13-adaptive-plan-impact-design.md`

## Global Constraints

- Work spans two repositories: plugin `/Users/jakekee/code/plangolin-public` and hosted service `/Users/jakekee/code/launchpad`.
- Preserve `/v1/plan` unchanged until old plugin releases are outside the supported window. New clients call `/v1/impact`; they never silently fall back to `/v1/plan`.
- Every extracted plan step must own exactly one trusted, client-assigned impact key after validation.
- Never turn internal work, support work, files, symbols, or plan sentences into persisted system components.
- Never write transient review nodes or edges through `PUT /api/doc`.
- One impact is one keep/cut decision even when it projects several structural operations.
- Preparation, cold adoption, the browser, and the final brief must share one component identity space.
- Keep the plugin dependency-free. Use Node built-ins for hashes, cache paths, atomic writes, locks, and detached processes.
- Do not log plan text, source excerpts, paths, symbols, or raw model output in service telemetry.
- Use test-first development for every behavior task. Run the smallest named test first, then the full repository suite at checkpoints.
- Preserve unrelated user changes in both worktrees.

---

## Execution Setup

- [ ] In `/Users/jakekee/code/plangolin-public`, confirm the active branch is `codex/adaptive-plan-impact` and the only starting change is this committed plan/spec work.
- [ ] In `/Users/jakekee/code/launchpad`, inspect `git status`, preserve all unrelated untracked/user files, and create or switch to `codex/adaptive-plan-impact` before Task 1.
- [ ] Record the starting commit in each repository so the final reviewer receives exact commit ranges.

---

## Task 1: Add the backwards-compatible hosted `impact` contract

**Repository:** `/Users/jakekee/code/launchpad`

**Files:**

- Modify: `service/tasks.js`
- Create: `test/tasks.test.js`

- [ ] **Step 1: Write a failing task-contract test**

Create `test/tasks.test.js`. Pin both backwards compatibility and the new strict response shape:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKS } from "../service/tasks.js";

test("impact is additive and keeps the released plan task", () => {
  assert.ok(TASKS.plan);
  assert.equal(TASKS.impact.schemaName, "impact");
  assert.equal(TASKS.impact.effort, "high");
});

test("every impact field is required by the hosted schema", () => {
  const item = TASKS.impact.schema.properties.impacts.items;
  assert.deepEqual(item.required, [
    "level", "targetId", "title", "why", "size", "steps", "files", "symbols",
    "additions", "removals", "responsibilities", "connections", "disconnections",
  ]);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.level.enum, ["system", "component", "support", "unresolved"]);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
cd /Users/jakekee/code/launchpad
node --test test/tasks.test.js
```

Expected: failure because `TASKS.impact` is undefined.

- [ ] **Step 3: Add the impact system prompt**

In `service/tasks.js`, add `IMPACT_SYSTEM` beside `PLAN_SYSTEM`. It must state, in explicit priority order:

1. Assign each cited step to one disjoint impact.
2. Use `system` only for additions, removals, responsibility changes, new connections, or removed connections.
3. Use `component` for meaningful work inside the deepest justified component whose responsibility remains true.
4. Use `support` for tests, docs, config, CI, rollout, and sequencing; target a component only when scope is local.
5. Use `unresolved` rather than guessing a target or architecture.
6. Cite only supplied step numbers and supplied component ids or response-local addition ids.
7. Include only file/symbol evidence literally named by the cited plan text.
8. One impact may contain multiple structural operations when they form one user decision.
9. Return all fields; use empty strings/arrays where inapplicable.

Include the full operation shapes from spec section 5 and clarify that component/support/unresolved impacts have no structural operations.

- [ ] **Step 4: Add the strict JSON Schema**

Add `TASKS.impact` without changing `TASKS.plan`:

```js
impact: {
  effort: "high",
  system: IMPACT_SYSTEM,
  schemaName: "impact",
  maxPromptChars: 200_000,
  schema: {
    type: "object",
    properties: {
      impacts: {
        type: "array",
        items: IMPACT_ITEM,
      },
    },
    required: ["impacts"],
    additionalProperties: false,
  },
},
```

Define reusable schema constants for additions, removals, responsibilities, connections, and disconnections. Make every operation field required and set `additionalProperties: false` throughout.
The impact `size` enum is `["", "small", "substantial"]`, because the field is required while unresolved/support work may not have a meaningful size.

- [ ] **Step 5: Run service contract and provider tests**

Run:

```bash
node --test test/tasks.test.js test/provider.test.js
npm test
```

Expected: all pass; the task list now contains both `plan` and `impact`.

- [ ] **Step 6: Commit the service contract**

```bash
git add service/tasks.js test/tasks.test.js
git commit -m "feat: add adaptive plan impact task"
```

---

## Task 2: Add privacy-safe service instrumentation

**Repository:** `/Users/jakekee/code/launchpad`

**Files:**

- Create: `service/task-metrics.js`
- Create: `test/task-metrics.test.js`
- Modify: `service/index.js`

- [ ] **Step 1: Write failing metric-shaping tests**

Create a pure helper so logging can be tested without starting the server:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { taskMetric } from "../service/task-metrics.js";

test("impact metrics contain counts but no user content", () => {
  const metric = taskMetric({
    task: "impact", provider: "openai", model: "m", effort: "high",
    status: 200, durationMs: 1234, promptChars: 99,
    parsed: { impacts: [{ level: "component" }, { level: "unresolved" }] },
  });
  assert.deepEqual(metric.categories, { system: 0, component: 1, support: 0, unresolved: 1 });
  assert.equal(metric.promptChars, 99);
  assert.deepEqual(Object.keys(metric).sort(), [
    "categories", "durationMs", "effort", "model", "promptChars", "provider", "status", "task",
  ]);
});
```

Also test non-impact tasks, malformed parsed values, and error status.

- [ ] **Step 2: Implement `taskMetric`**

Return only:

```js
{
  task, provider, model, effort, status, durationMs, promptChars,
  categories: { system, component, support, unresolved },
}
```

For tasks other than `impact`, omit `categories`. Never accept or spread arbitrary input fields.

- [ ] **Step 3: Time and log each hosted call**

In `service/index.js`, capture `started = performance.now()` immediately before `callModel`. On success and failure, emit one JSON log line produced by `taskMetric`. Pass only prompt length—not prompt text—and the validated task configuration's effort.

Do not remove the existing concise error log until the structured log is verified; replace it in the same commit once tests demonstrate equivalent status visibility.

- [ ] **Step 4: Verify and commit**

```bash
node --test test/task-metrics.test.js
npm test
git add service/task-metrics.js service/index.js test/task-metrics.test.js
git commit -m "feat: record privacy-safe task timings"
```

---

## Task 3: Build the deterministic impact validator and hosted client

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Create: `src/plan-impact.js`
- Create: `test/plan-impact.test.js`
- Modify: `src/llm.js`
- Modify: `test/http.test.js`

- [ ] **Step 1: Write the validator contract tests first**

Create fixtures for existing nodes, directed edges, and numbered steps. Test these cases individually:

- valid system impact with one addition plus one connection stays one impact/key;
- valid responsibility, removal, and disconnection operations;
- valid component impact targeting an existing component;
- component impact targeting an addition returned later in the same response;
- component-scoped and project-wide support;
- valid unresolved impact;
- missing step becomes generated unresolved;
- duplicate step uses precedence `system > component > support > unresolved`, then response order;
- impact left with no owned steps is dropped;
- invalid level/size/target/endpoint/disconnection becomes unresolved;
- non-system structural operations are removed and the cited steps become unresolved;
- system impact with no valid operation becomes unresolved;
- evidence survives only when normalized text occurs in a cited step;
- unsafe paths, unknown symbols, blank titles, oversized strings, and out-of-range step numbers are diagnosed;
- keys are assigned by the client as `impact:1`, `impact:2`, and are stable for identical input;
- raw and kept category/operation counts appear in diagnostics.

The main assertion should pin the public result:

```js
const result = validateImpacts(raw, { nodes, edges, steps });
assert.deepEqual(result.impacts.map(({ key, level, steps }) => ({ key, level, steps })), [
  { key: "impact:1", level: "system", steps: [1] },
  { key: "impact:2", level: "unresolved", steps: [2] },
]);
assert.equal(result.coverage.claimed, steps.length);
```

- [ ] **Step 2: Run the test and confirm the module is missing**

```bash
node --test test/plan-impact.test.js
```

- [ ] **Step 3: Implement normalized prompt context**

In `src/plan-impact.js`, export:

```js
export function buildImpactPrompt({ nodes, edges, groups = [] }, steps) {}
export function validateImpacts(raw, { nodes, edges, steps }) {}
export function remapImpactTargets(raw, idFor) {}
export async function planImpact(context, steps, { call = callTask } = {}) {}
```

The prompt must include component id, name, kind, intent, parent, owned file paths, and directed edges. For provisional cold context, use group refs and include group rationale/dependencies. Number steps from the already extracted `{n,text}` records; never renumber inside this module.

- [ ] **Step 4: Implement ordered validation and coverage repair**

Implement spec section 7 literally as separate small helpers, then compose them in this order:

```js
const additions = validateAllAdditions(rawImpacts);
const knownIds = new Set([...existingIds, ...additions.ids]);
const candidates = validateCandidates(rawImpacts, { knownIds, existingEdges, steps });
const owned = resolveStepConflicts(candidates, LEVEL_RANK);
const repaired = addMissingAsUnresolved(owned, steps);
return assignTrustedKeys(repaired, diagnostics);
```

Do not generate a structural operation during repair. Preserve original plan step text only by reference to `steps`; do not copy it into diagnostics.

- [ ] **Step 5: Implement `planImpact` and service-version errors**

`planImpact` calls `call({ task: "impact", prompt })`, validates `parsed`, and returns:

```js
{
  impacts,
  diagnostics,
  coverage,
  provider,
  model,
  outcome: diagnostics.invalidOperations || impacts.some((i) => i.level === "unresolved")
    ? "partial" : "ready",
}
```

In `src/llm.js`, mark a 404 from `impact` with `error.serviceVersion = true` and the user-facing message “This Plangolin service does not support impact review yet. Retry after it updates, or skip this review.” Do not change other task errors.

- [ ] **Step 6: Add endpoint error tests**

Extend `test/http.test.js` to mock a 404 for `callTask({task:"impact"})` and assert `userFacing` plus `serviceVersion`. Assert it does not call `/v1/plan` afterward.

- [ ] **Step 7: Verify and commit**

```bash
node --test test/plan-impact.test.js test/http.test.js
npm test
git add src/plan-impact.js src/llm.js test/plan-impact.test.js test/http.test.js
git commit -m "feat: validate complete plan impacts"
```

---

## Task 4: Generate the accepted brief from impacts

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `src/plan-brief.js`
- Rewrite: `test/plan-brief.test.js`

- [ ] **Step 1: Replace array-category fixtures with impact fixtures**

Pin the new public signature:

```js
buildBrief({ nodes, steps, impacts, reach, accepted: new Set(["impact:1"]), truncated })
```

Add tests for exact section order:

```text
BUILD
REMOVE
UPDATE RESPONSIBILITY
INTERNAL WORK
SUPPORTING WORK
OUT OF SCOPE
NEEDS REVIEW
DO NOT TOUCH
```

Test one system impact containing an addition and connection is accepted/rejected atomically. Test removal and disconnection wording, internal work grouped by target component, support grouped by component or Project Support, and unresolved instructions. Pin original step citations and truncation warning.

- [ ] **Step 2: Pin the failure safety rule**

Add a test proving `buildBrief` is never called for `status: error`; this belongs primarily in the store test, but add a defensive assertion that `impacts` must be an array and `accepted` a set. Also assert the output never contains “changes nothing structural” or “approved no change to the shape.”

- [ ] **Step 3: Implement impact-based brief sections**

Keep `proposalKey` only if old tests or old `/v1/plan` compatibility still import it; new decisions use trusted `impact.key`. Define:

```js
const kept = impacts.filter((impact) => accepted.has(impact.key));
const cut = impacts.filter((impact) => !accepted.has(impact.key));
```

Compute `DO NOT TOUCH` from accepted system/component targets and accepted structural endpoints. For unresolved work, write an explicit instruction such as “Confirm the intended component before inferring missing scope.”

- [ ] **Step 4: Verify and commit**

```bash
node --test test/plan-brief.test.js
npm test
git add src/plan-brief.js test/plan-brief.test.js
git commit -m "feat: build briefs from nested plan impacts"
```

---

## Task 5: Split adoption into reusable discovery and naming stages

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `src/adopt.js`
- Modify: `test/adopt.test.js`

- [ ] **Step 1: Write orchestration tests around injected stages**

Pin these exports:

```js
export async function discoverProject(ws, { graph, onProgress } = {}) {}
export async function nameProject(discovery, { describe = describeGroups, onProgress } = {}) {}
export function movesFromDiscovery(discovery, described) {}
export async function adopt(ws, options = {}) {}
```

Test that discovery performs the file graph, grouping, fold, excerpts, and dependency calculation once. Test fallback names when naming fails. Test `adopt()` composes the new functions into the same node/edge moves as today.

- [ ] **Step 2: Pin progress events and provisional context**

Assert discovery reports `mapping_project` with file/link counts, then `grouping_components` with group count. Assert its returned serializable data contains:

```js
{
  graph: { files, links, capped },
  groups,
  flatGroups,
  dependencies,
  excerpts,
  dropped,
}
```

Expose a `provisionalImpactContext(discovery)` helper whose nodes use temporary group ids and carry parent, files, rationale, and dependencies. This context must contain no invented final component ids.

- [ ] **Step 3: Refactor without semantic changes**

Move existing code rather than rewriting algorithms:

- `buildFileGraph`, structural clustering, `regroup`, and `fold` belong to discovery;
- `describeGroups` belongs to naming;
- id allocation, nodes, and rolled-up edges belong to `movesFromDiscovery`;
- `adopt` remains the backwards-compatible composition.

Return `idFor` from `movesFromDiscovery` so provisional impact targets can be remapped to the single final naming result.

- [ ] **Step 4: Verify behavior parity and commit**

```bash
node --test test/adopt.test.js test/regroup.test.js test/describe.test.js test/filegraph.test.js
npm test
git add src/adopt.js test/adopt.test.js
git commit -m "refactor: split project discovery from naming"
```

---

## Task 6: Add fingerprinted preparation cache and detached command

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Create: `src/preparation.js`
- Create: `src/prepare-command.js`
- Create: `test/preparation.test.js`
- Create: `test/prepare-command.test.js`
- Modify: `src/filegraph.js`
- Modify: `test/filegraph.test.js`
- Modify: `src/cli.js`

- [ ] **Step 1: Write fingerprint and cache-path tests**

Add `fingerprintGraph(graph)` to `src/filegraph.js`. Test identical sorted graph facts produce the same SHA-256 despite input order, while file/link/name changes change the hash.

In `test/preparation.test.js`, inject a temporary cache root and test that two workspace roots get different hashed directories without exposing the raw root in filenames.

- [ ] **Step 2: Write cache lifecycle tests**

Pin exports:

```js
export function preparationPaths(root, { cacheRoot } = {}) {}
export async function readPreparation(root, fingerprint, options = {}) {}
export async function writePreparation(root, record, options = {}) {}
export async function followPreparation(root, fingerprint, options = {}) {}
export async function runPreparation(root, options = {}) {}
```

Test exact fingerprint hit, fingerprint miss, malformed/partial JSON, atomic rename, live lock following, stale lock replacement, dead PID replacement, progress revision increments, and cleanup after success/failure.

Use an injected `processAlive(pid)` and clock in tests. Production liveness may use `process.kill(pid, 0)` without sending a signal.

- [ ] **Step 3: Implement platform cache location**

Use `PLANGOLIN_CACHE_DIR` when set. Otherwise use:

- macOS: `~/Library/Caches/plangolin`;
- Windows: `%LOCALAPPDATA%/plangolin/Cache` with home fallback;
- Linux: `$XDG_CACHE_HOME/plangolin` or `~/.cache/plangolin`.

Write lock, progress, temporary result, and final result within a SHA-256 workspace directory. `fs.rename` the fully written temporary result into place.

- [ ] **Step 4: Implement shared preparation**

`runPreparation` builds the local graph/fingerprint once, then calls `discoverProject(ws, { graph })` so discovery reuses rather than rebuilds it. It calls `nameProject`, produces moves once, and stores:

```js
{
  version: 1,
  rootHash,
  fingerprint,
  createdAt,
  moves,
  dropped,
  provider,
  model,
}
```

Progress stores only phase, revision, elapsed milliseconds, and numeric counts. It must not store paths/excerpts.

- [ ] **Step 5: Write detached command tests**

The public command returns after the worker owns a lock and writes revision 1. Use a hidden internal mode to run work in the child:

```text
plangolin prepare
plangolin __prepare-worker <absolute-root>
```

Test `prepare` spawns `process.execPath` with `src/cli.js`, `detached: true`, `stdio: "ignore"`, then `unref()`. The parent polls for at most two seconds and returns only after it observes the worker lock plus progress revision 1; a startup failure exits non-zero instead of falsely claiming preparation began. Test an existing live lock returns successfully without spawning a duplicate.

- [ ] **Step 6: Dispatch commands before server startup**

In `src/cli.js`, dispatch `prepare` and `__prepare-worker` beside `review`, before environment loading or port binding. Public output should be one short line such as “Preparing this project’s system map in the background.”

- [ ] **Step 7: Verify and commit**

```bash
node --test test/filegraph.test.js test/preparation.test.js test/prepare-command.test.js
npm test
git add src/filegraph.js src/preparation.js src/prepare-command.js src/cli.js test/filegraph.test.js test/preparation.test.js test/prepare-command.test.js
git commit -m "feat: prepare project maps in the background"
```

---

## Task 7: Rebuild the plan store around phases, outcomes, retry, and shared maps

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Rewrite: `src/plan-store.js`
- Rewrite: `test/plan-store.test.js`

- [ ] **Step 1: Write lifecycle tests before changing the store**

Pin browser state:

```js
{
  id,
  status: "working" | "ready" | "partial" | "error" | "resolved" | "skipped",
  phase: "" | "loading_system_map" | "mapping_project" | "grouping_components" |
    "naming_and_matching" | "matching_plan" | "arranging_review",
  revision,
  elapsedMs,
  counts: { files, links, components, steps },
  steps,
  impacts,
  reach,
  note,
}
```

Test legal phase sequences for warm, prepared, and unprepared paths. Every state mutation must increment `revision`. `phase` must be empty for non-working states.

- [ ] **Step 2: Test outcome truthfulness and coverage**

Add tests proving:

- validated complete response -> `ready`;
- unresolved or invalidated operation -> `partial`;
- call failure/malformed envelope/404 -> `error` with every step displayed as generated Needs Review;
- provider failure can never become `ready`;
- `error` cannot be approved;
- `partial` can be approved;
- skip works from every active state;
- retry from `error` preserves id, plan text, and steps, resets accepted defaults, increments revision, and starts one new analysis;
- stale completion from an earlier retry cannot overwrite the newest attempt.

- [ ] **Step 3: Test warm and prepared orchestration**

For saved nodes, assert exactly one `impact` call and no adoption call. For an empty diagram with a valid cached preparation, assert the cache moves are used for `review.nodes`, `takeScan()`, browser adoption, and the brief. Assert exactly one post-plan impact call.

For a live preparation, assert the store follows progress and does not launch a second adoption.

- [ ] **Step 4: Test cold orchestration with concurrency**

After semantic grouping, start naming and provisional impact matching before awaiting either:

```js
const naming = nameProject(discovery);
const matching = planImpact(provisionalImpactContext(discovery), steps);
const [named, provisional] = await Promise.all([naming, matching]);
```

Then remap temporary group refs through `idFor`, validate once against final nodes/edges, and keep the single final map. Test call depth as `group -> max(name, match)` with deferred promises—not wall-clock sleeps.

Keep this path behind one exported/configured quality gate until Task 12 passes. With the gate off, use honest serial phases; do not claim two-stage latency.

- [ ] **Step 5: Implement the store as a guarded attempt state machine**

Replace `setDelta` with private helpers such as `publish`, `beginAttempt`, `completeAttempt`, and `failAttempt`. Store `attempt` number and compare it before applying asynchronous results.

On total analysis failure, generate unresolved impacts from the input steps for display but set `status: "error"`; do not treat generated display coverage as a successful model response.

- [ ] **Step 6: Preserve scan identity and deterministic resolve**

Keep `takeScan()` behavior: every browser/adoption caller within one review receives the same promise/result. Build the brief only from `review.nodes` and trusted impacts. Accepted ids are impact keys; ignore unknown posted keys.

- [ ] **Step 7: Verify and commit**

```bash
node --test test/plan-store.test.js
npm test
git add src/plan-store.js test/plan-store.test.js
git commit -m "feat: track plan review phases and outcomes"
```

---

## Task 8: Expose retry/progress routes and update review CLI language

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `src/server.js`
- Modify: `test/plan-routes.test.js`
- Modify: `src/review-command.js`
- Modify: `test/review-command.test.js`

- [ ] **Step 1: Write route tests**

Test:

- `GET /api/plan` returns the new state without raw plan/model diagnostics;
- `POST /api/plan/retry` invokes `plans.retry(id, ws)` and returns 409 when not retryable;
- `POST /api/plan/resolve` rejects approval during `working` or `error`, allows skip, and allows `ready`/`partial` approval;
- `POST /api/adopt` still shares `takeScan()`;
- progress revisions are visible in successive responses.

- [ ] **Step 2: Implement the retry route**

Add:

```js
if (url.pathname === "/api/plan/retry" && req.method === "POST") {
  const { id } = await readBody(req);
  const ok = plans.retry(id, ws);
  return json(res, ok ? 202 : 409, { ok });
}
```

The store owns retry rules; the route must not mutate status itself.

- [ ] **Step 3: Replace workflow copy**

In `src/review-command.js`, replace “Reading it against your sheet” with “Preparing the plan against your system map.” Update comments that refer to user-facing sheet language where useful, while retaining internal persisted-diagram terminology if it describes code rather than copy.

- [ ] **Step 4: Verify and commit**

```bash
node --test test/plan-routes.test.js test/review-command.test.js
npm test
git add src/server.js src/review-command.js test/plan-routes.test.js test/review-command.test.js
git commit -m "feat: expose review progress and retry"
```

---

## Task 9: Render a transient nested impact projection in the browser

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `app/app.js`
- Create: `app/plan-projection.js`
- Modify: `app/index.html`
- Modify: `app/style.css`
- Create: `test/plan-projection.test.js`
- Modify: `test/plan-hint-motion.test.js`

- [ ] **Step 1: Extract pure projection logic into a browser-testable module**

Create `app/plan-projection.js` as an ESM module imported by `app/app.js` and directly by Node tests. Export pure helpers:

```js
function buildPlanProjection(review, nodes, edges) {}
function temporaryChildren(projection, parentId) {}
function recursiveImpactCounts(projection, nodes) {}
function planViewNodes(viewRoot, persistedNodes, projection) {}
```

`buildPlanProjection` returns namespaced ids such as `plan:<reviewId>:<impactKey>` and temporary root groups. It must never mutate `S.nodes`, `S.edges`, or `review.impacts`.

- [ ] **Step 2: Write projection unit tests**

Test:

- system additions and proposed connections render at root;
- removal/responsibility/disconnection annotations target persisted items;
- component and component-scoped support cards appear only inside their target;
- badges propagate from deepest target through persisted/proposed ancestors;
- Project Support and Needs Review exist only when populated;
- proposed additions can contain component changes;
- graph stops after one temporary card layer;
- projection ids cannot collide across reviews;
- serializing the persisted document before and after projection is byte-identical.

- [ ] **Step 3: Generalize current ghost rendering**

Replace reads of `plan.delta.additions/touches/connections` with the projection. Keep the established graph layout path and ghost-position machinery; do not introduce a second layout algorithm. One impact with several operations must share one selected/kept/cut state.

Render structural styles:

- proposed node/edge: existing dashed ghost treatment;
- removal: distinct struck/faded plan-removal treatment;
- responsibility change: existing node plus plan badge/outline;
- disconnection: existing edge plus removal overlay.

- [ ] **Step 4: Extend navigation without persisting temporary nodes**

Update `currentLevelNodes`, `enterNode`, `goToView`, breadcrumbs, and the manual double-click handler so a target is enterable when it has either persisted children or temporary children. Proposed additions and temporary root groups are enterable. Temporary change cards are selectable but not enterable, draggable into persisted layout, groupable, wireable, or saveable.

Use the existing `viewRoot` navigation model; do not add a separate modal hierarchy.

- [ ] **Step 5: Render change cards and evidence detail**

Inside a target, render dashed cards labelled `internal change` or `supporting change`. Selecting a card shows its title, why, cited plan text, literal file evidence, and literal symbol evidence in the plan panel. Files and symbols remain text rows, not nodes.

- [ ] **Step 6: Preserve one decision across all views**

Replace old `planKey(kind,...)` state with `impact.key`. Keep accepted-by-default semantics. Toggling keep/cut from the stepper, a structural ghost, an existing node annotation, or a nested card updates the same set and survives navigation.

- [ ] **Step 7: Add keyboard and accessibility behavior**

Temporary enterable groups/nodes receive the same Enter/double-click behavior as persisted containers. Change cards receive focus, selected state, and keep/cut controls. They have no ports. Pin the behavior in the existing DOM-source or browser test style.

- [ ] **Step 8: Verify projection and rendering tests**

```bash
node --test test/plan-projection.test.js test/plan-hint-motion.test.js
npm test
git add app/app.js app/plan-projection.js app/index.html app/style.css test/plan-projection.test.js test/plan-hint-motion.test.js
git commit -m "feat: show nested transient plan impacts"
```

---

## Task 10: Replace the spinner/no-change UI with truthful progress and outcomes

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `app/app.js`
- Create: `app/plan-progress.js`
- Modify: `app/index.html`
- Modify: `app/style.css`
- Create: `test/plan-progress.test.js`

- [ ] **Step 1: Write pure copy/state tests**

Create `app/plan-progress.js`, import it from `app/app.js`, and test these pure exports directly:

```js
function planProgressCopy(review) {}
function planSummary(review, projection, nodes) {}
function planPollDelay(review) {}
```

Expected loading copy:

- `mapping_project`: “Mapping your project — 84 files found”;
- `grouping_components`: “Grouping those files into components”;
- `naming_and_matching`: “Naming 8 components and matching 12 plan steps”;
- `loading_system_map`: “Loading your system map”;
- `matching_plan`: “Matching 12 plan steps to your system map”;
- `arranging_review`: “Arranging the review”.

Assert no output contains “sheet”, “node”, or “This plan changes nothing structural.”

- [ ] **Step 2: Pin useful summaries**

For internal-only work, assert a result like “7 plan steps reviewed. Work affects API Server and Test Suite. The system shape stays the same.” Structural plans lead with additions/removals/connections. Partial plans call out Needs Review. Error plans explain the safe provider/service error and do not claim analysis coverage.

- [ ] **Step 3: Implement adaptive polling**

Replace the fixed two-second `setInterval` with a self-scheduling timeout:

```js
async function pollPlanLoop() {
  await pollPlan();
  planPollTimer = setTimeout(pollPlanLoop, planPollDelay(plan));
}
```

Use 500 ms while status is `working`, `ready`, `partial`, or `error`; retain a slower two-second idle poll when no review is active. Include `revision` in the render stamp so phase/count changes repaint.

- [ ] **Step 4: Add Retry and safe approval controls**

Show Retry and Skip for `error`; disable/hide Approve. Show Keep/Cut/Approve for `ready` and `partial`, with Needs Review warning for partial. Retry posts to `/api/plan/retry` and immediately republishes working UI without discarding the plan.

- [ ] **Step 5: Verify and commit**

```bash
node --test test/plan-progress.test.js test/plan-projection.test.js test/plan-routes.test.js
npm test
git add app/app.js app/plan-progress.js app/index.html app/style.css test/plan-progress.test.js
git commit -m "feat: show truthful plan review progress"
```

---

## Task 11: Start preparation from the Plangolin skill

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Modify: `skills/plangolin/SKILL.md`
- Modify: `test/version.test.js` or create `test/skill.test.js`

- [ ] **Step 1: Pin command order in a skill text test**

Read the skill file and assert `plangolin prepare` appears after request validation but before “Read the code” / planning instructions and before `plangolin review`. Also assert user-facing workflow copy says system map/diagram rather than sheet.

- [ ] **Step 2: Update the skill workflow**

After step 0 and before code reading, add:

```bash
plangolin prepare
```

Explain that it starts project-map preparation and returns immediately; the agent must continue planning rather than waiting. Add the plugin-root fallback command. Keep review blocking behavior unchanged.

Update the final brief section names to BUILD, REMOVE, UPDATE RESPONSIBILITY, INTERNAL WORK, SUPPORTING WORK, OUT OF SCOPE, NEEDS REVIEW, and DO NOT TOUCH.

- [ ] **Step 3: Verify and commit**

```bash
node --test test/skill.test.js
npm test
git add skills/plangolin/SKILL.md test/skill.test.js
git commit -m "feat: prepare plan reviews while planning"
```

---

## Task 12: Build and run the quality/performance evaluation gate

**Repository:** `/Users/jakekee/code/plangolin-public`

**Files:**

- Create: `evaluation/plan-impact/cases.json`
- Create: `evaluation/plan-impact/README.md`
- Create: `scripts/evaluate-plan-impact.js`
- Create: `test/plan-impact-evaluation.test.js`
- Modify: `src/plan-store.js` only if the gate passes

- [ ] **Step 1: Version the fixed semantic corpus**

Add cases for every scenario in spec section 15.4. Each case includes sanitized component context, plan steps, and expected predicates—not one exact prose response. Example predicates:

```json
{
  "id": "small-internal-change",
  "expected": {
    "levels": ["component"],
    "allStepsCovered": true,
    "falseStructuralOperations": 0,
    "allowedTargets": ["authentication"]
  }
}
```

Do not include proprietary source excerpts or secrets.

- [ ] **Step 2: Add deterministic evaluator unit tests**

Test scoring of coverage, false structural additions, false no-architecture conclusions, invalid operation counts, repeat agreement, and target/category accuracy using fixture responses. These unit tests never call the network.

- [ ] **Step 3: Add opt-in live evaluation**

`scripts/evaluate-plan-impact.js` should require `PLANGOLIN_EVAL_LIVE=1` before model calls. Run each case against:

1. current fully named context;
2. provisional group context;
3. high effort;
4. medium effort.

Write only aggregate metrics and sanitized case ids to stdout. Do not write model output into git.

- [ ] **Step 4: Apply the cold-path gate**

Enable provisional concurrent matching by default only if it has:

- 100% client-side step coverage after repair;
- no increase in false structural operations;
- no increase in false no-architecture conclusions;
- target/category accuracy within the agreed tolerance of the fully named baseline; and
- stable repeated outcomes on the fixed corpus.

If it fails, leave cold matching serial and document the measured gap in `evaluation/plan-impact/README.md`. The prepared and warm one-call paths still ship.

- [ ] **Step 5: Verify call-depth instrumentation**

Use fake deferred stages to assert prepared/warm paths perform one post-plan hosted call. Assert enabled cold concurrency has two sequential hosted stages. Assert progress publication occurs immediately and revisions can be observed within the 500 ms poll cadence; do not use fragile real-time sleeps in unit tests.

- [ ] **Step 6: Commit the evaluation harness**

```bash
node --test test/plan-impact-evaluation.test.js
npm test
git add evaluation/plan-impact scripts/evaluate-plan-impact.js test/plan-impact-evaluation.test.js src/plan-store.js
git commit -m "test: gate provisional plan matching quality"
```

---

## Task 13: Release compatibility, versioning, and end-to-end verification

**Repositories:** both

**Plugin files:**

- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `test/version.test.js`
- Modify: `README.md` only if current plan-review instructions are now inaccurate

**Service files:**

- Modify: `README.md` only if task/deploy documentation needs the new endpoint or metrics

- [ ] **Step 1: Deploy the additive service change before releasing the client**

From `/Users/jakekee/code/launchpad`, run the full suite, push/deploy through the repository's documented Railway workflow, then verify:

```bash
curl -s https://plangolin-production.up.railway.app/health
```

Expected: HTTP 200 and `tasks` includes both `plan` and `impact`. Also send sanitized local fixture prompts to `/v1/plan` and `/v1/impact` and verify both return their documented envelopes. Do not release the client until this passes.

- [ ] **Step 2: Bump every plugin version together**

Change `0.3.5` to `0.4.0` in exactly:

- `package.json`;
- `.claude-plugin/plugin.json`;
- `.claude-plugin/marketplace.json`.

Extend `test/version.test.js` to assert all three equal `0.4.0` and equal each other.

- [ ] **Step 3: Run complete automated verification**

```bash
cd /Users/jakekee/code/launchpad
npm test

cd /Users/jakekee/code/plangolin-public
npm test
npm pack --dry-run
```

Expected: both suites pass; package dry-run includes `src/preparation.js`, `src/prepare-command.js`, `src/plan-impact.js`, browser assets, and the skill.

- [ ] **Step 4: Perform the end-to-end browser matrix**

Use temporary fixture repositories, never the product repository itself:

1. prepared empty diagram + internal-only plan;
2. warm saved diagram + structural plan;
3. unprepared empty diagram + support-only plan;
4. malformed/failed hosted response;
5. hand-edited nested diagram + deepest-component internal change.

For each, verify phase copy, counts, root badges, double-click nesting, decision persistence, Retry/Skip/Approve rules, brief sections, and that `plangolin/system.json` contains no transient review ids.

- [ ] **Step 5: Verify performance structure from diagnostics**

Record aggregate timings/call counts for the matrix without user content. Confirm:

- prepared: one post-plan hosted call;
- warm: one hosted call;
- cold: at most the enabled/gated call depth;
- phase appears within one second;
- backend-ready completion becomes browser-visible within 750 ms under normal local conditions.

- [ ] **Step 6: Run a final unsafe-language and persistence audit**

```bash
rg -n "This plan changes nothing structural|Reading it against your sheet|against your sheet" app src skills test
rg -n "plan:" plangolin/system.json 2>/dev/null
```

Expected: no obsolete user-facing result/loading copy and no transient ids in saved fixture documents. Internal comments may use “sheet” only when they specifically describe persisted diagram mechanics.

- [ ] **Step 7: Commit the plugin release metadata**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json test/version.test.js README.md
git commit -m "chore: release adaptive plan impact review 0.4.0"
```

- [ ] **Step 8: Request code review before merging**

Use `superpowers:requesting-code-review`. Give Claude/reviewer the spec, this plan, both repository commit ranges, test outputs, live endpoint verification, corpus aggregates, and the explicit cold-path quality-gate decision. Resolve review findings with `superpowers:receiving-code-review`, rerun both full suites, then use `superpowers:finishing-a-development-branch` for integration.

---

## Final Acceptance Checklist

- [ ] Every extracted step appears exactly once as system, component, support, or unresolved.
- [ ] Internal-only and support-only plans produce useful, navigable reviews rather than an empty structural result.
- [ ] Structural operations belonging to one impact share one keep/cut decision.
- [ ] Deep internal targets bubble badges through every ancestor and open through existing double-click navigation.
- [ ] Project Support and Needs Review appear only when populated and never persist.
- [ ] Complete analysis failure shows raw steps under Needs Review, disables Approve, and offers Retry/Skip.
- [ ] Prepared and warm reviews make one post-plan hosted call.
- [ ] Cold parallel matching is enabled only if the fixed quality gate passes.
- [ ] Progress phases, revisions, counts, and latency diagnostics are observable without user-content logging.
- [ ] `/v1/plan` remains available while `/v1/impact` is deployed and verified first.
- [ ] All three plugin version fields are `0.4.0`.
- [ ] Both repository test suites, package dry-run, browser matrix, and reviewer checks pass.
