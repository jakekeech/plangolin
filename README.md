# plangolin

**Approve the shape, not the wall of text.**

An AI's plan is six hundred words, and almost all of them are *how* — which file,
which function, what order. Very little of it says what changes about the shape
of your system, which is the part you actually need to agree to. So people skim
it and press accept.

plangolin draws that part. Before any code is written, the plan arrives on a
diagram: the blocks it would add, the lines between them, and a count of how many
steps change nothing structural at all — the part you are entitled to skim.
Cross out what you did not ask for, and what you removed goes back as an
instruction rather than as silence.

The diagram is a file beside your code rather than something rotting in a Slack
thread, so it is still there next time, and still true.

![plangolin](screenshot.png)

*A plan to add rate limiting to Express, drawn against Express's own code. The
two dashed blocks and the dashed line are what the plan would add; the solid
ones already exist. Three of its eight steps change nothing structural, and it
says so — those are the ones you can skim.*

---

## Try it

In Claude Code:

```
/plugin marketplace add jakekeech/plangolin
/plugin install plangolin
```

Then, in any project:

```
/plangolin "add rate limiting to the API"
```

Claude plans it the way it normally would. Before any code is written the plan
arrives on your sheet — the blocks it would add drawn dashed, the lines between
them, and a count of how many steps change nothing structural at all. Cross out
what you did not ask for, press **Approve**, and Claude carries on with what you
agreed to, plus an explicit list of what you removed.

To open a sheet on its own, without Claude:

```bash
cd ~/wherever-you-want-a-sheet
npx plangolin
```

To build a sheet from a description you need an API key. Put **one** of
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in a `.env` file **in
the directory you run from**, or export it in your shell. Without a key
everything else still works — you just start from an empty sheet and build by
hand.

| | |
|---|---|
| Stop it | `Ctrl-C`, or `pkill -f plangolin` |
| Another port | `PORT=5000 plangolin` |
| No browser | `plangolin --no-open` |
| Start over | delete the `plangolin/` folder it made |

---

## What happens when you use it

**1. It asks what you're building.** One sentence — *"a marketplace for
secondhand textbooks between students"*.

**2. Blocks appear, one at a time.** A web app. A database. A line between them.
It stops at two or three. **It does not give you everything**, and that is the
entire point — see below.

**3. The rail on the right fills with what's missing.**

> **RISK** — "Student Marketplace" talks straight to "Listing Database"
> *That means the database password ships to every visitor's browser. Put
> something you run in between.*
>
> **MISSING** — You mention money, but nothing takes it → `Add payments`
>
> **WORTH ADDING** — Search gets slow before you expect it to

**4. You accept the ones you want.** Each button adds the block already wired up.
Hover a check and a line runs from it to the block it's about, circled in pen.

**5. It writes a file.** `plangolin/system.json` — yours, in your repo, in git.

---

## Reviewing a plan before it becomes code

A plan from an AI is six hundred words, and almost all of them are *how* —
which file, which function, what order. Very few say what changes about the
shape of your system, which is why people skim them and press accept.

Install the skill:

```
/plugin marketplace add jakekeech/plangolin
/plugin install plangolin
```

Then, in Claude Code:

```
/plangolin "a marketplace for secondhand textbooks between students"
```

Claude plans it however it normally would. When the plan is done, it arrives on
your sheet before it arrives in your codebase: the blocks it would add drawn
dashed, the lines it would draw between them, and a count of how many steps
change nothing structural at all — the part you are entitled to skim.

Cross out what you did not ask for. Press **Approve**, and Claude carries on
with what you agreed to — plus an explicit list of what you removed, so a
rejection survives as an instruction rather than as silence.

Greenfield or an existing repo, both work. An existing repo gets scanned first
so the plan is drawn against what is already there.

---

## The one idea to understand

**plangolin withholds things on purpose.**

The model is told outright: *don't add file storage to a photo app. Don't add
payments to a marketplace. Even when the description obviously implies them.*

That sounds broken. It isn't. If the generator hands you a finished system, the
review step has nothing to say and you've learned nothing — you have a diagram
you don't understand, which is exactly where every chat-based app builder leaves
you. **The gap is the product.** Every block you add after the first minute
arrives with a sentence explaining why it needs to exist.

---

## How it works

Four pieces, none of them clever.

### The document

Everything is two files in your repo:

```
plangolin/
  system.json    what the system is    — blocks, lines, what each one does
  layout.json    where the blocks sit  — coordinates, nothing else
```

**Split on purpose.** Positions change every time you nudge a block. In one file
that churn buries every architecture change and nobody reads the diff. Split, and
`system.json` diffs read like actual design decisions. Commit both.

Edit `system.json` by hand and reload — it just works. A block with no
coordinates gets placed for you.

**If the file won't parse, plangolin refuses to load and never overwrites it.** A
typo must not become data loss.

### One door for changes

Every change — dragging a block, accepting a suggestion, the generator, one day a
chat box — goes through a single function, `applyMove`. Sixteen kinds of move:
`addNode`, `connect`, `setIntent`, `setCollapsed`, and so on.

Handlers work on a *copy*; the real document is swapped in only once the move
validates, so a bad move can never leave things half-changed. Undo comes free —
⌘Z reverses a whole drag or a whole grouping, not one frame of it.

### Kinds, categories, traits

You type whatever you like in the **kind** field — "Postgres", "Supabase", "that
old PHP thing". Free text, always: the world has more things in it than any list.

Behind the scenes each kind is matched to a **category** (`store`, `blob`,
`payments`…), and each category implies **traits** — small yes/no facts the rules
actually care about:

| trait | the question behind it |
|---|---|
| `user-facing` | does a person touch this directly? |
| `persists` | does it keep data that survives a restart? |
| `we-run-it` | is this our code and our deploy? |
| `authorizes` | does it decide who's allowed? |
| `async` | does work happen later, rather than while someone waits? |

Traits are worked out fresh every time the file loads and **never saved**. Improve
the inference and every old file gets smarter; they can never contradict the
sentence you wrote.

An unrecognised kind gets no traits, so that block produces **fewer checks, never
a wrong one**. A confusing wrong warning costs far more trust than a missing
right one.

### The rules

Twenty rules, written as a table rather than as code. Each row says when it
fires, what it's called, why it matters, and what to do about it. **No rule
mentions a specific kind** — they ask about traits and categories, so one rule
covers cases nobody enumerated.

Adding a rule means adding a row.

Each rule needs two checks against it: one that it fires, and one that it **goes
quiet** once you've fixed the thing. The second matters more — a rule that never
shuts up gets ignored, and then so do all the others. The engine is pure
functions over a document and already exposed for this; writing them is the next
job.

### Grouping

A sheet stays small enough to read by folding away blocks that only ever serve
one other block — those are implementation details of that block, and the import
graph says which they are. Double-click to open one again.

A group isn't a new concept: **a block can simply contain other blocks**. Lines
into a folded group collapse into one, labelled "3 lines".

---

## Considerations

The limits below are deliberate. Each one is a decision with an alternative that
was rejected, and most of them are enforced in code rather than hoped for.

### Six blocks, and the cap is enforced

`MAX_BLOCKS = 6` in `src/generate.js`. The generator is *asked* to under-produce,
but asking a model nicely is not a constraint — so surplus `addNode` moves are
**dropped on the way in**, each with a logged reason:

```js
if (blocks >= MAX_BLOCKS) { dropped.push(`over the ${MAX_BLOCKS}-block cap: ${m.id}`); continue; }
```

Six is an editorial choice, and the justification it used to carry has been
checked and dropped. "About six is what anyone can hold in their head" traces to
Miller 1956, which explicitly disclaims that generalisation — he calls the
recurring seven "a pernicious, Pythagorean coincidence", and the passage people
quote is about dot patterns flashed for a fifth of a second. A diagram you are
looking at continuously is a search task, not a memory one.

Every published number for architecture diagrams is higher: expert-certified
ground truths have 11–67 clusters, Bouwers et al. derive an optimum of 8 across
106 industrial systems, and Störrle's UML study recommends 30–60 elements. So
the cap is kept because a small sheet forces one story per view and lays out
cleanly without crossings — an editorial and engineering choice, not a cognitive
limit.

**The cap is on what's *on the sheet*, not on how big a system can be.** Once a
group is folded it counts as one block, so a system can grow without bound while
the sheet stays readable.

### Grouping is what happens instead of refusing

Past six blocks the `crowded` check fires (`c.onSheet.length > 6`) and offers to
fold away the blocks that serve exactly one other block. The scan applies the
same rule itself — see `src/fold.js`. Double-click reopens a fold.

The alternative was to hard-limit the canvas. That trades a readable sheet for an
unusable product the moment someone models something real. Folding keeps both.

A group is deliberately **not a new concept**: a block can contain other blocks,
so grouping inherits intent, kind, lines and checks with no special cases. Lines
into a folded group collapse into one, labelled with the count.

### Free text in, closed set out

`kind` is free text forever — the world has more things in it than any enum. The
closed set lives one level down, in **traits**, because traits are bounded by the
questions the rules ask rather than by the world. A trait no rule uses would do
nothing, so the list cannot be "missing an option."

### Silence is the failure mode, not noise

An unrecognised kind gets no traits, and rules that key off traits simply don't
fire. A block plangolin doesn't understand makes it **quieter, never wrong**.

For someone who has never designed a system, a confident wrong warning costs far
more trust than a missing right one — and once one check is noise, the rest get
ignored with it.

### Nothing is stored that can be computed

Traits are derived on every load and written nowhere. Improve the inference and
every existing sheet gets better on next open; change a sentence and the traits
follow. A drift-detection tool that cached stale state would be self-defeating.

### One-shot generation, no regenerate button

The opening sentence seeds the sheet once and is then kept only as a description.
There is no *regenerate*, because re-running would destroy an hour of someone's
editing. Growth goes through the plan check instead, one accepted suggestion at a
time — reusing machinery that already exists.

### It writes no code, on purpose

The point of this version was to live with the file format and find out what's
wrong with it *before* anything expensive depends on it. Contracts, scaffolding
and drift detection all sit downstream of a schema that hasn't been stress-tested
yet.

---

## What's built

| | |
|---|---|
| Canvas — place, move, connect, pan, group, collapse | ✅ |
| Two-file schema: load, validate, repair, save | ✅ |
| One door for changes, with undo | ✅ |
| 20 trait-driven rules | ✅ |
| Scan a real codebase into a graph | ✅ |
| Report what changed since the last read | ✅ |
| Review a plan before it becomes code | ✅ |
| 314 automated tests | ✅ |
| Build a starting sheet from one sentence | ✅ |
| **Writing any code** | ❌ not yet |

**plangolin does not write code today.** The "generator" generates blocks and
lines, not files. That's deliberate: the point of this version was to live with
the file format and find out what's wrong with it before anything expensive
depends on it.

---

## What's next

One thing unblocks everything else.

**Typed operations.** When you draw a line you can already name the calls that
cross it — but only as loose text (`sends: "caption, file"`). Nothing can compile
that. Replacing it with light structure, shown as a small form so you never type
TypeScript, unlocks:

1. **Contracts** — lines compile to real interfaces in `src/contracts/`
2. **Scaffolding** — each block gets a folder to live in
3. **Agent hand-off** — your coding agent gets the sentence *and* the contract it
   isn't allowed to break
4. **Drift detection** — the payoff

That last one is what makes this different from a diagram tool. **plangolin never
writes your implementations.** It writes the contracts; an agent writes the code
behind them. So when you change the canvas, the contract regenerates and **the
build breaks in exactly the places that need attention.** Not "your diagram is
out of date" — `line 42 doesn't return what you said it would`. The compiler
becomes the drift detector: free, precise, and the best possible error message
for someone still learning.

Also open: the mascot (a pangolin — overlapping plates, and it rolls into a ball,
which is what a collapsing group does), and nothing yet says what the *produced
app* should look like.

---

## Layout

```
src/cli.js         starts the server, opens a browser
src/server.js      serves the app; GET/PUT /api/doc, POST /api/generate
src/workspace.js   the only file that touches the filesystem
src/schema.js      load, validate, repair, save
src/generate.js    the prompt, and turning a reply into moves
src/env.js         reads .env
app/               the canvas — one html, one css, one js
skills/            the /plangolin skill Claude Code reads
test/              node --test, no framework
```

**No dependencies.** Node's own `http` and `fs`; the font is embedded in the CSS.
Node 20+.

Your description is sent to the model when you press *Build it*. Nothing else
leaves the machine — no account, no sync, no telemetry.

---
