// What Claude gets back. Built from the accepted set by arithmetic — there is
// no model in the return path, on purpose.
//
// A second model call here would be the one place in the product where the
// output is neither the user's words nor a fact about their code, and it
// would be reached at the exact moment the user has finished deciding. The
// decisions are already made; writing them down is not a judgement call.
//
// Markdown rather than JSON because the consumer is a language model reading
// prose, and because OUT OF SCOPE has to read as an instruction. A rejected
// item in a JSON array is a value; the same item under a heading that says
// "Do not build them" is a rule.

import { trim } from "./describe.js";

const CITE_CHARS = 80;

/* The key a proposal is accepted or rejected by. `planKey` in app/app.js
   builds the same strings by hand — there is no build step for app/, so the
   browser cannot import this — and a key that does not match is read here as
   a rejection rather than an error. Change one and you must change the other:
   a drift turns every acceptance into a rejection and tells Claude to build
   nothing, with nothing anywhere reporting a problem. The literals are pinned
   in test/plan-brief.test.js. */
export function proposalKey(kind, a, b) {
  return kind === "edge" ? `edge:${a}>${b}` : `${kind}:${a}`;
}

export function buildBrief({ nodes, steps, delta, reach = [], accepted, remarks = new Map(), truncated = false }) {
  const names = new Map((nodes || []).map((n) => [n.id, n.name || n.id]));
  const d = {
    additions: delta.additions || [], touches: delta.touches || [],
    connections: delta.connections || [], unplaced: delta.unplaced || [],
  };
  const ok = (kind, a, b) => accepted.has(proposalKey(kind, a, b));
  for (const add of d.additions) names.set(add.id, add.name || add.id);

  /* The node list is whatever the browser held at Approve, which need not be
     the sheet the delta was validated against — the user can edit between the
     two. An id is a poor label, but "undefined — gains a check" is an
     instruction nothing can act on, and this is the one artefact Claude is
     held to. */
  const nameOf = (id) => names.get(id) || id;

  /* The plan is quoted, not numbered. These indices count headings, bullets
     and prose paragraphs — they are plangolin's own, not the plan's, so
     "step 12" lands on whatever the reading model happens to be counting and
     points at the wrong lines. Quoting is safe here in a way it is not in
     plan-delta.js: that rule stops the model inventing a citation, whereas
     this text is the user's own, read straight off the review. */
  const stepText = new Map((steps || []).map((s) => [s.n, s.text]));
  const cite = (nums) => nums.map((n) => {
    const text = trim(stepText.get(n) || "", CITE_CHARS);
    return text ? `from the plan: "${text}"` : `from plan step ${n}`;
  });

  const out = ["## Reviewed in plangolin", ""];

  const build = d.additions.filter((a) => ok("add", a.id));
  /* An edge survives only if both its ends do. Accepting a line while
     rejecting the block at its end used to print "build this line to Cache"
     three lines above "do not build Cache" — a brief that contradicts itself
     is worse than one that says less. Stated as "not a rejected addition"
     rather than "is on the sheet or accepted", so that a node missing from a
     stale posted sheet loses its name and not its line. */
  const refused = new Set(d.additions.filter((a) => !ok("add", a.id)).map((a) => a.id));
  const edges = d.connections.filter((c) => ok("edge", c.from, c.to) && !refused.has(c.from) && !refused.has(c.to));
  if (build.length || edges.length) {
    out.push("BUILD");
    for (const a of build) {
      out.push(`  ${a.name} — ${a.intent}`);
      if (a.dir) out.push(`    lives in: ${a.dir}`);
      if (a.files && a.files.length) {
        out.push("    files:");
        for (const file of a.files) out.push(`      ${file}`);
      }
      for (const c of edges.filter((e) => e.from === a.id || e.to === a.id)) {
        out.push(`    ${nameOf(c.from)} ──▶ ${nameOf(c.to)} (${c.label})`);
      }
      for (const line of cite(a.steps || [])) out.push(`    ${line}`);
      out.push("");
    }
    // A line between two blocks that already exist belongs to neither, so it
    // is never printed by the loop above and has to be listed on its own.
    const loose = edges.filter((e) => !build.some((a) => a.id === e.from || a.id === e.to));
    for (const c of loose) {
      out.push(`  ${nameOf(c.from)} ──▶ ${nameOf(c.to)} (${c.label})`);
      for (const line of cite(c.steps || [])) out.push(`    ${line}`);
      out.push("");
    }
  }

  const update = d.touches.filter((t) => ok("touch", t.id));
  if (update.length) {
    out.push("UPDATE");
    for (const t of update) {
      out.push(`  ${nameOf(t.id)} — ${t.why}`);
      for (const user of reach.filter((r) => r.via === t.id)) {
        out.push(`    Used by ${nameOf(user.id)} (${user.label})`);
      }
      for (const line of cite(t.steps || [])) out.push(`    ${line}`);
    }
    out.push("");
  }

  const cut = [
    ...d.additions.filter((a) => !ok("add", a.id)).map((a) => ({ key: proposalKey("add", a.id), line: `${a.name} — ${a.intent}` })),
    ...d.touches.filter((t) => !ok("touch", t.id)).map((t) => ({ key: proposalKey("touch", t.id), line: `${nameOf(t.id)} — ${t.why}` })),
    ...d.connections.filter((c) => !edges.includes(c))
      .map((c) => ({ key: proposalKey("edge", c.from, c.to), line: `${nameOf(c.from)} ──▶ ${nameOf(c.to)} (${c.label})` })),
  ];
  if (cut.length) {
    out.push("OUT OF SCOPE — the user removed these. Do not build them.");
    for (const item of cut) {
      out.push(`  ✗ ${item.line}`);
      const remark = String(remarks.get(item.key) || "").trim();
      if (remark) out.push(`    User's reason: ${remark}`);
    }
    out.push("");
  }

  // Every block the review left alone. Naming them is the difference between
  // "the plan did not mention Schema" and "do not touch Schema" — Claude can
  // only honour the second.
  const involved = new Set([
    ...build.map((a) => a.id), ...update.map((t) => t.id),
    ...edges.flatMap((c) => [c.from, c.to]),
  ]);
  const untouched = (nodes || []).filter((n) => !involved.has(n.id)).map((n) => n.name || n.id);
  if (untouched.length) out.push("DO NOT TOUCH", `  ${untouched.join(", ")}`, "");

  /* A count, not a list. The number is the point — it is what tells the reader
     how much of the plan it may take at face value — and the steps themselves
     are the complement of everything named above. Quoting fifty lines of the
     plan back at a reader who is holding the plan buys nothing. */
  const kept = new Set(d.unplaced.flatMap((u) => u.steps)).size;
  if (kept) {
    out.push(kept === 1
      ? "1 plan step changes nothing about the shape of the system — build it as written."
      : `${kept} plan steps change nothing about the shape of the system — build them as written.`);
  }

  if (!build.length && !edges.length && !update.length) {
    out.push("", "The user reviewed this plan and approved no change to the shape of the system. " +
      "Build it as written, and add no blocks or connections beyond what is already there.");
  }

  /* Last, and unconditional when it applies. Everything above reads as a
     ruling on the whole plan, and for a long document it is a ruling on the
     opening of it — a reader told nothing would take silence for coverage. */
  if (truncated && (steps || []).length) {
    out.push("", `Only the first ${steps.length} steps of this plan were reviewed in plangolin. ` +
      "Nothing above rules on what comes after them.");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
