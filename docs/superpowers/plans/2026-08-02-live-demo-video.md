# Plangolin Live Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished 85–95 second, 1920×1080 HyperFrames video that picks up from the live Claude skit, demonstrates Plangolin's real Cut/Keep/Approve loop, and ends with accurate installation instructions.

**Architecture:** A standalone `demo-video/` HyperFrames project owns the composition, narration script, design tokens, and media. One root HTML composition contains seven timed scenes so the terminal-to-diagram morph and camera moves share a single deterministic GSAP timeline; recorded or generated audio lives on separate tracks. The product's existing screenshot and UI styling provide the visual source of truth, while literal plan-review copy is derived from the current product implementation.

**Tech Stack:** HyperFrames CLI, HTML/CSS, GSAP 3.14.2, MP4/H.264 at 30fps, WAV/MP3 audio, existing Plangolin app assets.

## Global Constraints

- Runtime must be between 85 and 95 seconds.
- Canvas must be 1920×1080 in 16:9.
- The opening must continue directly from the live skit's terminal frame.
- The UI must use the existing warm off-white, black, muted-teal, dotted-grid Plangolin identity.
- Every interaction shown must exist in the current Cut/Keep/Approve UI.
- Returned agent instructions must use the literal `BUILD`, `UPDATE`, `OUT OF SCOPE — the user removed these. Do not build them.`, and `DO NOT TOUCH` format.
- Typing sounds, cursor movement, clicks, and camera zooms must synchronize with visible action.
- No infinite GSAP repeats, nondeterministic animation, jump cuts, fabricated reason field, synthetic `constraint:` line, or unmeasured performance statistic.

---

### Task 1: Scaffold the HyperFrames project and lock the production copy

**Files:**
- Create: `demo-video/DESIGN.md`
- Create: `demo-video/SCRIPT.md`
- Create: `demo-video/narration.txt`
- Create: `demo-video/index.html`
- Create: `demo-video/assets/claude-plan.txt`
- Copy: `screenshot.png` → `demo-video/assets/plangolin-review.png`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-02-live-demo-video-design.md`, `README.md`, `screenshot.png`, and the literal format in `src/plan-brief.js`.
- Produces: a valid HyperFrames project with final scene copy and product-derived design tokens for all later tasks.

- [ ] **Step 1: Run the environment preflight**

Run:

```bash
node --version
ffmpeg -version
npx hyperframes doctor
```

Expected: Node 22 or newer, FFmpeg available, and HyperFrames reporting a usable browser.

- [ ] **Step 2: Scaffold the project**

Run:

```bash
npx hyperframes init demo-video --non-interactive
```

Expected: `demo-video/index.html` and HyperFrames project metadata are created without an interactive prompt.

- [ ] **Step 3: Write the visual identity**

Create `demo-video/DESIGN.md` with the product-derived rules:

```markdown
# Plangolin Demo Visual Identity

## Style Prompt
Editorial technical drafting sheet: warm off-white paper, near-black type, muted teal decisions, faint dotted grid, precise solid and dashed architecture blocks, restrained terminal chrome, and generous negative space. Motion resolves complexity into structure through purposeful camera moves rather than decorative spectacle.

## Colors
- Canvas: #f7f6f2
- Ink: #1d1f1d
- Muted ink: #747875
- Decision teal: #2f7f7a
- Grid: #d9d9d3
- Terminal: #171918

## Typography
- Interface and headlines: Arial, Helvetica, sans-serif
- Terminal and data: SFMono-Regular, Consolas, monospace

## Motion
- Short eased zooms land on readable hero frames.
- Cursor pauses before every click.
- Text compresses into graph geometry during the opening morph.

## What NOT to Do
- No gradients, neon glow, glassmorphism, or generic blue SaaS styling.
- No handheld camera simulation or continuous drifting.
- No animation that obscures authentic UI labels.
- No trailer impacts or comedy stings.
```

- [ ] **Step 4: Write final spoken and on-screen copy**

Create `demo-video/SCRIPT.md` with the seven approved beats and exact narration from the design spec. Use “a wall of text” in the opening unless `demo-video/assets/claude-plan.txt` measures between 500 and 700 words. Include the three installation commands, including `/reload-plugins`. Create `demo-video/narration.txt` containing only these spoken lines, separated by blank lines:

```text
You just approved a wall of text. But the decision hiding inside it looked like this.

Plangolin reads the plan against the system you already have. Solid exists. Dashed is what Claude wants to change.

Here, Claude wants a new persistent store for rate-limit counters. But this project already runs Redis.

So I cut the extra store, keep the rest, and approve the shape.

Plangolin turns that click into an instruction Claude has to read: this is out of scope; do not build it. Everything untouched is named too.

The plan becomes a diagram. Your decisions become instructions. Claude continues with the system you actually approved.

Approve the shape, not the wall of text.
```

- [ ] **Step 5: Create the source plan and product still**

Write a concrete rate-limiting plan to `demo-video/assets/claude-plan.txt` whose structural proposal includes a persistent SQL counter store even though Redis exists. Copy `screenshot.png` to `demo-video/assets/plangolin-review.png`. The screen must be presented as a demonstration scenario, not claimed as performance evidence.

- [ ] **Step 6: Verify scaffolding and copy**

Run:

```bash
test -s demo-video/DESIGN.md
test -s demo-video/SCRIPT.md
test -s demo-video/assets/claude-plan.txt
test -s demo-video/assets/plangolin-review.png
rg -n "reload-plugins|OUT OF SCOPE|DO NOT TOUCH" demo-video/SCRIPT.md
npx hyperframes lint demo-video
```

Expected: all files are non-empty, all three required strings are found, and lint finds no errors.

- [ ] **Step 7: Commit the scaffold**

```bash
git add demo-video
git commit -m "feat: scaffold Plangolin demo video"
```

---

### Task 2: Build the seven-scene silent animatic

**Files:**
- Modify: `demo-video/index.html`
- Create: `demo-video/scripts/check-timeline.mjs`

**Interfaces:**
- Consumes: design tokens and fixed copy from Task 1.
- Produces: `window.__timelines["plangolin-live-demo"]`, a 92-second deterministic root timeline, and a script that verifies scene boundaries and required UI copy.

- [ ] **Step 1: Write the timeline contract check**

Create `demo-video/scripts/check-timeline.mjs` to read `index.html` and fail unless it finds:

```js
const required = [
  'data-composition-id="plangolin-live-demo"',
  'data-width="1920"',
  'data-height="1080"',
  'data-duration="92"',
  'window.__timelines["plangolin-live-demo"]',
  'OUT OF SCOPE',
  'DO NOT TOUCH',
  '/reload-plugins',
];
```

It must also reject `Math.random`, `repeat: -1`, and animation of `display` or `visibility`.

- [ ] **Step 2: Run the contract check and confirm failure**

Run:

```bash
node demo-video/scripts/check-timeline.mjs
```

Expected: FAIL because the composition has not yet been authored.

- [ ] **Step 3: Build static hero frames for all scenes**

Replace `demo-video/index.html` with a standalone composition using `data-composition-id="plangolin-live-demo"`, `data-start="0"`, `data-duration="92"`, `data-width="1920"`, `data-height="1080"`, and `data-track-index="0"`. Add seven full-canvas flex scenes at 0, 8, 22, 39, 53, 71, and 85 seconds. Build each scene in its most-visible final layout before adding GSAP entrances.

- [ ] **Step 4: Add deterministic entrance motion and transitions**

Register one paused GSAP timeline as `window.__timelines["plangolin-live-demo"]`. Give every scene element a `gsap.from()` entrance, with transitions at 8, 22, 39, 53, 71, and 85 seconds. Use no exit animation before a transition; only the final end card may fade out.

- [ ] **Step 5: Add the terminal-to-diagram morph and camera choreography**

Animate terminal plan lines toward seeded graph coordinates, crossfade those line fragments into wires and blocks, and land on the complete diagram. Add short `power3.inOut` or `expo.inOut` camera moves for Redis, the proposed store, Cut, summary, and the returned brief. Keep the final scale at or below 1.7 so labels remain readable.

- [ ] **Step 6: Add cursor choreography**

Animate a cursor along explicit keyframes. Pause 0.2–0.35 seconds before **Cut**, **Keep**, and **Approve**; add a 0.18-second click ring at each click; keep it clear of narration captions.

- [ ] **Step 7: Verify and render the first checkpoint**

Run:

```bash
node demo-video/scripts/check-timeline.mjs
npx hyperframes lint demo-video
npx hyperframes validate demo-video
npx hyperframes inspect demo-video --samples 15
npx hyperframes render demo-video --quality draft --output demo-video/renders/animatic.mp4
```

Expected: contract, lint, validation, and inspection pass; `animatic.mp4` is 92 seconds at 1920×1080.

- [ ] **Step 8: Commit the animatic**

```bash
git add demo-video/index.html demo-video/scripts/check-timeline.mjs
git commit -m "feat: animate Plangolin demo story"
```

---

### Task 3: Add narration, typing, UI sounds, and the mix

**Files:**
- Create: `demo-video/assets/narration.wav`
- Create: `demo-video/assets/typing.wav`
- Create: `demo-video/assets/click-cut.wav`
- Create: `demo-video/assets/click-keep.wav`
- Create: `demo-video/assets/click-approve.wav`
- Create: `demo-video/assets/drafting.wav`
- Create: `demo-video/assets/confirm.wav`
- Modify: `demo-video/index.html`

**Interfaces:**
- Consumes: the 92-second visual timeline and final narration from Tasks 1–2.
- Produces: separately timed audio clips on non-overlapping HyperFrames tracks, with narration remaining intelligible over effects.

- [ ] **Step 1: Generate calm narration**

Run:

```bash
npx hyperframes tts demo-video/narration.txt --voice af_nova --output demo-video/assets/narration.wav
```

Expected: a calm English narration WAV with all seven lines in order.

- [ ] **Step 2: Create restrained effects**

Create `demo-video/scripts/generate-sfx.sh` using FFmpeg's built-in `anoisesrc` and `sine` sources so every effect is locally generated and license-safe. The script must create:

```text
typing.wav        4.0s, filtered brown-noise key texture with a 12 Hz tremolo gate
click-cut.wav     0.12s, 620 Hz sine click
click-keep.wav    0.12s, 760 Hz sine click
click-approve.wav 0.18s, 520 Hz + 780 Hz confirmation dyad
drafting.wav      1.4s, high-passed brown-noise paper stroke
confirm.wav       0.6s, 440 Hz + 660 Hz soft confirmation dyad
```

Apply an `alimiter=limit=0.5` filter to every file so peaks remain below -6 dBFS. Run the script and verify the six WAV files with:

```bash
for f in typing click-cut click-keep click-approve drafting confirm; do
  ffprobe -v error -show_entries format=duration -of csv=p=0 "demo-video/assets/$f.wav"
done
```

- [ ] **Step 3: Add separate audio tracks**

Add each clip as its own `<audio>` element with `data-start`, `data-duration`, `data-track-index`, and `data-volume`. Start typing only while terminal text visibly changes; align click transients with cursor contact; align drafting with dashed geometry; align confirmation with `OUT OF SCOPE`.

- [ ] **Step 4: Render the sound checkpoint**

Run:

```bash
npx hyperframes lint demo-video
npx hyperframes validate demo-video
npx hyperframes render demo-video --quality draft --output demo-video/renders/sound-pass.mp4
```

Expected: no overlapping same-track clips, narration stays clear, and all effects match visible action.

- [ ] **Step 5: Commit the sound pass**

```bash
git add demo-video/index.html demo-video/assets demo-video/SCRIPT.md
git commit -m "feat: add narration and synchronized demo audio"
```

---

### Task 4: Final visual QA and delivery render

**Files:**
- Modify: `demo-video/index.html`
- Create: `demo-video/renders/plangolin-live-demo.mp4`

**Interfaces:**
- Consumes: the complete visual and audio composition.
- Produces: the final stage-ready MP4 and a local HyperFrames Studio preview URL.

- [ ] **Step 1: Inspect all hero frames**

Run:

```bash
npx hyperframes inspect demo-video --at 2,10,26,42,56,75,88 --strict
npx hyperframes validate demo-video
```

Expected: no text overflow, canvas escape, clipping, or contrast failures at each narrative hero frame.

- [ ] **Step 2: Preview full playback**

Run:

```bash
npx hyperframes preview demo-video --port 3017
```

Review `http://localhost:3017/#project/demo-video` for transition continuity, readable zoom landings, cursor timing, audio sync, and a silent two-second end-card hold.

- [ ] **Step 3: Render the high-quality master**

Run:

```bash
npx hyperframes render demo-video --fps 30 --quality high --strict --output demo-video/renders/plangolin-live-demo.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 demo-video/renders/plangolin-live-demo.mp4
```

Expected: MP4 renders successfully and reported duration is between 85 and 95 seconds.

- [ ] **Step 4: Run final verification**

Run:

```bash
node demo-video/scripts/check-timeline.mjs
npx hyperframes lint demo-video
npx hyperframes validate demo-video
npx hyperframes inspect demo-video --samples 15 --strict
git diff --check
```

Expected: every command exits successfully with no errors or warnings.

- [ ] **Step 5: Commit the final composition**

```bash
git add demo-video
git commit -m "feat: finish Plangolin live demo video"
```
