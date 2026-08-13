# Task 10 report

## Status

Implemented truthful review progress/outcomes, adaptive non-overlapping polling,
and safe Retry/Skip controls for plan-review failures.

## Changes

- Added `app/plan-progress.js`, a DOM-free ESM module shared by the browser and
  Node tests. It owns bounded phase copy, outcome summaries, active/idle poll
  delays, control-state classification, the self-scheduling poll loop, and the
  debounced optimistic Retry request.
- Replaced the legacy `thinking`-only spinner path with the server's current
  `working` phases. The live polite status region now reports mapping,
  grouping, naming/matching, map loading, plan matching, and review arrangement
  using the browser-safe counts from Task 7.
- Replaced the final kept/cut-only message with a useful review summary:
  internal work names affected components, structural work leads with concrete
  additions/removals/connections, partial results call out Needs Review, and
  error results preserve the safe service message without claiming coverage.
- Replaced the fixed two-second interval with one self-scheduling timeout.
  Active `working`, `ready`, `partial`, and `error` reviews poll after 500 ms;
  idle/decided state polls after 2000 ms. The next timer is created only after
  the current asynchronous poll settles, and page hide stops the timer.
- Added error-only Retry and Skip controls. Approve/Keep/Cut/navigation are
  hidden for errors; partial and ready reviews retain their staged
  Keep/Cut/Approve flow, with a visible Needs Review warning for partial.
- Retry posts once to `/api/plan/retry`, immediately renders a working phase,
  preserves the current plan and projection while the same review is in
  flight, and restores an actionable error only if polling has not already
  advanced the review.
- Kept Task 9 navigation and decisions intact: only a changed review ID resets
  `planCut`/navigation; same-review revisions retain existing cut keys, while
  newly arriving impact keys remain accepted by default.
- Updated `app/index.html` labels/live regions and `app/app.css` warning and
  collapsed-panel styling. The brief's `app/style.css` path is stale; the
  stylesheet actually served by the application is `app/app.css`.
- Updated the old review-command assertion that required static spinner text;
  it now verifies the browser's dynamic polite live region while preserving
  the CLI's existing system-map message.

## TDD evidence

- Initial RED: `node --test test/plan-progress.test.js` failed with
  `ERR_MODULE_NOT_FOUND` before `app/plan-progress.js` existed. The first pure
  implementation made all 12 copy/summary/delay/scheduler/control cases green.
- Browser-wiring RED: the integration test failed because `app/app.js` did not
  import `plan-progress.js`. Wiring the tested scheduler, controller, copy, and
  control model into the browser made it green.
- Error-coverage RED: a truncated error initially rendered
  “only the first 60 steps were reviewed.” The named regression failed with the
  full stale coverage sentence, then passed after error summaries removed that
  Task 7 truncation prefix while retaining the actionable provider message.
- Full-suite compatibility RED: 516/517 passed; the sole failure was an older
  test requiring “Preparing the plan against your system map” inside the HTML
  spinner. Updating that superseded assertion to the new `role="status"`,
  `aria-live="polite"` contract made the focused review-command suite 6/6 and
  the repository suite 517/517.

## Verification

- `node --check app/app.js && node --check app/plan-progress.js && git diff --check`
  — passed.
- `node --test test/plan-progress.test.js test/plan-projection.test.js test/plan-routes.test.js`
  — 38 passing, 0 failing.
- `node --test test/plan-interaction.test.js test/plan-hint-motion.test.js`
  — 51 passing, 0 failing.
- `node --test test/review-command.test.js` — 6 passing, 0 failing.
- `npm test` — 517 passing, 0 failing.

The localhost route/full-suite commands required ordinary loopback binding
outside the restricted sandbox; the same commands exited 0 with that permission.

## Self-review

### Timer overlap and recovery

- `start()` is idempotent, the loop has a `running` guard, and no timeout exists
  while `await poll()` is unresolved. The next delay is selected from the
  post-poll review state inside `finally`.
- Poll exceptions are contained and still schedule the next active/idle read.
  `stop()` clears a pending timer, and a callback racing after page hide observes
  the stopped flag without issuing a fetch.
- Task 9's `[id, status, revision]` monotonic stamp remains the repaint gate, so
  higher phase/count revisions repaint and stale/out-of-order revisions do not.

### Retry and error mutation

- The retry controller flips its in-flight guard before publishing or fetching;
  a second invocation returns without a second request. The optimistic state
  copies the review and retains its step/impact arrays instead of replacing the
  plan with an empty placeholder.
- Network/refusal errors restore an error only when the current review is still
  the exact optimistic object, so a poll that has already advanced to working,
  ready, or partial cannot be overwritten by a late failure.
- Error controls expose Retry and Skip only. Error summary tests reject reviewed
  step counts, affected-component claims, shape claims, and the stale truncated
  coverage prefix.

### Navigation, decisions, persistence, and accessibility

- Same-review working/error states retain the previous immutable projection,
  preserving temporary roots and selection during Retry. Ready/partial revisions
  rebuild and normalize through Task 9's existing navigation helper.
- `planCut` resets only for a new review ID. Accepted keys continue to derive as
  current impact keys minus that set, which keeps surviving cuts and accepts new
  impacts by default.
- The new code writes no `S.nodes`, `S.edges`, document payload, or save path;
  transient plan state remains outside persistence.
- Progress and partial warnings use polite status regions. Every new action is a
  native labeled button; starting Retry moves focus off the hidden control, and
  a failed request returns focus to Retry.

## Concerns

None.
