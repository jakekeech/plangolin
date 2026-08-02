# Task-level plan parsing

## Problem

Plangolin currently calls every Markdown heading, list item, and separated
paragraph a plan step. Agent-written implementation plans contain headings,
file inventories, interfaces, constraints, explanations, code examples, test
commands, and commit instructions around a much smaller number of actual
tasks. The parser therefore turns ordinary plans into dozens or hundreds of
steps, caps the review at the first sixty fragments, and labels every fragment
the model did not cite as changing nothing structural.

The result is misleading in two ways: the displayed count is not a count of
implementation tasks, and later architectural work may never reach the model
because contextual fragments consumed the sixty-step budget first.

## Desired behavior

A structured implementation plan is reviewed one task section at a time. A
heading such as `### Task 3: Add request rate limiting` introduces one
reviewable unit. Files, explanatory prose, action checkboxes, verification
commands, and code fences inside that section provide evidence for that unit;
they do not become additional units.

A task section produces no review entry when it has no actionable
implementation content. Headings, introductions, constraints, metadata,
separators, risks, and context-only sections never appear as empty tasks.

Plans without numbered task sections remain supported through deterministic
fallbacks. Explicit checkbox actions take precedence, followed by numbered
list actions, then prose paragraphs. Headings and horizontal rules are context,
not standalone steps, in every mode.

## Parsing modes

The parser selects exactly one mode for the whole document:

1. **Task sections.** If any heading matches `Task N`, parse numbered task
   sections and ignore material outside them as standalone review units.
2. **Checkbox actions.** With no task headings, emit one unit per checkbox
   item.
3. **Numbered actions.** With neither task headings nor checkboxes, emit one
   unit per numbered list item.
4. **Prose fallback.** With none of the above, emit non-empty prose paragraphs
   while treating headings and separators only as context.

This ordering keeps the common agent-written format compact without making
hand-written plans unreadable.

## Task summaries

Each task-level unit is deterministic text assembled from:

- the task heading;
- declared create, modify, and test paths;
- checkbox action labels within the task.

Code-fence contents, generic metadata labels, prose-only commentary, and
commit-only bookkeeping are not copied into the summary. The existing
600-character limit remains the final bound. A task must contain at least one
non-bookkeeping action before it is emitted.

Verification and test actions count as evidence within a task but do not create
separate review units. A section containing only verification, documentation,
or commit bookkeeping is omitted because it cannot independently change the
system diagram.

## Data flow and UI

`splitSteps(markdown)` keeps its current return type:
`[{ n: number, text: string }]`. Numbers remain contiguous and one-based.
`stepCount(markdown)` uses the same parsing result before the existing
sixty-unit cap.

No API, model schema, layout, or CSS change is required. The browser and brief
copy will call the reduced units “plan tasks” instead of “plan steps.” The
“which tasks” disclosure will contain task summaries rather than headings and
metadata. Proposal cards and the Cut, Keep, and Approve flow remain unchanged.
Fallback actions are called tasks too, keeping the return type unchanged and
avoiding a parsing-mode flag that no other behavior needs.

## Limits and failures

The sixty-unit and 600-character safety limits remain. Reaching sixty now means
a document genuinely contains at least sixty reviewable task sections or
fallback actions. The existing truncation notice remains accurate.

Malformed or unclosed code fences must not swallow later task headings. Empty
input still produces no units. A task heading with no qualifying action is
silently omitted rather than represented as an empty task.

## Testing

Regression tests will cover a realistic multi-task implementation plan and
assert that introductions, constraints, file metadata, nested bullets, code
fences, verification-only sections, separators, and commit-only sections do
not inflate the count. Focused tests will cover each fallback mode, empty task
omission, contiguous numbering, fence recovery, character limits, and the
sixty-task cap. Existing plan-delta tests will verify that orphan accounting
operates over the reduced task list. Browser-string tests will pin the small
“steps” to “tasks” copy change without introducing a browser harness.
