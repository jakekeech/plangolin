import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, validate } from "../src/plan-delta.js";

const NODES = [
  { id: "server", name: "Server", kind: "Node HTTP", intent: "Serves the app.", anchor: { paths: ["src/server.js"] } },
  { id: "schema", name: "Schema", kind: "", intent: "Loads the files.", anchor: { dir: "src/schema" } },
];
const STEPS = [{ n: 1, text: "Add a limiter" }, { n: 2, text: "Wire it up" }];
const IDS = new Set(["server", "schema"]);

test("the prompt names every block, its folder and every numbered step", () => {
  const p = buildPrompt(NODES, STEPS);
  assert.match(p, /server/);
  assert.match(p, /Node HTTP/);
  assert.match(p, /src\/server\.js/);
  assert.match(p, /1\. Add a limiter/);
  assert.match(p, /2\. Wire it up/);
});

test("validate keeps a well-formed addition", () => {
  const { delta, dropped } = validate({
    additions: [{ id: "limiter", name: "Limiter", kind: "", intent: "Refuses.", dir: "src/limit", files: ["src/limit/rate-limit.js"], steps: [1] }],
    touches: [], connections: [], unplaced: [{ steps: [2], why: "detail" }],
  }, IDS, 2);
  assert.equal(dropped.length, 0);
  assert.equal(delta.additions[0].id, "limiter");
  assert.deepEqual(delta.additions[0].files, ["src/limit/rate-limit.js"]);
});

test("addition files keep only six safe relative paths and report every rejected value", () => {
  const { delta, dropped } = validate({
    additions: [{
      id: "limiter", name: "Limiter", kind: "", intent: "Refuses.", dir: "src/limit",
      files: [
        "src/limit/one.js", "/etc/passwd", "../outside.js", "C:\\Windows\\system.ini",
        "src/limit/two.js", "src/limit/three.js", "src/limit/four.js",
        "src/limit/five.js", "src/limit/six.js", "src/limit/seven.js",
      ],
      steps: [1],
    }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);

  assert.deepEqual(delta.additions[0].files, [
    "src/limit/one.js", "src/limit/two.js", "src/limit/three.js",
    "src/limit/four.js", "src/limit/five.js", "src/limit/six.js",
  ]);
  assert.equal(dropped.filter((reason) => reason.includes("file")).length, 4);
  assert.match(dropped.join(" "), /\/etc\/passwd/);
  assert.match(dropped.join(" "), /outside\.js/);
  assert.match(dropped.join(" "), /system\.ini/);
  assert.match(dropped.join(" "), /seven\.js/);
});

// The rule that makes plan references trustworthy. A step number outside the
// list cannot be checked against anything, so it is not shown to anyone.
test("validate drops a step number that does not exist", () => {
  const { delta, dropped } = validate({
    additions: [{ id: "limiter", name: "L", kind: "", intent: "x", dir: "", steps: [1, 99] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.deepEqual(delta.additions[0].steps, [1]);
  assert.match(dropped.join(" "), /step 99/);
});

test("validate drops a proposal whose every step was bogus", () => {
  const { delta, dropped } = validate({
    additions: [{ id: "limiter", name: "L", kind: "", intent: "x", dir: "", steps: [99] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.additions.length, 0);
  assert.match(dropped.join(" "), /no plan step/);
});

test("validate drops a touch on a block that is not on the sheet", () => {
  const { delta, dropped } = validate({
    additions: [], touches: [{ id: "ghost", why: "x", steps: [1] }], connections: [], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.touches.length, 0);
  assert.match(dropped.join(" "), /unknown block: ghost/);
});

test("touch size keeps the two supported weights", () => {
  const substantial = validate({
    additions: [], touches: [{ id: "server", why: "rewrites dispatch", size: "substantial", steps: [1] }],
    connections: [], unplaced: [],
  }, IDS, 2);
  const small = validate({
    additions: [], touches: [{ id: "schema", why: "adds a field", size: "small", steps: [1] }],
    connections: [], unplaced: [],
  }, IDS, 2);

  assert.equal(substantial.delta.touches[0].size, "substantial");
  assert.equal(small.delta.touches[0].size, "small");
  assert.equal(substantial.dropped.length, 0);
  assert.equal(small.dropped.length, 0);
});

test("an unknown touch size defaults to small and is reported without dropping the touch", () => {
  const { delta, dropped } = validate({
    additions: [], touches: [{ id: "server", why: "changes dispatch", size: "huge", steps: [1] }],
    connections: [], unplaced: [],
  }, IDS, 2);

  assert.equal(delta.touches.length, 1);
  assert.equal(delta.touches[0].size, "small");
  assert.match(dropped.join(" "), /touch "server" size/);
});

test("a connection may reach a block the same reply is adding", () => {
  const { delta, dropped } = validate({
    additions: [{ id: "limiter", name: "L", kind: "", intent: "x", dir: "", steps: [1] }],
    touches: [], connections: [{ from: "server", to: "limiter", label: "checks with", steps: [2] }], unplaced: [],
  }, IDS, 2);
  assert.equal(dropped.length, 0);
  assert.equal(delta.connections[0].to, "limiter");
});

test("a connection to nowhere is dropped", () => {
  const { delta, dropped } = validate({
    additions: [], touches: [], connections: [{ from: "server", to: "ghost", label: "x", steps: [1] }], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.connections.length, 0);
  assert.match(dropped.join(" "), /connection to an unknown block/);
});

test("an addition colliding with a block already on the sheet is dropped", () => {
  const { delta, dropped } = validate({
    additions: [{ id: "server", name: "S", kind: "", intent: "x", dir: "", steps: [1] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.additions.length, 0);
  assert.match(dropped.join(" "), /already on the sheet/);
});

test("a folder that escapes the project is stripped, the block is kept", () => {
  const { delta } = validate({
    additions: [{ id: "l", name: "L", kind: "", intent: "x", dir: "../../etc", steps: [1] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.additions[0].dir, "");
});

// An absolute path is an absolute path whichever platform wrote it. `/etc` was
// already stripped; `C:/Windows` survived, so the rule the comment claimed was
// not the rule the code kept.
test("a drive-letter folder is stripped too, the block is kept", () => {
  const { delta } = validate({
    additions: [{ id: "l", name: "L", kind: "", intent: "x", dir: "C:/Windows", steps: [1] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.additions.length, 1);
  assert.equal(delta.additions[0].dir, "");
});

// The honesty rule. The panel says "N steps changed nothing structural", and
// that number has to be every step nothing claimed — not just the ones the
// model remembered to mention.
test("a step nobody claimed is folded into unplaced", () => {
  const { delta } = validate({
    additions: [{ id: "l", name: "L", kind: "", intent: "x", dir: "", steps: [1] }],
    touches: [], connections: [], unplaced: [],
  }, IDS, 2);
  assert.deepEqual(delta.unplaced.flatMap((u) => u.steps), [2]);
  assert.match(delta.unplaced[0].why, /not mentioned/);
});

// The other half of the same honesty rule: the count may not inflate either.
// A step an addition already cited is not a step that changes nothing.
test("a step an addition already claimed is not also reported as changing nothing", () => {
  const { delta } = validate({
    additions: [{ id: "limiter", name: "L", kind: "", intent: "x", dir: "", steps: [1] }],
    touches: [], connections: [], unplaced: [{ steps: [1, 2], why: "detail" }],
  }, IDS, 2);
  assert.deepEqual(delta.unplaced.flatMap((u) => u.steps), [2]);
});

test("an unplaced entry made only of claimed steps is dropped entirely", () => {
  const { delta } = validate({
    additions: [{ id: "limiter", name: "L", kind: "", intent: "x", dir: "", steps: [1, 2] }],
    touches: [], connections: [], unplaced: [{ steps: [1], why: "detail" }],
  }, IDS, 2);
  assert.deepEqual(delta.unplaced, []);
});

test("a duplicate connection is dropped, not drawn twice", () => {
  const { delta, dropped } = validate({
    additions: [], touches: [],
    connections: [
      { from: "server", to: "schema", label: "reads", steps: [1] },
      { from: "server", to: "schema", label: "reads again", steps: [2] },
    ], unplaced: [],
  }, IDS, 2);
  assert.equal(delta.connections.length, 1);
  assert.match(dropped.join(" "), /second connection/);
});

test("a reply that is not an object at all yields an empty delta, not a throw", () => {
  const { delta } = validate(null, IDS, 2);
  assert.deepEqual(delta.additions, []);
  assert.equal(delta.unplaced[0].steps.length, 2);
});
