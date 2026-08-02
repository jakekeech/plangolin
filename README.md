# plangolin

**Approve the shape, not the wall of text.**

An AI's plan is six hundred words, and almost all of them are *how* — which
file, which function, what order. Very little says what changes about the shape
of your system, which is the part you actually need to agree to. So people skim
it and press accept.

plangolin draws that part. Before any code is written, the plan arrives on a
diagram: the blocks it would add, the lines between them, and a count of how
many steps change nothing structural at all — the part you are entitled to skim.

You step through one proposal at a time. Cross out what you did not ask for, and
what you removed goes back to the agent as an instruction rather than as
silence.

![plangolin](screenshot.png)

*A plan to add rate limiting to Express, drawn against Express's own code. One
proposal at a time: here, the line the plan would draw between two blocks it
would also add. What the step is about is lit; the rest of the system stays
visible but out of the way.*

---

## Install

In Claude Code:

```
/plugin marketplace add jakekeech/plangolin
/plugin install plangolin
/reload-plugins
```

`/reload-plugins` is not optional — a plugin's skills are read when the session
starts, so without it `/plangolin` will not exist until you open a new one. It
reports `0 skills` either way; that count only covers `commands/`, and the skill
still loaded.

Otherwise that is everything. The plugin carries the whole tool — there is
nothing to `npm install`, no API key to configure, and no build step.

## Use it

In any project:

```
/plangolin "add rate limiting to the API"
```

Claude plans it the way it normally would — reading your code, writing no files.
When the plan is ready it tells you where to look and waits:

```
Open http://localhost:4300 to review the plan.
```

Open that. Then:

| | |
|---|---|
| `←` `→` | step through the proposals, one at a time |
| `K` / `C` | keep or cut the one you are looking at |
| **?** top left | the request you started with |
| **drag the title bar** | move the panel; it settles into a corner |
| **▸ what the plan said** | the plan's own wording, to check a proposal against |

Cut what you did not ask for, step to the end, and press **Approve**. Claude
carries on with what survived — plus an explicit list of what you removed, so a
rejection survives as an instruction.

Nothing opens a browser tab at you. If you would rather it did:
`PLANGOLIN_OPEN=1`.

## What you are looking at

**Solid blocks** are the parts of your system that already exist, worked out by
reading every import in the project. **Dashed blocks and dashed lines** are what
the plan would add. A **travelling dash** shows which way a proposed line runs.

The block the current step is about is lit; everything else dims. It dims rather
than disappearing, because the rest of the system is what makes the lit part
mean anything.

The count at the end — *"3 plan steps change nothing about the shape of your
system"* — is the number the whole thing turns on. It says how much of a long
plan you can safely skim, and you can open it to check which steps those are.

## Opening a sheet on its own

The diagram is a file in your repo, and you can work on it without a plan:

```bash
npx plangolin
```

```
plangolin/
  system.json    what the system is    — blocks, lines, what each one does
  layout.json    where the blocks sit  — coordinates, nothing else
```

Split on purpose. Positions change every time you nudge a block; in one file
that churn buries every real change and nobody reads the diff. Commit both.

Blocks can be moved, renamed, connected, grouped and undone. On a project with
no sheet yet, the first run reads the code and draws one.

**If the file will not parse, plangolin refuses to load and never overwrites
it.** A typo must not become data loss.

## How the diagram gets drawn

Structure is computed, not guessed. Every import in the project is resolved
first, files are grouped by what they are for, and only then is a model asked
what to call the result. Blocks that serve exactly one other block are folded
inside it — the test is whether you can understand the parent without knowing
the child exists, and the import graph answers that.

A sheet stays small on purpose. Six or so blocks tells one story per view; the
cap is on what is *on screen*, not on how big a system can be, because a folded
group counts as one block.

## What is deliberately switched off

Two things are built and tested and currently turned off, because the product is
about reviewing plans and they competed for the same attention:

- a rail of design checks — *"this talks straight to the database"*
- a view of what changed in git since you last looked, with the diff a click away

`CHANGE_VIEW` at the top of `app/app.js` turns both back on.

## Layout

```
src/cli.js             plangolin, and plangolin review <file>
src/review-command.js  starts a review and waits for your answer
src/plan-steps.js      cuts a plan into numbered steps
src/plan-delta.js      asks what those steps do to the shape of the system
src/plan-brief.js      turns what you kept into what the agent is told
src/plan-store.js      one live review and everything that happens to it
src/filegraph.js       every reference in the project
src/cluster.js         which files belong in the same block
src/workspace.js       the only file that touches the filesystem
app/                   the canvas — one html, one css, one js
skills/plangolin/      what Claude does when you run /plangolin
test/                  node --test, no framework
```

**No dependencies and no build step.** Node's own `http` and `fs`; the font is
embedded in the CSS. Node 20+.

Your plan and a summary of your sheet are sent to plangolin's hosted service,
which holds the prompts and the model key so you do not need one. Your source
code is read locally and never leaves the machine.

```bash
npm test        # 338 tests
```
