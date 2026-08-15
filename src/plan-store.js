// The live review and its whole lifecycle: opened, filled in, decided.
//
// One review at a time, deliberately. A second plan arriving while somebody is
// mid-decision is refused rather than allowed to replace the first — pulling
// the sheet out from under a person reading it is worse than making the second
// caller wait, and "two reviews at once" would need a story about which one the
// browser is showing that nothing in this product wants to tell.
//
// `delta` and `scan` are injected into fill() so the failure path can be tested
// without a network. They default to the real ones.

import { splitSteps, stepCount } from "./plan-steps.js";
import { buildBrief } from "./plan-brief.js";
import { planDelta } from "./plan-delta.js";
import { planReach } from "./plan-reach.js";
import { load, save, docFromMoves } from "./schema.js";
import { adopt } from "./adopt.js";

let counter = 0;
const nextId = () => (++counter).toString(36) + Math.random().toString(36).slice(2, 6);

const decided = (r) => r.status === "resolved" || r.status === "skipped";

/** The caveat a truncated plan carries. `note` already exists, is already
    rendered by the panel, and is already where a caveat belongs — so the
    reader is told the review covers an opening rather than a document. */
const truncationNote = (r) =>
  r.truncated ? `This plan is longer than plangolin reads — only the first ${r.steps.length} steps were reviewed.` : "";

/** What the browser posts is a request body. A bad one has to fail the
    request and nothing else: a throw in here 500s the route without releasing
    the waiter, and the blocked command then sits out its full ten minutes. */
const sheetNodes = (nodes) =>
  (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n === "object" && typeof n.id === "string");

/** Write a cold-start scan to the sheet, unless somebody beat us to it.
 *
 *  This is not the thing "a review never writes to the sheet" forbids. That
 *  rule is about *proposals* — a ghost block or a dashed line must never reach
 *  disk before the user has accepted it, and none of them do. A scan is not a
 *  proposal: it is a description of code that is already there, it is what the
 *  browser was about to write a second later anyway, and writing it is the
 *  only way the sheet the user is looking at can be the sheet the brief
 *  describes. It also makes true what fill() already claims — the scan is paid
 *  for once, and every review after this one is free.
 *
 *  Re-reads before writing so the outcome is decided rather than raced: if a
 *  sheet exists by now, the first writer wins and this does nothing. Losing
 *  matters least of all here, because /api/adopt hands the browser these very
 *  moves — whoever writes, the blocks and lines are the same ones — and only
 *  the browser has the coordinates worth keeping. */
async function keepScan(ws, moves) {
  try {
    const scanned = docFromMoves(moves);
    // A scan that found nothing has nothing to say. Writing it would leave a
    // plangolin/ folder on a project that has no sheet and no reason for one.
    if (!scanned.nodes.length) return;
    const { doc } = await load(ws);
    if (doc.nodes.length) return;
    await save(ws, scanned);
  } catch { /* an unwritable project still gets its review */ }
}

export function createPlanStore() {
  let review = null;
  let waiters = [];
  /* The cold-start scan, offered to whoever asks next. See takeScan(). */
  let scanning = null;

  const release = (id, payload) => {
    const mine = waiters.filter((w) => w.id === id);
    waiters = waiters.filter((w) => w.id !== id);
    for (const w of mine) { clearTimeout(w.timer); w.resolve(payload); }
  };

  const store = {
    open({ plan }) {
      if (review && !decided(review)) return { busy: true, id: review.id };
      // A scan belongs to the review that requested it. Starting a new one
      // without this would let a still-lingering promise from the last
      // review — one nobody ever called takeScan() on — answer for this one.
      scanning = null;
      const steps = splitSteps(plan);
      review = {
        id: nextId(), status: "thinking",
        plan: String(plan || ""), steps,
        truncated: stepCount(plan) > steps.length,
        delta: { additions: [], touches: [], connections: [], unplaced: [] },
        reach: [], dropped: [], note: "", nodes: [],
      };
      review.note = truncationNote(review);
      return { id: review.id };
    },

    current() {
      return review;
    },

    /** The cold-start scan fill() is running or ran, or null. Read rather
        than taken: every caller for the life of this review — two tabs, a
        reload, a retry before anyone has decided anything — must be handed
        the *same* promise, or each runs its own scan and draws blocks with
        different ids for the same files. open() and resolve() are what end
        the offer, because a new "Scan again" is only unambiguous once this
        review is no longer the one asking — see the comments there.

        It settles only after the sheet has been written, which is what puts
        the browser's own save strictly after ours: it draws these blocks,
        places them, and persists the coordinates on top. */
    takeScan() {
      return scanning;
    },

    /** What the browser is actually shown. `current()` carries the whole
        review — nodes (the scanned list, full of intent and details text),
        the raw plan document, and dropped diagnostics — because resolve()
        and fill() need the whole thing. The panel reads five fields off it
        and none of the rest, so the route ships this instead: the store
        owns the shape of a review, and /api/plan shouldn't have to know
        which corner of it a panel happens to render. */
    forBrowser() {
      if (!review) return null;
      const { id, status, steps, delta, reach, note } = review;
      return { id, status, steps, delta, reach, note };
    },

    setDelta(id, { delta, reach, dropped, note }) {
      if (!review || review.id !== id || review.status !== "thinking") return false;
      review.delta = delta;
      review.reach = Array.isArray(reach) ? reach : [];
      review.dropped = dropped || [];
      // Two different caveats: the truncation notice is about the plan, a note
      // from fill() is about the model call. Both can be true at once and the
      // panel shows one line, so they are joined rather than one winning.
      review.note = [truncationNote(review), note].filter(Boolean).join(" ");
      review.status = "ready";
      return true;
    },

    /** Read the sheet, ask the model, fill the review in. Never throws: a dead
        model must leave a review somebody can still edit by hand. */
    async fill(ws, { delta = planDelta, scan = null } = {}) {
      if (!review || review.status !== "thinking") return;
      const id = review.id;

      let nodes = [], edges = [];
      try {
        const { doc } = await load(ws);
        nodes = doc.nodes;
        edges = doc.edges;
      } catch { /* an unreadable sheet is still reviewable */ }

      /* A plan reviewed against an empty sheet proposes a block for every
         sentence, because there is nothing for it to attach to — which is the
         opposite of the point. Scanning first costs about fifteen seconds and
         buys a review that can say "this touches the server" instead.

         The result is kept, and offered to the browser through takeScan(), for
         one reason: there must be exactly one scan. Two runs of the same model
         pipeline over the same repo do not agree — measured on `requests`,
         seven blocks against six, with different ids for the same files — and
         the brief is built from the delta's own graph, so a browser that
         scanned separately would be looking at blocks the brief has never
         heard of. One scan, one graph, one set of ids. */
      if (!nodes.length) {
        /* Assigned before the await so /api/adopt has something to find.
           Nothing in review-command awaits open(url) — it fires the browser
           and calls fill() in the same tick, so this is already running
           before a real browser could have loaded a page, read /api/doc, and
           asked for a scan of its own. */
        scanning = (async () => {
          const result = await (scan || adopt)(ws);
          await keepScan(ws, result.moves);
          return result;
        })();
        try {
          const scanned = docFromMoves((await scanning).moves);
          nodes = scanned.nodes;
          edges = scanned.edges;
        } catch { /* no scan, no sheet — the review still opens */ }
        // Left on offer even once settled — a later /api/adopt inside the
        // same review still gets this scan, not undefined. open() and
        // resolve() are what end the offer, because the offer belongs to
        // the review, not to the moment fill() happened to finish reading it.
      }

      /* Recorded whether they came from the sheet or from the scan above.
         These are the nodes the delta was computed against, and resolve()
         builds the brief from them — see the invariant there. */
      review.nodes = nodes;

      try {
        const out = await delta(nodes, review.steps);
        /* Reach means "existing callers may be affected by a changed block."
           A proposed line does not by itself change the contract of either
           endpoint, so treating both ends as changed made unrelated callers
           glow during connection steps. Explicit touches are the only plan
           facts that justify propagating impact through existing edges. */
        const changedIds = new Set(out.delta.touches.map((touch) => touch.id));
        store.setDelta(id, {
          delta: out.delta,
          reach: planReach(edges, changedIds),
          dropped: out.dropped,
        });
        if (out.dropped.length) console.warn("plangolin: plan dropped", out.dropped);
      } catch (err) {
        const steps = review.steps.map((s) => s.n);
        store.setDelta(id, {
          delta: { additions: [], touches: [], connections: [], unplaced: steps.length ? [{ steps, why: "not read" }] : [] },
          reach: [],
          dropped: [err.message],
          note: err.userFacing ? err.message : "Couldn't read this plan — review it by hand.",
        });
      }
    },

    resolve(id, { accepted, skipped, nodes }) {
      if (!review || review.id !== id || decided(review)) return false;
      /* Skipping is allowed at any point, including mid-spinner: somebody who
         gives up on a slow model would otherwise leave the blocked command
         waiting out its timeout, and a skip builds nothing that could be
         wrong. */
      if (skipped) {
        review.status = "skipped";
        scanning = null; // this review is over; its scan answers no one else
        release(id, { status: "skipped" });
        return true;
      }
      /* Approving while the model call is still out would build the brief from
         the empty placeholder — "approved no change to the shape of the
         system" — and then discard the real reply when it landed. A wrong
         brief with no error anywhere is the worst outcome here, so it waits. */
      if (review.status === "thinking") return false;

      /* THE INVARIANT: the brief must describe the same graph the delta
         described. `review.nodes` decides which blocks exist, always — the
         delta's ids are only meaningful against that list, and on a cold
         start the browser's sheet came from a *second* scan whose ids are
         nothing to do with it. Letting the caller's list decide membership
         printed raw slugs under UPDATE and put the block being updated under
         DO NOT TOUCH as well: a brief that contradicts itself, on the path
         the README advertises.

         The caller's list is still read for *names*, matched by id, because
         somebody may have renamed a block while the review was open and the
         newer name is the better label. Only when review.nodes is empty — a
         genuinely empty project with nothing to scan — does the caller's list
         stand in for it. */
      const posted = sheetNodes(nodes);
      const renamed = new Map(
        posted.filter((n) => typeof n.name === "string" && n.name.trim()).map((n) => [n.id, n.name]));
      const known = review.nodes || [];
      review.brief = buildBrief({
        nodes: known.length
          ? known.map((n) => (renamed.has(n.id) ? { ...n, name: renamed.get(n.id) } : n))
          : posted,
        steps: review.steps, delta: review.delta, truncated: !!review.truncated,
        reach: review.reach,
        accepted: new Set(Array.isArray(accepted) ? accepted : []),
      });
      review.status = "resolved";
      scanning = null; // this review is over; its scan answers no one else
      release(id, { status: "resolved", brief: review.brief });
      return true;
    },

    /** Held open, then answered `pending` so the caller can ask again. The
        command awaits this directly — same process — but a held response is
        also what a second entry point would need, and it costs nothing to be
        both. */
    wait(id, ms) {
      if (!review || review.id !== id) return Promise.resolve({ status: "gone" });
      if (review.status === "resolved") return Promise.resolve({ status: "resolved", brief: review.brief || "" });
      if (review.status === "skipped") return Promise.resolve({ status: "skipped" });

      return new Promise((resolve) => {
        const w = { id, resolve, timer: null };
        w.timer = setTimeout(() => {
          waiters = waiters.filter((x) => x !== w);
          resolve({ status: "pending" });
        }, ms);
        waiters.push(w);
      });
    },
  };

  return store;
}
