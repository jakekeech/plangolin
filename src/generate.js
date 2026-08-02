// One prompt in, a list of moves out.
//
// The rules below are the whole design, and rule 3 is the load-bearing one: the
// generator must NOT be thorough. The plan check is the teaching surface, and a
// generator that pre-empts every check leaves it nothing to say. Step 0
// established that a model will hold that line.

import { pickProvider, callModel } from "./llm.js";

export { pickProvider };

export const MAX_BLOCKS = 6;

const SYSTEM = `You lay out the skeleton of a software system as blocks and lines.

You return MOVES. There are two:

  { "t": "addNode", "id": <slug>, "name": <short label>, "kind": <free text>, "intent": <one sentence>, "details": <deeper write-up> }
  { "t": "connect", "from": <node id>, "to": <node id>, "label": <two words> }

Field rules:
  id      lowercase slug, matches ^[a-z][a-z0-9-]*$, unique, referenced by connect
  name    two or three words, what a person would call it
  kind    whatever it actually is — "Postgres", "S3", "Stripe", "Next.js". Free text.
          Leave it "" if you genuinely don't know; do not invent a service.
  intent  ONE plain sentence, written the way you'd explain it to a friend who is
          new to this. Say what it does, not what it is. Never restate the name.
  details a few sentences or short bullet points going deeper than intent — what
          data it owns, the key operations it exposes, anything worth knowing
          before building it. Never restate the intent. Leave it terse for a
          simple block; go deeper only where the block actually carries
          complexity. "" is fine for a block with nothing more to say.
  label   two words for what crosses the line, e.g. "reads / writes", "puts / gets"

Unused fields come back as "" — every move carries every field.

HARD RULES

1. At most SIX addNode moves. Fewer is better. This is not a target.

2. Emit the SPINE ONLY — the blocks that are genuinely unavoidable given the
   description. Nothing else.

3. DELIBERATELY LEAVE GAPS. A separate review step teaches the user what they
   forgot, one thing at a time, with a reason. If you supply everything, that
   step has nothing to say and the product loses its purpose.

   So: do NOT pre-emptively add file storage, accounts, session stores, email,
   background jobs, search, logging, or payments — even when the description
   plainly implies them. Those are for the user to be taught about later.
   Include such a block ONLY if the entire system is that thing.

4. Connect every block you add. No orphans.

5. No positions. No operations. No types. Blocks and lines only.

Some systems need two blocks. Some need five. A static site with no backend
should not be given a database.`;

const MOVE = {
  type: "object",
  properties: {
    t: { type: "string", enum: ["addNode", "connect"] },
    id: { type: "string" }, name: { type: "string" },
    kind: { type: "string" }, intent: { type: "string" }, details: { type: "string" },
    from: { type: "string" }, to: { type: "string" }, label: { type: "string" },
  },
  required: ["t", "id", "name", "kind", "intent", "details", "from", "to", "label"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: { moves: { type: "array", items: MOVE } },
  required: ["moves"],
  additionalProperties: false,
};

/** Anything the model sends that we can't use is dropped on its own, with a
    reason. One malformed move must never cost the whole generation. */
export function validate(raw) {
  const moves = [];
  const dropped = [];
  const ids = new Set();
  let blocks = 0;

  for (const m of Array.isArray(raw) ? raw : []) {
    if (!m || typeof m !== "object") { dropped.push("not an object"); continue; }

    if (m.t === "addNode") {
      if (blocks >= MAX_BLOCKS) { dropped.push(`over the ${MAX_BLOCKS}-block cap: ${m.id}`); continue; }
      if (typeof m.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(m.id)) { dropped.push(`bad id: ${JSON.stringify(m.id)}`); continue; }
      if (ids.has(m.id)) { dropped.push(`duplicate id: ${m.id}`); continue; }
      ids.add(m.id); blocks++;
      moves.push({ t: "addNode", node: {
        id: m.id,
        name: String(m.name || m.id).slice(0, 60),
        kind: String(m.kind || "").slice(0, 60),
        intent: String(m.intent || "").slice(0, 400),
        details: String(m.details || "").slice(0, 2000),
      }});
      continue;
    }

    if (m.t === "connect") {
      if (!ids.has(m.from) || !ids.has(m.to)) { dropped.push(`line to a block that wasn't created: ${m.from} → ${m.to}`); continue; }
      if (m.from === m.to) { dropped.push(`self-link: ${m.from}`); continue; }
      moves.push({ t: "connect", from: m.from, to: m.to, label: String(m.label || "").slice(0, 40) });
      continue;
    }

    dropped.push(`unknown move: ${JSON.stringify(m.t)}`);
  }
  return { moves, dropped };
}

export async function generate(prompt) {
  const { parsed, provider, model } = await callModel({
    system: SYSTEM, prompt, schemaName: "plan", schema: SCHEMA,
  });
  const { moves, dropped } = validate(parsed.moves);
  return { moves, dropped, provider, model };
}
