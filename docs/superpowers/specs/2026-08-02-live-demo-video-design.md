# Plangolin Live Demo Video Design

## Purpose

Create a prerecorded product segment that begins immediately after a live actor says “looks good to me” without reading Claude's long plan. The video should convert that joke into a clear product demonstration: Plangolin lets a developer review the structural decisions hidden inside an agent's prose before implementation begins.

The segment should feel like the continuation of the live screen, not a separate advertisement.

## Format

- Target length: 85–95 seconds
- Canvas: 16:9, 1920×1080
- Playback: prerecorded immediately after the live skit
- Style: visually led, restrained narration, real product UI and literal product output
- Closing line: “Approve the shape, not the wall of text.”

## Narrative

### 1. Match cut from the live skit — 0:00–0:08

The video opens on the exact Claude terminal frame visible during the skit. The cursor and terminal freeze after “looks good to me.” The plan text compresses, threads become connecting lines, and the frame resolves into the Plangolin sheet.

Narration: “You just approved six hundred words. But the decision hiding inside them looked like this.”

The word count must be replaced with the real count from the captured plan. If the plan is not close to six hundred words, the narration should say “a wall of text” instead of using a number.

### 2. Establish the map — 0:08–0:22

Show the finished system diagram rather than the complete rendering wait. Existing components appear solid. Proposed additions and connections appear dashed. The review panel is already open on the first proposal.

Narration: “Plangolin reads the plan against the system you already have. Solid exists. Dashed is what Claude wants to change.”

Use brief labels only where needed. Do not pause for a separate visual-grammar lecture.

### 3. Reveal the architectural mistake — 0:22–0:39

Advance to a proposed persistent counter store or SQL table. Dim the rest of the system while keeping the existing Redis block visible as context. The proposal's real Plangolin description and source-plan disclosure remain legible.

Narration: “Here, Claude wants a new persistent store for rate-limit counters. But this project already runs Redis.”

The exact proposed block depends on a real captured plan. The video must not fabricate a proposal that Plangolin did not produce.

### 4. Make the decision — 0:39–0:53

Press **Cut** on the unwanted proposal. Step through one or two related proposals with **Keep** or keyboard shortcuts, then arrive at the real summary showing how many proposals were kept and cut. Press **Approve**.

Narration: “So I cut the extra store, keep the rest, and approve the shape.”

There is no typed rejection-reason field. The video uses only controls that exist in the current product.

### 5. Show what Claude receives — 0:53–1:11

Transition from the diagram into the literal Markdown review brief returned by Plangolin. Emphasize the real headings and the rejected item beneath:

- `BUILD`
- `UPDATE`
- `OUT OF SCOPE — the user removed these. Do not build them.`
- `DO NOT TOUCH`

Narration: “Plangolin turns that click into an instruction Claude has to read: this is out of scope; do not build it. Everything untouched is named too.”

Use the exact output from the recorded run. Do not substitute a synthetic `constraint:` line.

### 6. Close the loop — 1:11–1:25

Briefly return to Claude continuing with the reviewed brief. Then show the four-step mechanism as a compact animated sequence:

`plan text → structural diagram → your decisions → agent instructions`

Narration: “The plan becomes a diagram. Your decisions become instructions. Claude continues with the system you actually approved.”

Do not imply that Plangolin itself produces a completed diff or automatically rewrites Claude's plan.

### 7. End card — 1:25–1:32

Show the Plangolin mark, wordmark, product line, and install commands:

```text
/plugin marketplace add jakekeech/plangolin
/plugin install plangolin
/reload-plugins
```

Narration: “Approve the shape, not the wall of text.”

Hold the final card silently for at least two seconds.

## Transition and Motion Direction

The central transition is a semantic morph: lines of plan text contract into the lines and blocks of the system diagram. It should feel like complexity resolving into structure, not like a generic wipe or logo sting.

Subsequent transitions should preserve spatial continuity: zoom from the full map into the contested proposal, follow the Cut action into the summary, and transform the summary into the returned Markdown brief. Avoid jump cuts between unrelated full-screen layouts.

## Visual Identity

The video inherits the product's current visual identity from the real interface: warm off-white canvas, black typography, muted teal accents, dotted drafting grid, solid existing blocks, and dashed proposals. Typography, spacing, and the Plangolin mark should be taken from the app rather than recreated with generic defaults.

The live terminal should remain visually authentic. The transition may stylize its text, but the plan and prompt shown before the morph must come from a real run.

## Required Capture Artifacts

- The terminal frame used at the end of the live skit
- A real Claude plan for adding API rate limiting to a project that already uses Redis
- The corresponding Plangolin review with a genuinely contestable proposed block
- The actual summary counts after the proposal is cut
- The literal Markdown review brief returned after approval
- A short capture of Claude continuing after receiving the brief

If the real run proposes no redundant persistent store, use another genuine architectural disagreement rather than staging a false UI state.

## Audio

Narration should be calm and dry, matching the skit's understated joke. Use a subtle pulse or restrained percussive bed only after the terminal-to-diagram morph. Product clicks may be lightly emphasized. Avoid trailer-style impacts, comedy stings, or continuous energetic music that competes with the interface.

## Acceptance Criteria

- The video begins seamlessly from the live skit's final terminal frame.
- Runtime is between 85 and 95 seconds.
- Every shown interaction exists in the current Plangolin UI.
- Every plan, proposal, count, and returned instruction is taken from a real recorded run.
- The audience can explain the product loop after one viewing.
- The unwanted architectural proposal is visually obvious before it is cut.
- The returned `OUT OF SCOPE` instruction is held long enough to read.
- The end card includes `/reload-plugins`, which the current README says is required.
- No performance or usage statistic is shown without measurement and context.
