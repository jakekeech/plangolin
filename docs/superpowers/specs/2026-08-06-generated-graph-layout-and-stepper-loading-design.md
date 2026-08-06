# Generated Graph Layout and Stepper Loading Design

## Scope

This change affects only the Plangolin repository and fixes two browser UI behaviors:

1. Freshly generated or scanned graphs must be positioned from their relationships instead of model emission order.
2. The plan-review stepper must show visible, accessible progress while a plan is being generated.

It does not rearrange diagrams that already contain saved positions, change manual placement, change the generated graph schema, or modify any submission repository.

## Current Behavior and Root Cause

The browser already contains a lightweight layered graph layout. It assigns dependency depth to columns, orders peers using their feeders, breaks cycle-closing edges out of the positioning calculation, wraps very wide layouts, and falls back to a grid when no relationships exist.

Fresh generation bypasses that layout. During replay, each `addNode` move calls `freeSpot(lastPlaced)`, so every new block is placed near the block emitted immediately before it. Model response order therefore produces a long line even when the eventual edges describe branches or unrelated peers. The edges arrive after many positions have already been chosen and never cause those positions to be reconsidered.

The plan stepper's `thinking` branch only displays status text and hides the proposal body. The rolling-pangolin progress treatment exists only in the full-canvas splash and has no stepper-specific animation lifecycle.

## Graph Layout Design

Before replay begins, derive a temporary graph from the complete generation payload:

- Collect the IDs from valid `addNode` moves.
- Collect `connect` moves whose endpoints are both in that generated set.
- Pass those IDs and edges through the existing layered layout algorithm.

Replay remains paced so the graph visibly builds one move at a time. When an `addNode` move is applied, assign the node its precomputed final coordinate immediately. This preserves the existing animation without showing an intermediate horizontal chain or snapping the completed graph into a second arrangement.

The layout behavior remains:

- Dependency depth determines columns.
- Nodes at the same depth share a column and are vertically ordered to reduce crossings.
- Cycle-closing edges remain visible but do not distort dependency depth.
- Layouts wider than the configured column limit wrap into a lower band.
- Graphs with no internal edges use the compact grid fallback.

The same layout function continues to position completely unpositioned documents loaded from disk. Any level containing at least one saved position retains the current protection against automatic rearrangement.

## Stepper Loading Design

The plan panel's `thinking` state will contain a compact loading region with:

- A small canvas rendering the existing rolled-pangolin artwork.
- The existing “Reading the plan against your sheet…” status, exposed through a polite live region.
- Layout sized for the panel rather than the full-canvas splash.

A dedicated stepper animation controller will start only while the visible plan is `thinking`. It will stop and cancel its animation frame when the plan becomes ready, is resolved, disappears, or the panel closes. Repeated polls and renders must not start duplicate animation loops.

The spinner will reuse the splash renderer and palette. With `prefers-reduced-motion: reduce`, it will render a stationary rolled pangolin instead of rotating. The proposal body, navigation, and approval controls remain unchanged once the plan is ready.

## Error and Lifecycle Behavior

- A failed plan poll leaves the current thinking indicator intact; the next successful poll remains authoritative.
- A transition from thinking to ready removes the loading region before rendering proposals.
- Resolving or abandoning a plan stops the animation even if the panel is rendered closed before another poll.
- Generation layout ignores malformed or out-of-scope connections in the same way the move validator already does; replay remains the authority on whether each move applies.

## Testing

Add focused automated coverage for the layout behavior using literal, hand-checked coordinates:

- A branched graph places peers in the same dependency column instead of chaining them horizontally by emission order.
- A graph with no edges uses the compact grid fallback.
- A cycle-closing edge does not force an ever-deeper row.
- A long dependency chain wraps after the configured maximum number of columns.

The production change that these tests catch is generation falling back to sequential `freeSpot` placement or otherwise ignoring graph edges.

Verify the stepper in the browser at both lifecycle boundaries:

- A `thinking` review shows the compact rolled-pangolin progress state without duplicate animation loops.
- A `ready` review removes the progress state and restores the normal proposal UI.
- Reduced-motion renders a stationary indicator.

Finally, run the full Node test suite and inspect the browser console for errors during the thinking-to-ready transition.
