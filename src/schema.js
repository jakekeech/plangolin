// Load, validate and save the two files.
//
//   plangolin/system.json   what the system is      — semantic, reviewed in PRs
//   plangolin/layout.json   where the blocks sit    — coordinates only
//
// Split because positions churn on every nudge, and mixed into one file that
// noise buries the architecture diff and nobody reads it.

export const SYSTEM_PATH = "plangolin/system.json";
export const LAYOUT_PATH = "plangolin/layout.json";
export const VERSION = 1;

// Process-scoped serialization keeps one server's system/layout reads and
// writes cohesive. Separate Plangolin processes are outside this in-memory
// queue and remain governed by the one-server review invariant.
const persistenceTurns = new Map();

async function withPersistenceTurn(ws, operation) {
  const key = typeof ws?.root === "string" ? ws.root : ws;
  const previous = persistenceTurns.get(key) || Promise.resolve();
  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  persistenceTurns.set(key, turn);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (persistenceTurns.get(key) === turn) persistenceTurns.delete(key);
  }
}

export function emptyDoc() {
  return {
    version: VERSION,
    language: "typescript",
    prompt: "",
    nodes: [],
    edges: [],
    notes: [],
    types: {},
    dismissed: [],
    layout: {},
  };
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);

/** Validate and repair. Returns { doc, warnings } — never throws on bad shape. */
export function normalise(system, layout) {
  const warnings = [];
  const doc = emptyDoc();

  if (!isObj(system)) return { doc, warnings: ["system.json is not an object — starting empty"] };

  doc.version = Number.isInteger(system.version) ? system.version : VERSION;
  doc.language = str(system.language, "typescript");
  doc.prompt = str(system.prompt);
  doc.types = isObj(system.types) ? system.types : {};
  doc.dismissed = Array.isArray(system.dismissed) ? system.dismissed.filter((d) => typeof d === "string") : [];

  const seen = new Set();
  for (const raw of Array.isArray(system.nodes) ? system.nodes : []) {
    if (!isObj(raw) || !str(raw.id)) { warnings.push("dropped a node with no id"); continue; }
    if (seen.has(raw.id)) { warnings.push(`dropped duplicate node id "${raw.id}"`); continue; }
    seen.add(raw.id);
    const node = {
      id: raw.id,
      name: str(raw.name, raw.id),
      kind: str(raw.kind),
      intent: str(raw.intent),
      details: str(raw.details),
    };
    // A block owns a set of files. `dir` predates that and still means
    // "everything beneath this directory" — kept so existing sheets load
    // untouched rather than needing a migration.
    if (isObj(raw.anchor)) {
      if (Array.isArray(raw.anchor.paths)) {
        const paths = raw.anchor.paths
          .filter((p) => typeof p === "string")
          .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
          .filter((p) => p && !p.split("/").some((seg) => seg === ".."));
        if (paths.length) node.anchor = { paths };
        else warnings.push(`node "${raw.id}" had no usable anchor paths`);
      } else if (str(raw.anchor.dir)) {
        node.anchor = { dir: raw.anchor.dir };
      }
    }
    // Fields the user has edited. A sync never rewrites these — structure is
    // derived, words are authored.
    if (Array.isArray(raw.authored)) {
      const fields = raw.authored.filter((f) => ["name", "kind", "intent", "details"].includes(f));
      if (fields.length) node.authored = [...new Set(fields)].sort();
    }
    if (str(raw.parent)) node.parent = raw.parent;
    doc.nodes.push(node);
  }

  // A parent that doesn't exist would strand its children invisibly.
  for (const n of doc.nodes) {
    if (n.parent && !seen.has(n.parent)) {
      warnings.push(`node "${n.id}" pointed at a missing parent — freed it`);
      delete n.parent;
    }
  }

  /* Notes are commentary on the design, not part of the system. They are kept
     out of `nodes` deliberately: they must not gain traits, must not fire
     checks, and must not count against the six-block cap. Text lives here
     because it is worth reviewing in a diff; position lives in layout.json for
     the same reason node coordinates do. */
  const noteIds = new Set();
  for (const raw of Array.isArray(system.notes) ? system.notes : []) {
    if (!isObj(raw) || !str(raw.id)) { warnings.push("dropped a note with no id"); continue; }
    if (noteIds.has(raw.id)) { warnings.push(`dropped duplicate note id "${raw.id}"`); continue; }
    noteIds.add(raw.id);
    doc.notes.push({ id: raw.id, text: str(raw.text) });
  }

  const edgeIds = new Set();
  for (const raw of Array.isArray(system.edges) ? system.edges : []) {
    if (!isObj(raw)) continue;
    const from = str(raw.from), to = str(raw.to);
    if (!seen.has(from) || !seen.has(to)) {
      warnings.push(`dropped a line between blocks that don't exist (${from} → ${to})`);
      continue;
    }
    const id = str(raw.id, `${from}__${to}`);
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    doc.edges.push({
      id,
      from,
      to,
      label: str(raw.label),
      // Who drew this line. A user-drawn line that loses its code backing is
      // a finding; one the scan proposed is just updated.
      origin: raw.origin === "scan" ? "scan" : "user",
      operations: Array.isArray(raw.operations) ? raw.operations.filter(isObj) : [],
    });
  }

  // Positions are optional; a block without one gets auto-placed. Notes are
  // positioned the same way, so they have to be allowed through here too —
  // pruning against node ids alone silently dropped every note's coordinates,
  // and they came back stacked at the origin.
  const placeable = new Set([...seen, ...noteIds]);
  if (isObj(layout)) {
    for (const [id, pos] of Object.entries(layout)) {
      if (!placeable.has(id)) continue;                 // prune stale coordinates
      if (isObj(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        doc.layout[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
      }
    }
  }

  return { doc, warnings };
}

/** The document a list of scan moves amounts to — what the browser would have
    written had it replayed them itself.
 *
 *  It replays only the two moves a scan emits, and it has to agree with
 *  app.js's MOVES on both: an id that is already taken is not added twice,
 *  and a pair already joined is not joined again in the other direction —
 *  rollUpEdges can return a→b and b→a as separate pairs, and the browser
 *  keeps whichever it saw first. normalise() knows neither rule, so both are
 *  applied here, and what comes out holds the same blocks and the same lines
 *  the browser would have drawn from the same moves.
 *
 *  No layout: coordinates are the browser's to decide, and it auto-places
 *  every block that arrives without one. */
export function docFromMoves(moves) {
  const nodes = [];
  const edges = [];
  const ids = new Set();
  const joined = new Set();

  for (const m of Array.isArray(moves) ? moves : []) {
    if (!isObj(m)) continue;
    if (m.t === "addNode") {
      if (!isObj(m.node) || !str(m.node.id) || ids.has(m.node.id)) continue;
      ids.add(m.node.id);
      nodes.push(m.node);
    } else if (m.t === "connect") {
      const from = str(m.from), to = str(m.to);
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      if (joined.has(`${from}__${to}`) || joined.has(`${to}__${from}`)) continue;
      joined.add(`${from}__${to}`);
      edges.push({
        id: `${from}__${to}`, from, to,
        label: str(m.label), origin: m.origin,
        // Same clamp app.js applies on the way in. An import name long enough
        // to matter is a generated symbol, and one sheet truncating it while
        // the other did not would show up as a diff nobody made.
        operations: (Array.isArray(m.operations) ? m.operations : [])
          .filter((o) => isObj(o) && str(o.name))
          .map((o) => ({ name: o.name.slice(0, 60), sends: str(o.sends), returns: str(o.returns) })),
      });
    }
  }

  return normalise({ ...emptyDoc(), nodes, edges }, null).doc;
}

/** The concrete files a block owns, whichever anchor form it uses. */
export function expandAnchor(node, files) {
  const anchor = node && node.anchor;
  if (!anchor) return [];
  if (Array.isArray(anchor.paths)) {
    const owned = new Set(anchor.paths);
    return files.filter((f) => owned.has(f));
  }
  if (typeof anchor.dir === "string" && anchor.dir) {
    const prefix = anchor.dir.replace(/\/+$/, "") + "/";
    return files.filter((f) => f.startsWith(prefix));
  }
  return [];
}

async function loadUnlocked(ws) {
  const rawSystem = await ws.read(SYSTEM_PATH);
  if (rawSystem === null) return { doc: emptyDoc(), warnings: [], fresh: true };

  let system;
  try {
    system = JSON.parse(rawSystem);
  } catch (err) {
    // Never overwrite a file we could not read. A typo must not become data loss.
    const e = new Error(`${SYSTEM_PATH} is not valid JSON — ${err.message}`);
    e.readOnly = true;
    throw e;
  }

  let layout = null;
  const rawLayout = await ws.read(LAYOUT_PATH);
  if (rawLayout !== null) {
    try { layout = JSON.parse(rawLayout); }
    catch { /* positions are disposable — auto-place instead of failing */ }
  }

  const { doc, warnings } = normalise(system, layout);
  if (rawLayout !== null && layout === null) warnings.push("layout.json was unreadable — blocks were auto-placed");
  return { doc, warnings, fresh: false };
}

async function saveUnlocked(ws, doc) {
  const { layout, ...system } = doc;
  await ws.write(SYSTEM_PATH, JSON.stringify(system, null, 2) + "\n");
  await ws.write(LAYOUT_PATH, JSON.stringify(layout || {}, null, 2) + "\n");
}

export async function load(ws) {
  return withPersistenceTurn(ws, () => loadUnlocked(ws));
}

export async function save(ws, doc) {
  return withPersistenceTurn(ws, () => saveUnlocked(ws, doc));
}

export async function saveIfEmpty(ws, doc) {
  return withPersistenceTurn(ws, async () => {
    const { doc: current } = await loadUnlocked(ws);
    if (current.nodes.length) return false;
    await saveUnlocked(ws, doc);
    return true;
  });
}
