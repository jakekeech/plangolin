export function createRolledLoader(options) {
  const { draw, palette, reducedMotion, requestFrame, cancelFrame, now } = options;
  let canvas = null;
  let frame = 0;
  let startedAt = 0;

  function stop() {
    if (frame) cancelFrame(frame);
    frame = 0;
    canvas = null;
  }

  function start(nextCanvas, size = 58) {
    if (canvas === nextCanvas) return;
    stop();
    canvas = nextCanvas;
    startedAt = now();
    const still = reducedMotion();
    const colors = palette();

    function tick() {
      if (!canvas) return;
      const seconds = still ? 0 : (now() - startedAt) / 1000;
      draw(canvas, size, still ? 0 : (seconds / 4) * Math.PI * 2, colors);
      if (!still) frame = requestFrame(tick);
    }

    tick();
  }

  return { start, stop };
}
