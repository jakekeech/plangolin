import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, validate, TITLE_MAX, INTENT_MAX } from "../src/name-change.js";

const CHANGES = [
  { id: "c1", blocks: ["billing", "stripe"] },
  { id: "c2", blocks: ["sessions"] },
];
const NODES = [
  { id: "billing", name: "Billing", kind: "Service", intent: "Handles invoices." },
  { id: "stripe", name: "Stripe", kind: "Someone else's API", intent: "Payments." },
  { id: "sessions", name: "Sessions", kind: "In memory", intent: "Who is logged in." },
];

test("the prompt names the change ids, the blocks, and their files", () => {
  const p = buildPrompt(CHANGES, NODES,
    new Map([["billing", ["src/billing/plans.js"]], ["sessions", ["src/session.js"]]]),
    new Map([["src/billing/plans.js", "export function proration() {}"]]));
  assert.match(p, /c1/);
  assert.match(p, /Billing/);
  assert.match(p, /src\/billing\/plans\.js/);
  assert.match(p, /proration/);
  assert.match(p, /Handles invoices\./, "the current description, so it can tell whether it still holds");
});

test("a well formed reply comes back whole", () => {
  const got = validate({ changes: [
    { changeIds: ["c1"], title: "Stripe subscription billing",
      blocks: [{ id: "billing", intent: "Plans, proration and invoices." }] },
  ] }, CHANGES);
  assert.deepEqual(got.changes[0].ids, ["c1"]);
  assert.equal(got.changes[0].title, "Stripe subscription billing");
  assert.deepEqual(got.changes[0].blocks, [{ id: "billing", intent: "Plans, proration and invoices." }]);
  assert.deepEqual(got.dropped, []);
});

test("one entry may cover several groups — that is the model merging them", () => {
  // The grouping only joins blocks that reference each other, so one lint
  // pass in two unconnected places arrives as two changes. The model can see
  // it is one job. Its blocks may come from either group.
  const got = validate({ changes: [
    { changeIds: ["c1", "c2"], title: "One job, split in two",
      blocks: [{ id: "sessions", intent: "Keeps who is logged in, in Redis." }] },
  ] }, CHANGES);
  assert.equal(got.changes.length, 1);
  assert.deepEqual(got.changes[0].ids, ["c1", "c2"]);
  assert.deepEqual(got.changes[0].blocks, [{ id: "sessions", intent: "Keeps who is logged in, in Redis." }]);
});

test("a group claimed twice is only counted once", () => {
  // Otherwise the same blocks appear under two titles and the counts on the
  // strip stop adding up.
  const got = validate({ changes: [
    { changeIds: ["c1"], title: "First claim", blocks: [] },
    { changeIds: ["c1", "c2"], title: "Second claim", blocks: [] },
  ] }, CHANGES);
  assert.deepEqual(got.changes.map((c) => c.ids), [["c1"], ["c2"]]);
  assert.ok(got.dropped.some((d) => d.includes("claimed twice")));
});

test("a change id nobody asked about is dropped", () => {
  const got = validate({ changes: [
    { changeIds: ["c9"], title: "Invented", blocks: [] },
  ] }, CHANGES);
  assert.equal(got.changes.length, 0);
  assert.equal(got.dropped.length, 1);
});

test("a block outside its own change is dropped, the title survives", () => {
  // The model may only rewrite blocks that were part of that change. Letting
  // it edit anything else would turn one AI call into an unbounded rewrite of
  // the sheet.
  const got = validate({ changes: [
    { changeIds: ["c2"], title: "Session store moved to Redis",
      blocks: [{ id: "billing", intent: "Nothing to do with c2." }] },
  ] }, CHANGES);
  assert.equal(got.changes[0].title, "Session store moved to Redis");
  assert.deepEqual(got.changes[0].blocks, []);
  assert.equal(got.dropped.length, 1);
});

test("an over-long title is dropped rather than cut mid-word", () => {
  const got = validate({ changes: [
    { changeIds: ["c1"], title: "x".repeat(TITLE_MAX + 1), blocks: [] },
  ] }, CHANGES);
  assert.equal(got.changes.length, 0);
});

test("an over-long intent is dropped, the title survives", () => {
  const got = validate({ changes: [
    { changeIds: ["c1"], title: "Fine", blocks: [{ id: "billing", intent: "y".repeat(INTENT_MAX + 1) }] },
  ] }, CHANGES);
  assert.equal(got.changes[0].title, "Fine");
  assert.deepEqual(got.changes[0].blocks, []);
});

test("an empty or blank title is not a name", () => {
  const got = validate({ changes: [
    { changeIds: ["c1"], title: "   ", blocks: [] },
    { changeIds: ["c2"], title: "Real", blocks: [] },
  ] }, CHANGES);
  assert.deepEqual(got.changes.map((c) => c.ids), [["c2"]]);
});

test("a shapeless reply is nothing named, never a throw", () => {
  for (const junk of [null, {}, { changes: "no" }, { changes: [null] }, { changes: [{}] }]) {
    const got = validate(junk, CHANGES);
    assert.equal(got.changes.length, 0);
  }
});

test("the prompt says these are the lines that moved, not the file", () => {
  // The lesson from a real call: given the head of app.css — an embedded
  // base64 font — the model named the change "Atkinson Hyperlegible
  // interface font". Given the diff, it named what the change did. The
  // wording matters because the model has to know which one it is holding.
  const p = buildPrompt([{ id: "c1", blocks: ["billing"] }], NODES,
    new Map([["billing", ["src/billing/plans.js"]]]),
    new Map([["src/billing/plans.js", "@@ -1 +1,4 @@\n+export function proration() {}"]]));
  assert.match(p, /changed lines in src\/billing\/plans\.js/);
  assert.match(p, /\+export function proration/);
});

test("one title covering everything is refused, not believed", () => {
  // The observed failure: ten express commits — a feature, two dependency
  // upgrades, a lint fix and an error-logging change — came back as a single
  // "HTTP header compliance, QUERY freshness, and error logging". That is a
  // list with the information taken out, and believing it would lose the one
  // thing the reader came for.
  const four = [
    { id: "c1", blocks: ["billing"] }, { id: "c2", blocks: ["stripe"] },
    { id: "c3", blocks: ["sessions"] }, { id: "c4", blocks: ["billing"] },
  ];
  const got = validate({ changes: [
    { changeIds: ["c1", "c2", "c3", "c4"], title: "Everything, and also everything else", blocks: [] },
  ] }, four);
  assert.equal(got.changes.length, 0);
  assert.ok(got.dropped.some((d) => d.includes("cover 4 of 4")));
});

test("a small merge is still allowed", () => {
  const three = [
    { id: "c1", blocks: ["billing"] }, { id: "c2", blocks: ["stripe"] },
    { id: "c3", blocks: ["sessions"] },
  ];
  const got = validate({ changes: [
    { changeIds: ["c1", "c2"], title: "One lint pass, two places", blocks: [] },
  ] }, three);
  assert.deepEqual(got.changes.map((c) => c.ids), [["c1", "c2"]]);
});
