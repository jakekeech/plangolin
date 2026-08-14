# Total plan placement

**Date:** 2026-08-14

**Status:** proposed for user review

**Supersedes:** the `support` and `unresolved` success paths in
`2026-08-13-adaptive-plan-impact-design.md`

## Purpose

A successful Plangolin review must graph every meaningful planned change.
The current impact contract permits `support` and `unresolved` impacts, while
the simplified canvas displays only `system` and `component` impacts. This can
produce an empty, approvable review even when the plan contains substantial
work.

The Pushpush authentication plan reproduced the failure: 16 parsed steps
became six unresolved impacts and four support impacts, leaving zero visible
decisions. This design removes hidden successful outcomes without forcing file
paths to make architectural decisions on their own.

## Product contract

1. A successful review contains one or more visible decisions.
2. Every actionable plan item belongs to exactly one visible decision.
3. A visible decision is either:
   - `system`: structural nodes, responsibilities, or connections; or
   - `component`: work nested inside an existing or proposed node.
4. Tests, configuration, documentation, rollout, and sequencing are details
   attached to the decision they support. They are not separate graph nodes or
   hidden decisions.
5. `unresolved`, `Needs Review`, and `Project Support` are not final review
   categories or user-facing concepts.
6. If complete placement cannot be obtained safely, the review is an error
   with Retry and Skip. Approve is unavailable.
7. Planned graph content remains transient and is never written to
   `system.json`.

## Compact plan input

The agent writes a numbered decision plan, normally three to eight items. Each
item names one meaningful system or component change and keeps its files,
functions, tests, and ordering details inside the item.

The parser treats a numbered heading and its body as one item. Preambles,
alternatives, support paragraphs, and a repeated implementation-order section
do not become separate review decisions. They remain source detail attached to
the closest numbered item or are ignored when they contain no action.

This prevents a plan with eight decisions from becoming sixteen unrelated
classification requests.

## Hybrid placement authority

The LLM retains semantic control. It decides:

- whether an item changes system structure or stays inside a component;
- whether the plan introduces a genuinely new node;
- the highest useful abstraction to display;
- the most specific honest component target; and
- the relationships created or removed by the change.

Deterministic code supplies evidence and enforces boundaries. The model
receives:

- valid existing node ids and hierarchy;
- file ownership for cited paths;
- existing edges;
- proposed nodes already declared in the response; and
- candidate target ids derived from unambiguous file ownership.

The model cannot return `unresolved`. For every item it must choose an existing
or proposed target, or declare a proposed system node and its structural
relationship.

## Validation and repair

Validation remains deterministic and conservative:

1. Validate step coverage, target ids, hierarchy, files, structural operations,
   and connection endpoints.
2. Accept the model's placement when it is valid and supported by the plan.
3. Repair only unambiguous omissions. If every cited owned file belongs to one
   component, a missing internal target may use that component. Deterministic
   repair never invents a node, name, responsibility, or connection.
4. Send only invalid or missing items through one constrained placement retry.
   The retry receives the rejected reason, valid target choices, file ownership,
   and the option to declare a proposed node with required connections.
5. Validate the retry with the same rules.
6. If any actionable item remains unplaced, return an error. Do not build a
   partial or approvable projection.

The normal warm/prepared path still uses one impact call. The second call
occurs only when the first response has invalid placement.

## Projection and interaction

The root canvas contains the persisted codebase nodes and edges, plus proposed
system nodes and proposed connections. An existing or proposed node receives a
badge when it contains internal work. Double-clicking that node reveals the
nested change card.

The stepper contains exactly the same system and component decisions as the
graph. Supporting details appear only inside the selected decision's collapsed
Details section. Keep/Cut applies to the visible decision and all of its
attached details.

Approve is enabled only when:

- status is `ready`;
- at least one visible decision exists;
- every actionable item is covered exactly once; and
- every projected target and endpoint passes validation.

Placement failure shows a short error such as “Plangolin could not place every
change on this system map.” The existing graph remains visible, with Retry and
Skip controls and no Approve action.

## Pushpush acceptance example

The authentication plan should project as:

- a proposed **User Store** system node connected to **PII Analysis API**;
- authentication routes, protected endpoints, and job ownership nested inside
  **PII Analysis API**;
- authenticated API access, session state, and login/register UI nested inside
  **Privacy Analysis App**; and
- tests, database configuration, and sequencing folded into the Details of
  those decisions.

The existing Privacy Analysis App to PII Analysis API edge remains visible.
The result must have no Needs Review banner, no support group, no hidden plan
decisions, and no Approve button when placement fails.

## Failure and compatibility

Provider errors, malformed output, invalid repeated placement, or zero visible
decisions produce `error`, never `ready` or an approvable `partial` state.
Retry starts a fresh placement attempt; Skip leaves the plan unchanged.

The client may continue accepting old service responses during rollout, but it
must convert any returned `support` or `unresolved` impacts into the repair
pipeline rather than presenting them as successful outcomes. The service
schema then removes those levels after the updated client is released.

The next plugin release increments all version manifests together so installed
plugins reload both the runtime and plan-writing skill.

## Verification

Automated coverage must include:

- compact section parsing that turns the reproduced Pushpush plan into its
  meaningful numbered decisions rather than sixteen paragraph steps;
- valid model-selected system and component placement;
- unambiguous file-owner repair;
- constrained retry for missing, unknown, and structurally invalid targets;
- failure after an invalid retry;
- exact coverage with no duplicated or dropped actionable items;
- zero visible decisions blocking Approve;
- supporting details attached to visible decisions;
- nested projection at existing and proposed nodes;
- the reproduced Pushpush authentication fixture producing the expected User
  Store, API internals, App internals, and connections; and
- full plugin, service-contract, package, and manifest verification.

The evaluation corpus records placement accuracy, false structural additions,
retry rate, terminal placement failure rate, and repeat-run agreement without
logging plan or source content.

## Acceptance criteria

The change is complete when:

1. No successful service, validator, store, browser, or brief path exposes
   `unresolved`, Needs Review, or Project Support.
2. Successful reviews contain only visible system and component decisions.
3. Every actionable plan item is represented exactly once.
4. Supporting details never create canvas clutter or disappear from the
   accepted brief.
5. A zero-decision or incompletely placed review cannot be approved.
6. The Pushpush authentication reproduction produces the graph described
   above.
7. Normal prepared/warm latency retains one model call; only invalid placement
   triggers one constrained retry.
8. All automated and packaging checks pass with synchronized version strings.
