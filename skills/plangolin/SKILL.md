---
name: plangolin
description: Use when the user runs /plangolin with something they want to build or change, and whenever a plan or design has just been written and has not yet been reviewed as a system diagram. Plans the work the normal way, then draws what that plan would do to the shape of the system so the user can accept or reject each part before any code is written.
---

# plangolin

A plan is mostly *how* — which file, which function, what order. Very little of
it says what changes about the **shape** of the system, which is the part
someone actually needs to agree to. This skill puts that part on a diagram
before any code is written.

## What to do

**0. If no request came with the command, ask for one and stop.**

`/plangolin` on its own carries no task. Ask what the user wants to build or
change, and wait. **Read nothing first** — not the codebase, not the git log.
Exploring before you know the request spends time and context on questions
nobody asked, and the answer will send you somewhere else anyway.

One sentence is enough to start: *"a marketplace for secondhand textbooks"* or
*"add rate limiting to the API"*.

**1. Start preparing the system map.**

Run this before reading code or planning:

```bash
plangolin prepare
```

It starts project-map preparation and returns immediately. Continue planning;
do not wait for it. If `plangolin` is not on the PATH, use the copy installed
with this plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" prepare
```

If preparation is unavailable or fails, continue with a cold review as the
product supports.

**2. Plan it the way you normally would.**

Read the code first if there is any. Write the plan you would have written
anyway — same depth, same judgement. Do not write a thinner plan because
plangolin is involved.

**Write no code and change no files yet.** The whole point is that the user
sees the shape before anything is built.

**Ask at most one clarifying question, and only if you cannot plan without
it.** Prefer choosing a sensible default and naming it in the plan as a
decision the user can reverse.

This is a real limit, not a style note. The user typed one sentence and is
waiting for a diagram; a run of questions before they have seen anything is
not what they asked for. Worse, the questions that feel most worth asking —
*in-memory or Redis? per-route or per-IP?* — are questions about the **shape of
the system**, and that is exactly what the diagram is about to ask them in a
form they can actually judge. Settle shape at the diagram, not before it: ask
it twice and the two answers can contradict each other, which is a thing that
has actually happened.

Ask only about things a diagram cannot show — a constraint you have no way to
observe, or a goal the request is genuinely ambiguous about.

**3. Save the plan to a file.**

Write it as markdown. `plangolin/PLAN.md` in the project is a good default. If
you have already written the plan to a file — a spec, a plan document — use
that path and do not write it twice.

**4. Tell the user where to look, then run the review and wait for it.**

Say this first, on its own line, before you run anything:

> Open **http://localhost:4300** to review the plan.

That matters more than it looks. The command prints the link itself, but on
stderr — and this harness does not show a running command's output, so the link
does not appear until the command has finished, which is exactly when it stops
being useful. You saying it first is the only way the reader gets it in time.

The port is 4300 unless something already holds it, in which case the command
walks upward and prints the real one when it finishes.

```bash
plangolin review plangolin/PLAN.md
```

If `plangolin` is not on the PATH, this skill was installed as a plugin and
carries its own copy — run that instead:

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" review plangolin/PLAN.md
```

This opens the user's browser and **blocks until they have decided**, which may
take a few minutes. That is expected. Do not run it in the background, do not
poll it, and do not carry on while it runs.

If the command is not found, tell the user plangolin is not installed and offer
to continue without the review rather than stopping.

**5. Do what it says.**

It prints the agreed scope. Read it carefully:

- **BUILD** — accepted structural additions and new connections
- **REMOVE** — accepted component removals and disconnections
- **UPDATE RESPONSIBILITY** — accepted changes to existing component roles
- **INTERNAL WORK** — accepted internal changes, grouped by component
- **SUPPORTING WORK** — accepted support changes, grouped by component or
  project
- **OUT OF SCOPE** — every rejected impact with its original steps. **Do not
  build these.** This is the most important section: it makes every rejection
  a continuing instruction rather than an absence of discussion.
- **NEEDS REVIEW** — accepted unresolved steps. Confirm the intended component
  before inferring missing scope.
- **DO NOT TOUCH** — unaffected existing components; preserve their current
  behavior

**These constraints hold for the rest of the session, not just the next
message.** If, forty turns into the implementation, something in OUT OF SCOPE
starts to look necessary, say so and ask — never quietly build it.

If it says the review was skipped or not completed in time, proceed with the
plan as written. That is a real answer, not a failure.

**6. Revise and present.**

Rewrite the plan so it matches what was agreed, then present it for approval
the way you normally would.

## When the system map is empty

A brand-new project has no diagram yet, so every part of the plan will appear
as something to add. That is correct and needs no special handling.
