# Plan Review Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve explicit plan file paths and touch weight, and show one-hop upstream users of changed blocks in the review and approved brief.

**Architecture:** The private service owns only the model prompt and output schema. The public CLI validates every new model field, computes dependency reach from the sheet's directed edges, carries those facts through the review store, and renders them in the markdown brief and browser-only review UI without changing proposal keys or persisted sheet data.

**Tech Stack:** Node 20+, ESM, `node:test`, static HTML/CSS/JavaScript.

## Global Constraints

- No dependencies and no build step.
- Keep the six-block cap unchanged.
- `src/workspace.js` remains the only file that directly touches `fs`.
- Malformed model fields are dropped or defaulted without failing their block.
- Do not change `proposalKey` or `planKey`.
- Reviews must not write proposals to `plangolin/system.json` or `layout.json`.
- Work on `main`, commit, and do not push.

---

### Task 1: Explicit addition files

**Files:**
- Modify: `/Users/jakekee/code/launchpad/service/tasks.js`
- Modify: `src/plan-delta.js`
- Modify: `src/plan-brief.js`
- Modify: `app/app.js`
- Modify: `app/app.css`
- Modify: `app/index.html`
- Test: `test/plan-delta.test.js`
- Test: `test/plan-brief.test.js`

**Interfaces:**
- Produces: addition `files: string[]`, validated as at most six safe relative paths.
- Consumes: explicit paths returned by the plan task only.

- [ ] Add failing validation tests for valid, absolute, climbing, drive-letter, and over-cap file paths; run them and confirm the missing behavior.
- [ ] Add failing brief coverage for file lines below `lives in:`; run it and confirm the files are absent.
- [ ] Add `files` to the private schema and instruct the model to return only paths written in the plan, or `[]` for folder-only plans.
- [ ] Implement safe per-file validation with a `dropped` reason for each rejected or excess path while retaining the addition.
- [ ] Render accepted file paths below `lives in:` in the brief and as a clamped monospaced detail below an addition description in the panel.
- [ ] Run focused plan-delta and plan-brief tests.

### Task 2: Touch size

**Files:**
- Modify: `/Users/jakekee/code/launchpad/service/tasks.js`
- Modify: `src/plan-delta.js`
- Modify: `app/app.js`
- Modify: `app/app.css`
- Modify: `app/index.html`
- Test: `test/plan-delta.test.js`

**Interfaces:**
- Produces: touch `size: "small" | "substantial"`, defaulting to `"small"`.

- [ ] Add failing tests for both valid literals and an invalid value defaulting to `small` with a dropped reason.
- [ ] Add the required size definition to the private prompt and schema.
- [ ] Validate size to the two literals without dropping the touch.
- [ ] Render the quiet uncoloured size word beside the touch name.
- [ ] Run the focused validation tests.

### Task 3: One-hop upstream reach

**Files:**
- Create: `src/plan-reach.js`
- Create: `test/plan-reach.test.js`
- Modify: `src/plan-store.js`
- Modify: `src/plan-brief.js`
- Modify: `app/app.js`
- Modify: `app/app.css`
- Modify: `app/index.html`
- Test: `test/plan-store.test.js`
- Test: `test/plan-brief.test.js`

**Interfaces:**
- Produces: `planReach(edges, changedIds): Array<{ id: string, via: string, label: string }>`.
- Produces: browser review `reach` facts computed from the exact graph used for the delta.
- Consumes: directed edges where `from` is the dependent and `to` is the dependency.

- [ ] Add direct failing tests for a chain, diamond, cycle, isolated block, and reverse-direction edge.
- [ ] Implement the pure one-hop incoming-edge selection with deterministic de-duplication.
- [ ] Add failing store coverage showing reach is computed from an existing or scanned sheet and sent to the browser.
- [ ] Carry the source graph's edges through `fill`, compute reach from touch ids and connection endpoints, and expose the facts without persisting them.
- [ ] Add failing brief coverage for `Used by Name (label)` under a kept UPDATE entry, then render only reach facts whose `via` is that touch.
- [ ] Render `Used by Package Entry (exports API)` in the panel for each proposal's relevant facts.
- [ ] Mark dependent nodes with a quiet third-state ring distinct from lit nodes and background nodes; keep camera focus on the proposal subject.
- [ ] Run focused reach, store, and brief tests.

### Task 4: Verification and delivery

**Files:**
- Create: `/tmp/codex-fix6-report.md`

- [ ] Run the complete `npm test` suite and record the before/after totals.
- [ ] Run `/tmp/plangolin-repos/run.mjs` for express, requests, and gin with the local service URL.
- [ ] Start the local app as needed and verify addition files, touch size, reach wording, and third-state highlighting in a real browser.
- [ ] Confirm review actions did not alter `plangolin/system.json` or `layout.json` in the fixture repositories.
- [ ] Inspect the final diff, confirm `proposalKey` and `planKey` are unchanged, and scan forbidden reach wording.
- [ ] Write the report, noting that private-service deployment remains required and was not attempted.
- [ ] Commit with a short imperative sentence and do not push.
