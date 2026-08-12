export function planHintPosition({
  panelX,
  panelY,
  panelHeight,
  hintHeight,
  canvasHeight,
  gap = 8,
  edge = 8,
}) {
  const below = panelY + panelHeight + gap;
  const fitsBelow = below + hintHeight + edge < canvasHeight;
  return {
    left: Math.round(panelX),
    top: Math.round(fitsBelow ? below : panelY - hintHeight - gap),
  };
}

export function dockPlanAndHint(panel, hint, dock, dimensions) {
  const target = planHintPosition({
    panelX: dock.x,
    panelY: dock.y,
    ...dimensions,
  });
  panel.style.left = dock.x + "px";
  panel.style.top = dock.y + "px";
  hint.style.right = "auto";
  hint.style.bottom = "auto";
  hint.style.left = target.left + "px";
  hint.style.top = target.top + "px";
  return target;
}
