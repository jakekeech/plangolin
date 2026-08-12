# Plan Stepper Instruction Motion Design

## Scope

Synchronize the keyboard-instruction hint with the draggable plan-review
stepper when the panel docks after a drag. The hint must remain attached to the
panel during direct manipulation and must glide to the dock at the same time as
the panel.

This change does not alter the panel's dock choices, drag behavior, dimensions,
instruction content, or reduced-motion policy.

## Current Behavior and Root Cause

While the panel is being dragged, `pointermove` updates the panel and calls
`positionHint()`, so the hint tracks the panel correctly.

On release, the panel enables its CSS transition and glides to the nearest dock
over 340 ms. The hint is not given its new position until a separate 360 ms
timeout fires. The visible lag is therefore deterministic: the panel finishes
moving before the hint starts moving.

## Interaction Design

The panel and hint will be treated as two independently positioned elements
with one shared docking motion:

- During pointer drag, transitions remain disabled for both elements. Each
  follows the pointer immediately.
- On release, compute the selected dock once and update the panel and hint
  destinations in the same frame.
- Give the hint the same 340 ms duration and cubic-bezier easing as the panel.
- Keep the existing eight-pixel visual gap and the existing rule that places
  the hint above the panel when there is not enough room below it.
- Remove the timeout that updates the hint after the panel has settled.

The existing global `prefers-reduced-motion: reduce` rule continues to disable
both transitions, so the panel and hint move to their final positions together
without animation.

## Implementation Shape

Retain the current DOM structure and docking algorithm. Extend the hint
positioning helper so it can position from the chosen dock coordinates instead
of waiting to re-measure the panel at the end of its transition. Use the same
motion values for `.planpanel` and `.hint-plan`, and suppress the hint transition
while the panel carries `data-dragging="true"`.

This avoids a per-frame animation loop and avoids wrapping the panel and hint in
a new container solely to coordinate one transition.

## Testing

Add focused regression coverage for the docking-position calculation and its
above/below boundary. Verify the interaction in the browser by dragging the
panel to multiple docks and confirming that:

- the hint tracks immediately during the drag;
- the panel and hint begin and finish the dock glide together;
- the hint remains eight pixels from the panel;
- docking near the bottom still places the hint above the panel; and
- reduced motion produces one synchronized, non-animated position change.

Run the complete Node test suite and inspect the browser console for errors
during repeated drags.
