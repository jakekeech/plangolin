const DEFAULT_PAD = 40;
const DEFAULT_GAP = 24;

const intersects = (a, b) =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

const move = (box, x, y) => ({
  left: box.left + x,
  right: box.right + x,
  top: box.top + y,
  bottom: box.bottom + y,
});

export function planPanDelta({ targets, viewport, occlusion = null, pad = DEFAULT_PAD, gap = DEFAULT_GAP }) {
  const primary = (targets || [])[0];
  if (!primary) return { x: 0, y: 0 };

  const bounds = {
    left: pad,
    top: pad,
    right: viewport.width - pad,
    bottom: viewport.height - pad,
  };
  let x = 0;
  let y = 0;
  if (primary.left < bounds.left) x = bounds.left - primary.left;
  else if (primary.right > bounds.right) x = bounds.right - primary.right;
  if (primary.top < bounds.top) y = bounds.top - primary.top;
  else if (primary.bottom > bounds.bottom) y = bounds.bottom - primary.bottom;

  const shifted = move(primary, x, y);
  if (!occlusion || !intersects(shifted, occlusion)) return { x, y };

  const candidates = [
    { x: occlusion.left - gap - shifted.right, y: 0 },
    { x: occlusion.right + gap - shifted.left, y: 0 },
    { x: 0, y: occlusion.top - gap - shifted.bottom },
    { x: 0, y: occlusion.bottom + gap - shifted.top },
  ].filter((candidate) => {
    const box = move(shifted, candidate.x, candidate.y);
    return box.left >= bounds.left && box.right <= bounds.right &&
      box.top >= bounds.top && box.bottom <= bounds.bottom;
  }).sort((a, b) => (Math.abs(a.x) + Math.abs(a.y)) - (Math.abs(b.x) + Math.abs(b.y)));

  const clear = candidates[0];
  return clear ? { x: x + clear.x, y: y + clear.y } : { x, y };
}
