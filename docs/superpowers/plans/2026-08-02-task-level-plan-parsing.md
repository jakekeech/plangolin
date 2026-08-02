# Task-level plan parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review one meaningful implementation task at a time instead of counting Markdown headings, metadata, and bookkeeping as empty structural changes.

**Architecture:** Replace the flat line splitter with a deterministic mode-selecting parser. Numbered `Task N` sections are collapsed into summaries assembled from their title, declared paths, and action checkboxes; documents without task sections fall back to checkbox, numbered-list, then prose actions. Keep the existing `splitSteps()` and `stepCount()` interfaces so plan storage, model validation, and review resolution remain unchanged.

**Tech Stack:** Node 20+, ES modules, `node:test`, plain browser JavaScript.

## Global Constraints

- Keep `splitSteps(markdown) -> [{ n, text }]` and `stepCount(markdown) -> number` unchanged.
- Keep the 60-unit and 600-character safety limits.
- Do not add dependencies or a Markdown parser.
- Never emit headings, separators, metadata-only sections, or bookkeeping-only sections as tasks.
- Preserve fence recovery: an unmatched fence cannot swallow later tasks.
- Keep the current proposal cards, graph, and approval layout unchanged.
- Use “task” only for user-facing copy; internal schema keys named `steps` remain unchanged.

---

### Task 1: Parse meaningful task sections and fallback actions

**Files:**
- Modify: `src/plan-steps.js`
- Test: `test/plan-steps.test.js`

**Interfaces:**
- Consumes: Markdown text passed to `splitSteps(markdown)` and `stepCount(markdown)`.
- Produces: the existing contiguous `{ n, text }` array and uncapped count, now at task granularity.

- [ ] **Step 1: Replace the heading-as-step tests with task-section regressions**

Add a realistic fixture directly to `test/plan-steps.test.js`:

```js
const STRUCTURED = `
# Rate limiting implementation plan

**Goal:** Protect the API.

## Global Constraints
- No dependencies.

### Task 1: Add the limiter

**Files:**
- Create: \`src/limiter.js\`
- Test: \`test/limiter.test.js\`

- [ ] **Step 1: Write the failing limiter tests**
- [ ] **Step 2: Implement request counting and rejection**
- [ ] **Step 3: Run the tests**
- [ ] **Step 4: Commit**

### Task 2: Verification only

- [ ] **Step 1: Run the full test suite**
- [ ] **Step 2: Commit**

### Task 3: Wire it into the server

**Files:**
- Modify: \`src/server.js\`

- [ ] **Step 1: Call the limiter before dispatch**
- [ ] **Step 2: Verify the integration**
`;

test("a structured plan becomes one entry per actionable task", () => {
  const steps = splitSteps(STRUCTURED);
  assert.equal(steps.length, 2);
  assert.match(steps[0].text, /Task 1: Add the limiter/);
  assert.match(steps[0].text, /src\/limiter\.js/);
  assert.match(steps[0].text, /Implement request counting and rejection/);
  assert.match(steps[1].text, /Task 3: Wire it into the server/);
  assert.deepEqual(steps.map((step) => step.n), [1, 2]);
});

test("headings, metadata and bookkeeping-only tasks are omitted", () => {
  const text = splitSteps(STRUCTURED).map((step) => step.text).join(" ");
  assert.doesNotMatch(text, /Global Constraints|No dependencies|Verification only|Commit/);
});
```

Change the old heading test so a heading supplies context rather than becoming an entry:

```js
test("a prose heading is context, not a step", () => {
  const steps = splitSteps("## Rate limiting\n\nAdd a limiter.\n");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, "Add a limiter.");
});
```

Add focused fallback cases:

```js
test("checkbox actions are the fallback when there are no task headings", () => {
  const steps = splitSteps("# Plan\n- [ ] Add a limiter\n- [ ] Run tests\n- [ ] Commit\n");
  assert.deepEqual(steps.map((step) => step.text), ["Add a limiter"]);
});

test("numbered actions are the fallback when there are no checkboxes", () => {
  const steps = splitSteps("# Plan\n1. Add a limiter\n2. Wire it to the server\n3. Verify it\n");
  assert.deepEqual(steps.map((step) => step.text), ["Add a limiter", "Wire it to the server"]);
});

test("prose paragraphs are the final fallback", () => {
  const steps = splitSteps("# Plan\n\nAdd a limiter.\n\nWire it to the server.\n");
  assert.deepEqual(steps.map((step) => step.text), ["Add a limiter.", "Wire it to the server."]);
});
```

Update the cap test to generate 61 actionable `Task N` sections and assert `splitSteps()` returns 60 while `stepCount()` returns 61. Keep the 600-character, closed-fence, unmatched-fence, empty-input, and contiguous-numbering coverage.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/plan-steps.test.js
```

Expected: FAIL because headings and metadata are still emitted separately, the verification-only task survives, and fallback bookkeeping is not filtered.

- [ ] **Step 3: Implement deterministic parsing modes**

In `src/plan-steps.js`, retain `strayFence()` and the public exports. Add these recognizers:

```js
const TASK = /^ {0,3}#{1,6}\s+Task\s+(\d+)\s*(?::|[—–-])?\s*(.*)$/i;
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FILE = /^\s*[-*+]\s+(?:Create|Modify|Test):\s+(.+)$/i;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
```

Add small pure helpers:

```js
function clean(text) {
  return String(text || "")
    .replace(/^\*\*Step\s+\d+\s*:\s*/i, "")
    .replace(/\*\*$/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bookkeeping(text) {
  return /^(?:run|verify|test|write (?:the )?.*tests?|add .*tests?|update (?:the )?(?:docs?|documentation)|document|commit|lint|format|typecheck)\b/i.test(clean(text));
}
```

Build a fence mask in one pass, using the existing stray-fence rule so a stray marker is treated as ordinary text. Then implement:

```js
function taskSections(lines, fenced) {
  const sections = [];
  let current = null;
  const flush = () => { if (current) sections.push(current); current = null; };
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const task = line.match(TASK);
    if (task) { flush(); current = { number: task[1], title: clean(task[2]), files: [], actions: [] }; return; }
    if (!current) return;
    const file = line.match(FILE);
    if (file) { current.files.push(clean(file[1])); return; }
    const action = line.match(CHECKBOX);
    if (action) current.actions.push(clean(action[1]));
  });
  flush();
  return sections
    .filter((section) => section.actions.some((action) => !bookkeeping(action)))
    .map((section) => {
      const parts = [`Task ${section.number}: ${section.title}`];
      if (section.files.length) parts.push(`Files: ${section.files.join(", ")}`);
      if (section.actions.length) parts.push(`Actions: ${section.actions.join("; ")}`);
      return parts.join(". ").slice(0, MAX_STEP_CHARS);
    });
}

function matchedActions(lines, fenced, pattern) {
  return lines.flatMap((line, i) => {
    const match = fenced[i] ? null : line.match(pattern);
    if (!match) return [];
    const text = clean(match[1]);
    return text && !bookkeeping(text) ? [text] : [];
  });
}

function proseActions(lines, fenced) {
  const actions = [];
  let paragraph = [];
  const flush = () => {
    const text = clean(paragraph.join(" "));
    if (text && !bookkeeping(text)) actions.push(text);
    paragraph = [];
  };
  lines.forEach((line, i) => {
    if (fenced[i] || !line.trim()) { flush(); return; }
    if (/^\s*#/.test(line) || RULE.test(line)) return;
    paragraph.push(line.trim());
  });
  flush();
  return actions;
}
```

A task section is emitted only when `actions.some((action) => !bookkeeping(action))`. Its summary is assembled in this order and truncated only at the end:

```js
const parts = [`Task ${number}: ${title}`];
if (files.length) parts.push(`Files: ${files.join(", ")}`);
if (actions.length) parts.push(`Actions: ${actions.join("; ")}`);
return parts.join(". ").slice(0, MAX_STEP_CHARS);
```

`splitAll()` selects the first applicable document-level mode in this order: task sections, checkboxes, numbered actions, prose. Filter empty strings before applying limits. `splitSteps()` continues to cap and number; `stepCount()` continues to return the uncapped result length.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run:

```bash
node --test test/plan-steps.test.js
```

Expected: all parser tests PASS with no warnings.

- [ ] **Step 5: Run the plan pipeline tests**

Run:

```bash
node --test test/plan-steps.test.js test/plan-delta.test.js test/plan-store.test.js test/plan-brief.test.js
```

Expected: PASS. Update assertions only where the expected user-facing unit is now a task; do not weaken validation assertions.

- [ ] **Step 6: Commit the parser behavior**

```bash
git add src/plan-steps.js test/plan-steps.test.js test/plan-store.test.js test/plan-brief.test.js
git commit -m "Review plans one task at a time"
```

---

### Task 2: Call review units tasks in user-facing copy

**Files:**
- Modify: `app/app.js`
- Modify: `src/plan-brief.js`
- Modify: `src/plan-store.js`
- Test: `test/plan-brief.test.js`
- Test: `test/plan-store.test.js`
- Create: `test/app-copy.test.js`

**Interfaces:**
- Consumes: unchanged review objects with `steps` and `delta.unplaced` fields.
- Produces: unchanged HTML and brief structures with visible nouns changed from “step” to “task.”

- [ ] **Step 1: Write failing copy tests**

Add assertions to the existing brief and store tests:

```js
assert.match(brief, /plan task changes nothing/);
assert.doesNotMatch(brief, /plan step/);
assert.match(review.note, /first 60 tasks were reviewed/);
```

Create `test/app-copy.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the plan review UI calls parser units tasks", async () => {
  const app = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /plan task/);
  assert.match(app, /change nothing structural/);
  assert.doesNotMatch(app, /plan step/);
});
```

- [ ] **Step 2: Run copy tests and verify RED**

Run:

```bash
node --test test/app-copy.test.js test/plan-brief.test.js test/plan-store.test.js
```

Expected: FAIL because current strings say “plan step(s).”

- [ ] **Step 3: Change only user-facing nouns**

In `app/app.js`, change visible strings such as `plan step`, `plan steps`, `from step`, and `which steps those are` to task equivalents. In `src/plan-brief.js` and `src/plan-store.js`, change brief and truncation prose the same way. Keep object keys, local variables, comments about schema fields, API payloads, and model-output fields named `steps`.

- [ ] **Step 4: Run copy and pipeline tests and verify GREEN**

Run:

```bash
node --test test/app-copy.test.js test/plan-steps.test.js test/plan-delta.test.js test/plan-store.test.js test/plan-brief.test.js
```

Expected: PASS with no warnings.

- [ ] **Step 5: Commit the copy correction**

```bash
git add app/app.js src/plan-brief.js src/plan-store.js test/app-copy.test.js test/plan-brief.test.js test/plan-store.test.js
git commit -m "Call reviewed plan units tasks"
```

---

### Task 3: Verify realistic counts and the complete suite

**Files:**
- Modify only if a verification failure exposes a requirement missed above.

**Interfaces:**
- Consumes: completed parser and copy changes.
- Produces: evidence that realistic plans no longer inflate and the repository remains green.

- [ ] **Step 1: Measure representative plans**

Run a read-only script importing `splitSteps()` and `stepCount()` against at least the existing plan-review implementation plan and the 41-fragment Python SCIP plan. Confirm the first collapses to its `Task N` sections and the second uses deterministic fallback actions without headings or separators.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with no asynchronous warnings.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors and only deliberate changes. Do not commit unrelated files.
