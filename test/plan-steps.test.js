import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSteps, stepCount } from "../src/plan-steps.js";

test("a numbered list becomes one step per item", () => {
  const steps = splitSteps("1. Add a limiter\n2. Wire it to the server\n3. Test it\n");
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3]);
  assert.equal(steps[0].text, "Add a limiter");
  assert.equal(steps[2].text, "Test it");
});

test("a heading opens the step that follows it, rather than standing alone", () => {
  const steps = splitSteps("## Rate limiting\n\nAdd a limiter.\n");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, "Rate limiting — Add a limiter.");
});

test("a heading that carries the instruction survives", () => {
  // "### Task 1: ..." is the ask and the line under it only elaborates, so
  // dropping headings outright would lose the instruction.
  const steps = splitSteps("### Task 1: Add the counter store\nBack it with Redis.\n");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, "Task 1: Add the counter store — Back it with Redis.");
});

test("a heading with nothing under it is dropped, not counted", () => {
  // Why this changed: a bare section label is a step that cannot change any
  // block, so it could only ever be counted as idle — inflating the
  // denominator of the one ratio this feature reports about a plan.
  const steps = splitSteps("# Plan\n\n## Steps\n\n1. Add a limiter.\n");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, "Steps — Add a limiter.");
  assert.equal(stepCount("# Plan\n\n## Steps\n\n1. Add a limiter.\n"), 1);
});

test("only the first step after a heading carries it", () => {
  const steps = splitSteps("## Work\n\n1. Add a limiter.\n2. Wire it up.\n");
  assert.equal(steps.length, 2);
  assert.equal(steps[0].text, "Work — Add a limiter.");
  assert.equal(steps[1].text, "Wire it up.");
});

test("an indented continuation line stays with its item", () => {
  const steps = splitSteps("- Add a limiter\n  in src/limit/, in memory\n- Wire it up\n");
  assert.equal(steps.length, 2);
  assert.equal(steps[0].text, "Add a limiter in src/limit/, in memory");
});

// A plan's code block is detail by definition — it is the "how" the graph
// exists to look past. It rides along with the step that introduced it rather
// than becoming steps of its own, where a stray "1." inside a snippet would
// otherwise split a fence in half.
test("a fenced code block never starts a step", () => {
  const steps = splitSteps("Add this:\n\n```js\n1. not a step\n- also not\n```\n\nThen commit.\n");
  assert.equal(steps.length, 2);
  assert.match(steps[0].text, /not a step/);
  assert.equal(steps[1].text, "Then commit.");
});

test("blank-line-separated paragraphs are separate steps", () => {
  const steps = splitSteps("First para.\nStill first.\n\nSecond para.\n");
  assert.equal(steps.length, 2);
  assert.equal(steps[0].text, "First para. Still first.");
});

test("empty input gives no steps", () => {
  assert.deepEqual(splitSteps(""), []);
  assert.deepEqual(splitSteps("\n\n   \n"), []);
});

// Backstops. The prompt is bounded by these, not by hope.
test("a runaway plan is capped at sixty steps", () => {
  const steps = splitSteps(Array.from({ length: 200 }, (_, i) => `${i + 1}. step`).join("\n"));
  assert.equal(steps.length, 60);
});

test("a runaway step is truncated rather than dropped", () => {
  const steps = splitSteps("- " + "x".repeat(2000));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text.length, 600);
});

// The cap is a prompt bound, not a claim about the plan. Somebody has to be
// able to tell the reader that the rest went unread, and that needs the real
// number.
test("stepCount reports the plan's real length, past the cap", () => {
  const plan = Array.from({ length: 200 }, (_, i) => `${i + 1}. step`).join("\n");
  assert.equal(splitSteps(plan).length, 60);
  assert.equal(stepCount(plan), 200);
});

// A stray marker used to make every line after it one 600-character step.
// The lines after it are still the user's plan.
test("an unterminated fence does not swallow the steps after it", () => {
  const texts = splitSteps("- one\n\n```js\ncode\n\n- two\n- three").map((s) => s.text);
  assert.equal(texts[0], "one");
  assert.ok(texts.includes("two"));
  assert.ok(texts.includes("three"));
});

// ~~~ exists precisely so a block can hold ``` — a plan quoting a fenced
// example is the common case, and closing on the wrong marker would cut it in
// half and read the example as steps.
test("a ``` inside a ~~~ block does not close it", () => {
  const steps = splitSteps("~~~\n```js\n1. not a step\n```\n~~~\n\nThen commit.\n");
  assert.equal(steps.length, 2);
  assert.match(steps[0].text, /not a step/);
  assert.equal(steps[1].text, "Then commit.");
});
