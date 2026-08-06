import { test } from "node:test";
import assert from "node:assert/strict";
import { createRolledLoader } from "../app/rolled-loader.js";

function harness(reduced = false) {
  const draws = [];
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 1;
  let time = 1000;
  const loader = createRolledLoader({
    draw: (...args) => draws.push(args),
    palette: () => "palette",
    reducedMotion: () => reduced,
    requestFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame: (id) => { cancelled.push(id); frames.delete(id); },
    now: () => time,
  });
  return { loader, draws, frames, cancelled, advance(ms) { time += ms; } };
}

test("the loader starts one animation loop per canvas and stops it", () => {
  const h = harness();
  const canvas = {};
  h.loader.start(canvas, 58);
  h.loader.start(canvas, 58);
  assert.equal(h.draws.length, 1);
  assert.equal(h.frames.size, 1);

  const [id, tick] = [...h.frames.entries()][0];
  h.frames.delete(id);
  h.advance(1000);
  tick();
  assert.equal(h.draws.length, 2);
  assert.equal(h.frames.size, 1);

  const pending = [...h.frames.keys()][0];
  h.loader.stop();
  assert.deepEqual(h.cancelled, [pending]);
  assert.equal(h.frames.size, 0);
});

test("reduced motion draws one stationary frame", () => {
  const h = harness(true);
  h.loader.start({}, 58);
  assert.equal(h.draws.length, 1);
  assert.equal(h.draws[0][2], 0);
  assert.equal(h.frames.size, 0);
});
