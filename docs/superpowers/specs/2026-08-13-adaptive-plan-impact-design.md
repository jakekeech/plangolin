# Adaptive plan impact review

**Date:** 2026-08-13

**Status:** approved direction; implementation not started

**Document type:** architecture explanation and implementation reference

**Audience:** Plangolin maintainers and code reviewers

## 1. Purpose

Plangolin currently asks one question of a plan: what changes about the shape
of the system? That produces a useful short list when a plan adds a component,
changes a component's responsibility, or adds a connection. It produces an
empty-looking review when the work stays inside existing components.

The empty result is not trustworthy enough to show as a conclusion. Today it
can mean any of the following:

- the plan genuinely leaves the architecture unchanged;
- the plan contains meaningful internal work that does not invalidate a
  component's one-line description;
- the model omitted a step;
- validation rejected every structural proposal; or
- the hosted model call failed and the fallback put every step in `unplaced`.

Cold reviews also perform model-backed project grouping, component naming,
and plan analysis in sequence. The browser shows one static loading sentence
throughout that work.

This design replaces the structural-or-nothing review with an adaptive impact
review. It shows each extracted plan step at the highest useful abstraction
while keeping the actual placement at the most specific honest location. It
also shortens the critical loading path and exposes real progress.

## 2. Goals

1. Every extracted plan step is visible in the review.
2. Architectural claims remain conservative: internal work must not become an
   invented component or connection merely to fill the diagram.
3. Structural changes appear on the system level.
4. Internal changes appear inside the affected existing or proposed component.
5. Supporting work appears inside a relevant component or in a temporary
   Project Support group.
6. Anything that cannot be placed safely appears under Needs Review.
7. A complete or partial analysis failure is never presented as a successful
   no-change result.
8. A prepared review requires only the plan-impact model call after the plan is
   available.
9. An unprepared cold review has no more than two sequential model stages:
   grouping, then component naming and plan matching in parallel.
10. The UI explains what is happening using product language rather than
    internal terms such as “sheet” or “node.”

## 3. Non-goals

- Persisting planned changes into `system.json`.
- Turning files, functions, tests, or plan sentences into permanent system
  components.
- Generating an unlimited recursive plan hierarchy.
- Changing the graph layout algorithm.
- Guaranteeing discovery of work the written plan does not mention.
- Guaranteeing that one coarse plan bullet containing several independent
  changes will be split perfectly. The coverage guarantee applies to the
  extracted steps produced by `plan-steps.js`.
- Selecting a lower reasoning effort before a representative evaluation shows
  that quality is not reduced.

## 4. Product invariants

### 4.1 Coverage

Every extracted plan step must belong to exactly one reviewable impact:

- `system`: a structural addition, removal, responsibility change, connection,
  or disconnection;
- `component`: work inside an existing or proposed component;
- `support`: tests, documentation, configuration, rollout, or other supporting
  work; or
- `unresolved`: Plangolin could not place the step safely.

One impact may produce several structural operations. For example, “add rate
limiting” may add a Limiter component and connect the API to it while remaining
one keep-or-cut decision. This avoids assigning the same step to several
independently rejectable proposals.

After validation, the client constructs the coverage set itself. A missing,
duplicated, or invalid placement is repaired deterministically by placing the
affected step under Needs Review. The model is never trusted to claim complete
coverage.

### 4.2 Highest useful abstraction

“Highest level” does not mean attaching every change to the broadest ancestor.
It means:

- show structural impact at the system level;
- store internal impact on the most specific existing component supported by
  the plan and component ownership data; and
- propagate a change count through that component's ancestors so the impact is
  visible from the system level.

For example, a token-expiry change belongs to Authentication, not Backend. The
top-level Backend node may say “1 planned change,” but entering Backend and
then API Server reveals where the change actually lives.

### 4.3 No invented architecture

Only additions, removals, responsibility changes, connections, and
disconnections may alter the system-level projection. Internal and supporting
changes are temporary review items with visually distinct plan styling. They
never claim that a new architectural component will exist after implementation.

### 4.4 One graph, one identity space

The plan must be evaluated against the same project map displayed in the
browser and used to generate the accepted brief. Project preparation, review,
and browser adoption must share one result. A second scan cannot replace it
mid-review.

### 4.5 No persistence

All plan additions, internal changes, support groups, unresolved groups, and
badges are transient. Approving a review produces a brief; it does not write
planned graph content into `system.json`.

## 5. Impact model

The hosted service receives the current project map and numbered plan steps.
It returns a list of disjoint impacts rather than independent category arrays.
Each impact owns one or more plan steps and therefore one review decision.

The service supplies these fields for every impact:

- a level: `system`, `component`, `support`, or `unresolved`;
- a short action-oriented title and explanation;
- `small`, `substantial`, or empty size;
- one or more unique plan step numbers;
- a target component id or an empty target;
- explicit file and symbol evidence when the plan names it; and
- zero or more structural operations.

### 5.1 System impacts

A system impact contains one or more structural operations:

- `additions`: components that do not exist today and would be drawn after the
  plan lands;
- `removals`: existing components that the plan explicitly removes;
- `responsibilities`: existing components whose one-line responsibility
  becomes false or incomplete; and
- `connections`: system-level relationships that do not exist today; and
- `disconnections`: existing relationships that the plan explicitly removes.

An impact may contain several operations when they form one user decision.
Both endpoints of a connection must be existing components or additions in the
same complete response.

The structural operation shapes are:

- addition: `{ id, name, kind, intent, dir, files }`;
- removal: `{ id }`;
- responsibility: `{ id, intent, why }`, where `intent` is the proposed
  replacement one-line responsibility;
- connection: `{ from, to, label }`; and
- disconnection: `{ from, to }` matching an existing directed edge.

### 5.2 Component impacts

A component impact is meaningful work inside an existing or proposed component
whose architectural responsibility remains valid. It has a target component
and no structural operations.

Crossing it out removes all of its owned plan steps from the accepted brief
without rejecting the component that contains it.

### 5.3 Supporting impacts

Supporting work includes test harness changes, documentation, CI, migrations,
release configuration, and sequencing. It has no structural operations.

A support impact may target a component when its scope is local, such as API
tests. Otherwise its target is empty and the browser places it in the temporary
Project Support group.

### 5.4 Unresolved impacts

An unresolved impact contains steps whose target or meaning cannot be
established safely. It has no target and no structural operations. Unresolved
is a first-class result, not a synonym for supporting work. It includes:

- steps omitted by the model;
- duplicated or invalid placements;
- impacts invalidated by structural validation;
- targets that do not exist in the reviewed graph; and
- every step when the model call fails completely.

The UI labels these items Needs Review and preserves their original plan text.

## 6. Service contract

The existing `/v1/plan` task remains unchanged for released clients. A new
`/v1/impact` task is deployed alongside it. The letters-only task name works
with the service's existing route parser and does not widen its accepted URL
surface.

The conceptual response is:

```json
{
  "impacts": [
    {
      "level": "system",
      "targetId": "",
      "title": "Add request rate limiting",
      "why": "introduces a new request-control component",
      "size": "substantial",
      "steps": [1, 2],
      "files": [],
      "symbols": [],
      "additions": [
        {
          "id": "rate-limiter",
          "name": "Rate Limiter",
          "kind": "Redis",
          "intent": "Limits repeated requests before they reach the API.",
          "dir": "src/rate-limit",
          "files": []
        }
      ],
      "removals": [],
      "responsibilities": [],
      "connections": [
        { "from": "api", "to": "rate-limiter", "label": "checks limits" }
      ],
      "disconnections": []
    }
  ]
}
```

All fields shown on an impact are required by the structured-output schema;
inapplicable strings and arrays are empty. Component, support, and unresolved
impacts must return empty structural arrays. Evidence files and symbols may
include only values explicitly present in the plan. The client validates all
paths, ids, step numbers, lengths, endpoint membership, level rules, and step
overlap. Evidence is retained only when its normalized text occurs in one of
the impact's cited plan steps.

After validation, the client assigns review-local keys in preserved response
order. The model does not choose browser or brief identities. Generated
unresolved impacts receive keys from the same allocator, so every decision key
comes from one trusted implementation.

The service does not return a success flag or a confidence percentage. The
client derives `ready`, `partial`, or `error` from validated coverage and call
provenance. A self-reported model confidence would not distinguish malformed
output from a complete result reliably enough to control the UI.

## 7. Deterministic validation and coverage

Validation proceeds in this order:

1. Validate impact levels, sizes, evidence, and in-range step numbers.
2. Validate all structural additions and build the complete set of proposed
   component ids before checking any connection.
3. Validate removal and responsibility targets against existing components,
   new connection endpoints against existing or proposed components, and
   disconnections against existing edges.
4. Require at least one valid structural operation for a system impact and no
   structural operations for every other level.
5. Validate component targets against existing and proposed components.
6. Validate support targets when present; an empty target means project-wide
   support.
7. Convert an impact with an invalid level, target, or required operation into
   an unresolved impact containing its still-unclaimed valid steps.
8. When several otherwise valid impacts cite the same step, assign it to the
   highest valid level using `system`, `component`, `support`, then `unresolved`
   precedence; preserve response order to break ties. Remove the citation from
   the others and record the conflict.
9. Put every unclaimed input step into a generated unresolved impact with a
   diagnostic reason.
10. Drop any impact left with no owned steps and record why.
11. Record raw-versus-kept counts for diagnostics and evaluation.

One system impact can project several graph operations, but it remains one
decision. Rejecting it removes all of those projections together. The UI cannot
show contradictory acceptance for a new component and a connection belonging
to the same impact.

Validation returns diagnostics separately from user-facing impact. A dropped
proposal cannot silently turn into a confident no-architecture-change result.

## 8. Transient graph projection

The browser builds a review projection by combining the persisted diagram with
temporary plan items. Temporary ids are namespaced by review id and never pass
through the document save path.

### 8.1 Main system level

The main level shows:

- existing structural nodes;
- ghost nodes for proposed additions;
- removal styling on existing nodes that the plan deletes;
- dashed proposed connections;
- removal styling on existing connections that the plan deletes;
- responsibility-change styling on existing components; and
- recursive “N planned changes” badges on affected components.

Internal details do not clutter this level.

### 8.2 Entering a component

The existing double-click navigation is reused. Entering a component shows its
real children plus temporary internal and component-scoped support changes.

If the affected component has no real children, entering it still opens a
level containing its temporary changes. Proposed structural components can be
entered in the same way.

Temporary change cards use dashed plan styling, have no connection ports, and
are labelled `internal change` or `supporting change`. They do not resemble
ordinary persisted components.

### 8.3 Existing nested structures

An internal change attaches to the deepest existing node justified by explicit
file ownership and plan language. Its badge propagates to every visible
ancestor. Existing children remain unchanged and visible.

### 8.4 Project Support and Needs Review

Project Support and Needs Review are temporary review groups at the root. They
appear only when they contain items and are visually distinguished from system
components. Entering either group shows its reviewable change cards.

They are placement devices for the review, not proposed architecture.

### 8.5 Detail boundary

The graph stops after one temporary change-card layer. Selecting a change shows
its cited plan steps, files, and symbols in the review panel. Files and symbols
do not become further graph nodes.

## 9. Review interaction

Every impact is accepted by default, matching the current review. Users may
keep or cut it from either the stepper or the nested change card.

The same proposal key must identify an item in the browser and brief builder.
Changing levels or entering and leaving a component must not reset decisions.

The summary never says “This plan changes nothing structural.” Instead it
reports useful coverage, for example:

> 7 plan steps reviewed. Work affects API Server and Test Suite. The system
> shape stays the same.

When structural changes exist, the summary leads with those and then names the
components containing internal work. “The system shape stays the same” may be
secondary context, never the result headline.

## 10. Generated brief

The accepted brief remains deterministic and is generated from validated user
decisions. It gains these sections:

- `BUILD`: accepted structural additions and new connections;
- `REMOVE`: accepted component removals and disconnections;
- `UPDATE RESPONSIBILITY`: accepted changes to existing component roles;
- `INTERNAL WORK`: accepted internal changes grouped by component;
- `SUPPORTING WORK`: accepted support changes grouped by component or project;
- `OUT OF SCOPE`: every rejected impact with its original steps;
- `NEEDS REVIEW`: accepted unresolved steps, with an instruction not to infer
  missing scope silently; and
- `DO NOT TOUCH`: unaffected existing components, preserving current behavior.

If a complete analysis failure leaves every step unresolved, Approve is not
available. The user may Retry or Skip. A partial result remains reviewable;
kept unresolved steps are called out explicitly in the brief.

## 11. Loading architecture

### 11.1 Observable phases

The plan store replaces the single `thinking` state with separate status and
phase fields. Status is one of `working`, `ready`, `partial`, `error`,
`resolved`, or `skipped`. While status is `working`, phase is one of:

```text
loading_system_map
→ matching_plan

or, on an unprepared project:

mapping_project
→ grouping_components
→ naming_and_matching
→ arranging_review
```

Phase becomes empty after work finishes; status carries the outcome. Existing
resolved and skipped lifecycle behavior is preserved.

The browser receives phase, discovered counts, elapsed time, and a monotonically
increasing revision. Suggested copy is:

- “Mapping your project — 84 files found”
- “Grouping those files into components”
- “Naming 8 components and matching 12 plan steps”
- “Arranging the review”

All user-facing occurrences of “sheet” in this workflow become “system
diagram” or “system map.”

While a review is active, the browser polls adaptively at 500 ms and includes
the revision in its change stamp. It returns to the existing slower polling
interval when no review is active. This retains the dependency-free local
server and removes up to 1.5 seconds from completion visibility.

### 11.2 Prepared path

The Plangolin skill starts project-map preparation immediately after receiving
the user's request, before it reads the code and writes the plan. A new
`plangolin prepare` command starts a detached worker and returns once the worker
has a lock and progress record, allowing the agent to continue planning.
Preparation stores its result in a workspace-keyed local cache outside the
repository.

The cache contains the complete validated adoption result and a source-graph
fingerprint. `review` recomputes the cheap local fingerprint and uses the cache
only on an exact match. A lock prevents duplicate preparations, and results are
written atomically so an interrupted process cannot look complete.

The worker publishes phase and discovered counts to an atomic progress record.
If `review` finds a live matching preparation, it follows that progress and
waits for the shared result instead of starting a second scan. A lock whose
process no longer exists or whose update age exceeds the preparation timeout is
treated as stale and replaced safely.

When preparation finishes before the plan is saved, the visible review path is:

```text
load prepared map → match plan → arrange review
```

Only one hosted model call occurs after the plan is available.

### 11.3 Unprepared cold path

When no valid prepared map exists:

1. Build the local file/import graph.
2. Run semantic grouping.
3. Give the same semantic groups, temporary group references, file ownership,
   rationale, and dependencies to both component naming and plan matching.
4. Run naming and matching concurrently.
5. Reconcile temporary group references with the final component ids from the
   single naming result.
6. Persist only the adopted project map; retain plan impacts as transient.

The critical model-call depth becomes:

```text
group → max(name, match)
```

Plan-matching quality against provisional group context must be compared with
the current fully named prompt before this path ships. If it fails the quality
gate, the prepared path still ships, while the unprepared path remains serial
and exposes honest phases.

### 11.4 Warm path

A project with a saved diagram loads that graph and performs one plan-impact
call. No adoption or preparation work is repeated.

## 12. Failure behavior

Outcome is separate from phase:

- `ready`: the model call succeeded, every step has a validated non-unresolved
  placement, and no operation was invalidated;
- `partial`: the model call succeeded, but at least one step is unresolved or
  one operation was invalidated, including a valid response that places every
  step under Needs Review; or
- `error`: no trustworthy model response was available because the call or
  response envelope failed.

Provider timeouts, rate limits, refusals, malformed JSON, unknown service tasks,
and network errors produce `error`, never `ready` with empty structural lists.
The browser displays the raw plan steps under Needs Review, the specific safe
error message, and Retry and Skip actions.

A failed preparation does not fail the review. The review falls back to the
unprepared path and says what stage it is performing.

## 13. Instrumentation and evaluation

The client records phase durations for local diagnostics:

- graph load;
- local file/import scan;
- semantic grouping call;
- naming call;
- plan-impact call;
- validation;
- arrangement; and
- backend-ready to browser-visible delay.

The service records task, provider, model, reasoning effort, status, duration,
prompt character count, and output category counts. It must not log plan text,
source excerpts, file paths, or model output.

Initial performance acceptance is structural rather than an invented seconds
target:

- prepared review: one post-plan hosted call;
- warm review: one hosted call;
- unprepared cold review: at most two sequential hosted stages;
- phase changes visible within 750 ms under normal local conditions; and
- meaningful local progress visible within one second of opening the review.

After a representative sample exists, p50 and p95 targets are set from the
measured baseline. Medium and high plan reasoning are compared on the same
corpus before changing the default.

Quality metrics include:

- percentage of steps placed without generated unresolved fallback;
- false structural additions;
- false no-architecture conclusions;
- raw proposals dropped by validation;
- repeat-run agreement; and
- placement accuracy by impact category in the labeled evaluation corpus.

## 14. Compatibility and release sequence

This feature spans the hosted service and the plugin client. Rollout order is:

1. Add `/v1/impact` to the service while retaining `/v1/plan`.
2. Deploy and verify both tasks through service health and contract tests.
3. Release the plugin using the new endpoint and result schema.
4. Bump the plugin/package version from `0.3.5` to `0.4.0` because the plan
   review contract and interaction change materially.
5. Update every manifest and marketplace version field together.
6. Keep `/v1/plan` until released clients depending on it are outside the
   supported window.

The new client must treat a 404 from `/v1/impact` as a service-version
error with Retry/Skip, not silently fall back to the old semantic-empty path.

## 15. Testing strategy

### 15.1 Unit tests

- Validate each impact category and every unsafe id, path, endpoint, and step.
- Prove every missing or conflicting placement becomes unresolved.
- Prove a provider failure cannot produce `ready`.
- Prove unique step counts do not inflate when structural evidence overlaps.
- Prove deterministic brief sections and rejection behavior.
- Prove source fingerprints accept current preparation and reject stale data.

### 15.2 Store and route tests

- Exercise every phase and outcome transition.
- Prove revisions change when progress changes.
- Prove one preparation result is shared by review and adoption.
- Prove Retry starts a fresh call without losing the review text.
- Prove Skip works during preparation, analysis, partial results, and errors.

### 15.3 Browser tests

- Render recursive badges on affected ancestors.
- Enter existing and proposed components containing temporary changes.
- Preserve decisions while navigating between levels.
- Render Project Support and Needs Review only when populated.
- Prove transient nodes never enter the save payload.
- Prove all loading and result copy avoids “sheet” and false no-change claims.
- Prove keyboard navigation offers the same enter, keep, and cut operations.

### 15.4 Integration and evaluation corpus

The fixed corpus must include:

- a new component and connection;
- a responsibility-changing edit;
- an internal-only refactor;
- a one-line small internal change;
- tests and documentation only;
- component-scoped and project-wide support work;
- a plan step naming an existing file;
- a vague step that must become unresolved;
- an empty or unreadable project;
- a large capped project;
- an existing hand-edited nested diagram;
- malformed model output;
- every invalid structural reference;
- timeout, quota, refusal, and network failure; and
- repeated identical cold runs to measure agreement.

Model-backed corpus runs are evaluation jobs, not nondeterministic unit tests.
Their inputs and expected semantic outcomes are versioned so Claude or another
reviewer can compare reasoning efforts and prompt revisions.

## 16. Acceptance criteria

The feature is complete when:

1. Every extracted plan step is visible as system, component, support, or
   unresolved impact.
2. No code path or UI string presents model failure as no structural change.
3. Internal-only plans show affected structural nodes and navigable nested
   change cards.
4. Small changes remain discoverable without becoming structural nodes.
5. Existing nested components receive the change at the deepest supported
   level and surface recursive badges.
6. Project Support and Needs Review are transient and reviewable.
7. Accepted and rejected decisions survive navigation and produce the correct
   deterministic brief.
8. No plan projection is persisted to the diagram.
9. Prepared and warm paths use one hosted call after the plan is available.
10. The unprepared cold path meets the two-stage call-depth target or is held
    behind the quality gate while the prepared path ships.
11. Phase timings and validation diagnostics are observable without logging
    user code or plan content.
12. The service remains compatible with released `/v1/plan` clients.
13. All automated tests pass, the evaluation corpus meets its quality gates,
    and package and plugin manifests report version `0.4.0`.
