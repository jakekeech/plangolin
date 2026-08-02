// One model call: what would this plan do to the shape of this system?
//
// The same division of labour as describe.js. The system prompt and the schema
// live in the service; what is built here is the user prompt, because it is
// made of this project's own sheet and could not be built anywhere else. The
// service returns the model's JSON untouched and validate() below treats every
// field as untrusted.
//
// Two rules do most of the work, and both are refusals rather than repairs:
//
//   A step number outside the plan is dropped. The model is shown the text of
//   every step but may only cite steps by number, and a number outside the
//   list is not kept — so it cannot attribute a block to a sentence the user
//   did not write. Quoting is left to the brief, which does it from the user's
//   own text rather than from anything the model returned.
//
//   A block id that is neither on the sheet nor declared in the same reply is
//   dropped. A line has to run between two things that exist.

import { callTask } from "./llm.js";

const MAX_LABEL = 40;
const MAX_INTENT = 200;
const MAX_WHY = 200;
const MAX_FILES_SHOWN = 6;
const MAX_PLAN_FILES = 6;

const clean = (v, limit) => String(v || "").trim().slice(0, limit);

/** A folder we are willing to write down. Same rule as workspace.js: no
    absolute paths, no climbing out. A bad one costs the folder, never the
    block — the name and the intent are still worth showing.
    Drive letters are rejected rather than stripped: `C:/x` and `x` are not
    the same folder, and turning one into the other would print a path the
    reader could act on that nobody meant. */
function safeDir(dir) {
  const p = String(dir || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!p || /^[a-zA-Z]:/.test(p) || p.split("/").some((seg) => seg === "..")) return "";
  return p;
}

function safeFile(file) {
  if (typeof file !== "string") return "";
  const p = file.replace(/\\/g, "/").trim();
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("..")) return "";
  return p;
}

export function buildPrompt(nodes, steps) {
  const blocks = nodes.map((n) => {
    const files = n.anchor && Array.isArray(n.anchor.paths)
      ? n.anchor.paths.slice(0, MAX_FILES_SHOWN)
      : n.anchor && n.anchor.dir ? [n.anchor.dir + "/"] : [];
    return [
      `## ${n.id}`,
      `name: ${n.name || n.id}`,
      n.kind ? `kind: ${n.kind}` : "",
      n.intent ? `does: ${n.intent}` : "",
      files.length ? `owns: ${files.join(", ")}` : "owns: (no files yet)",
    ].filter(Boolean).join("\n");
  });

  return [
    "The system as it stands today:",
    "",
    blocks.length ? blocks.join("\n\n") : "(the sheet is empty — this project has no blocks yet)",
    "",
    "The plan, one numbered step per line:",
    "",
    steps.map((s) => `${s.n}. ${s.text}`).join("\n"),
  ].join("\n");
}

export function validate(parsed, nodeIds, stepCount) {
  const raw = parsed && typeof parsed === "object" ? parsed : {};
  const dropped = [];
  const arr = (v) => (Array.isArray(v) ? v : []);

  // Kept as an array rather than a Set of "seen": order is the order the model
  // returned, which tracks the order of the plan, which is the order the panel
  // should read in.
  const claimed = new Set();
  const steps = (list, what) => {
    const out = [];
    for (const s of arr(list)) {
      if (!Number.isInteger(s) || s < 1 || s > stepCount) { dropped.push(`${what}: no such step ${s}`); continue; }
      if (!out.includes(s)) out.push(s);
    }
    out.sort((a, b) => a - b);
    out.forEach((s) => claimed.add(s));
    return out;
  };

  const additions = [];
  const addedIds = new Set();
  for (const a of arr(raw.additions)) {
    if (!a || typeof a !== "object") { dropped.push("addition: not an object"); continue; }
    const id = String(a.id || "");
    if (!/^[a-z][a-z0-9-]*$/.test(id)) { dropped.push(`addition: bad id ${JSON.stringify(a.id)}`); continue; }
    if (nodeIds.has(id)) { dropped.push(`addition "${id}" is already on the sheet`); continue; }
    if (addedIds.has(id)) { dropped.push(`second addition for "${id}"`); continue; }
    const on = steps(a.steps, `addition "${id}"`);
    if (!on.length) { dropped.push(`addition "${id}" cites no plan step`); continue; }
    const files = [];
    if (a.files !== undefined && !Array.isArray(a.files)) {
      dropped.push(`addition "${id}" files: not an array`);
    }
    for (const rawFile of arr(a.files)) {
      const file = safeFile(rawFile);
      if (!file) {
        dropped.push(`addition "${id}" file: unsafe path ${JSON.stringify(rawFile)}`);
        continue;
      }
      if (files.length >= MAX_PLAN_FILES) {
        dropped.push(`addition "${id}" file: over the ${MAX_PLAN_FILES}-path limit ${JSON.stringify(rawFile)}`);
        continue;
      }
      files.push(file);
    }
    addedIds.add(id);
    additions.push({
      id, name: clean(a.name, 60) || id, kind: clean(a.kind, 40),
      intent: clean(a.intent, MAX_INTENT), dir: safeDir(a.dir), files, steps: on,
    });
  }

  const touches = [];
  const touched = new Set();
  for (const t of arr(raw.touches)) {
    if (!t || typeof t !== "object") { dropped.push("touch: not an object"); continue; }
    const id = String(t.id || "");
    // Deliberately existing blocks only. A block this reply is adding is
    // already fully described by its addition; calling it "touched" as well
    // would draw it twice in the panel.
    if (!nodeIds.has(id)) { dropped.push(`touch: unknown block: ${id}`); continue; }
    if (touched.has(id)) { dropped.push(`second touch for "${id}"`); continue; }
    const on = steps(t.steps, `touch "${id}"`);
    if (!on.length) { dropped.push(`touch "${id}" cites no plan step`); continue; }
    const size = t.size === "substantial" || t.size === "small" ? t.size : "small";
    if (size !== t.size) dropped.push(`touch "${id}" size: unsupported value ${JSON.stringify(t.size)}`);
    touched.add(id);
    touches.push({ id, why: clean(t.why, MAX_WHY), size, steps: on });
  }

  const connections = [];
  const pairs = new Set();
  const known = new Set([...nodeIds, ...addedIds]);
  for (const c of arr(raw.connections)) {
    if (!c || typeof c !== "object") { dropped.push("connection: not an object"); continue; }
    const from = String(c.from || ""), to = String(c.to || "");
    if (!known.has(from) || !known.has(to)) { dropped.push(`connection to an unknown block: ${from} → ${to}`); continue; }
    if (from === to) { dropped.push(`connection from "${from}" to itself`); continue; }
    const key = from + " " + to;
    if (pairs.has(key)) { dropped.push(`second connection for ${from} → ${to}`); continue; }
    const on = steps(c.steps, `connection ${from} → ${to}`);
    if (!on.length) { dropped.push(`connection ${from} → ${to} cites no plan step`); continue; }
    pairs.add(key);
    connections.push({ from, to, label: clean(c.label, MAX_LABEL) || "calls into", steps: on });
  }

  /* A step something structural already cited is not a step that changes
     nothing, whatever the model also says about it. The subtraction below
     stops the skim count shrinking; this stops it inflating, which is the
     failure that would have the brief calling a step "kept as written" while
     BUILD asks for it. Snapshotted before the loop so one unplaced entry
     cannot swallow a step a later one names too. */
  const structural = new Set(claimed);
  const unplaced = [];
  for (const u of arr(raw.unplaced)) {
    if (!u || typeof u !== "object") { dropped.push("unplaced: not an object"); continue; }
    const on = steps(u.steps, "unplaced").filter((s) => !structural.has(s));
    if (on.length) unplaced.push({ steps: on, why: clean(u.why, MAX_WHY) || "implementation detail" });
  }

  /* Every step nothing claimed. The panel tells the reader how many steps
     change no structure, and that number has to be arrived at by subtraction
     rather than taken from the model — a model that forgets to mention a step
     would otherwise silently shrink the count, and the one number in this
     product that says "you may skim these" would be the one number nothing
     checks. */
  const orphans = [];
  for (let n = 1; n <= stepCount; n++) if (!claimed.has(n)) orphans.push(n);
  if (orphans.length) unplaced.push({ steps: orphans, why: "not mentioned as changing the system" });

  return { delta: { additions, touches, connections, unplaced }, dropped };
}

export async function planDelta(nodes, steps) {
  if (!steps.length) {
    return { delta: { additions: [], touches: [], connections: [], unplaced: [] }, dropped: ["the plan had no steps"], provider: null, model: null };
  }
  const { parsed, provider, model } = await callTask({ task: "plan", prompt: buildPrompt(nodes, steps) });
  const ids = new Set(nodes.map((n) => n.id));
  const { delta, dropped } = validate(parsed, ids, steps.length);
  return { delta, dropped, provider, model };
}
