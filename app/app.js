(function () {
  "use strict";

  /* ============================ parts ============================ */

  const ic = (d) => '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

  const KINDS = {
    web:      { label: "Web app",        core: true,  icon: ic('<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><path d="M2.5 7.5h15"/><circle cx="5" cy="5.75" r=".4" fill="currentColor"/>') },
    mobile:   { label: "Mobile app",     core: true,  icon: ic('<rect x="6" y="2.5" width="8" height="15" rx="1.6"/><path d="M9 15h2"/>') },
    api:      { label: "API server",     core: true,  icon: ic('<path d="M7 5 3.5 10 7 15"/><path d="M13 5l3.5 5-3.5 5"/>') },
    db:       { label: "Database",       core: true,  icon: ic('<ellipse cx="10" cy="5.5" rx="6" ry="2.4"/><path d="M4 5.5v9c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v-9"/><path d="M4 10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4"/>') },
    auth:     { label: "Accounts",       core: true,  icon: ic('<rect x="4" y="8.5" width="12" height="8" rx="1.5"/><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5"/>') },
    storage:  { label: "File storage",   core: true,  icon: ic('<path d="M3 6.5 10 3l7 3.5-7 3.5z"/><path d="M3 10.5 10 14l7-3.5"/><path d="M3 14 10 17.5 17 14"/>') },
    jobs:     { label: "Background work",core: true,  icon: ic('<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.8"/>') },
    external: { label: "Someone else’s API", core: true, icon: ic('<path d="M11 4h5v5"/><path d="M16 4l-6.5 6.5"/><path d="M14 12v3.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 15.5v-8A1.5 1.5 0 0 1 4.5 6H8"/>') },
    // The fallback for a kind we don't recognise. Deliberately NOT `external`
    // — a scanned repo is full of kinds no table will ever list, and every
    // one of them is the user's own code. Labelling those "Someone else's
    // API" is the exact opposite of the truth.
    generic:  { label: "Part of this system", core: false, icon: ic('<rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/><path d="M3.5 8.5h13"/>') },

    cache:    { label: "Session store",  core: false, icon: ic('<path d="M11 2.5 4.5 11H9.5l-.5 6.5L15.5 9H10.5z"/>') },
    email:    { label: "Email & alerts", core: false, icon: ic('<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="m2.5 6.5 7.5 5 7.5-5"/>') },
    payments: { label: "Payments",       core: false, icon: ic('<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 9h15"/><path d="M5.5 12.5h3"/>') },
    webhooks: { label: "Incoming events",core: false, icon: ic('<path d="M3 10h9"/><path d="m9 6.5 3.5 3.5L9 13.5"/><rect x="14" y="5" width="3.5" height="10" rx="1"/>') },
    search:   { label: "Search index",   core: false, icon: ic('<circle cx="8.75" cy="8.75" r="5"/><path d="m12.5 12.5 4.5 4.5"/>') },
    realtime: { label: "Live updates",   core: false, icon: ic('<path d="M4 12a8.5 8.5 0 0 1 12 0"/><path d="M6.75 14.5a4.7 4.7 0 0 1 6.5 0"/><circle cx="10" cy="17" r=".9" fill="currentColor"/>') },
    group:    { label: "Group",          core: false, hidden: true, icon: ic('<rect x="2.5" y="6" width="11" height="9" rx="1.4"/><path d="M6 6V4.4A1.4 1.4 0 0 1 7.4 3h8.2A1.4 1.4 0 0 1 17 4.4v8.2a1.4 1.4 0 0 1-1.4 1.4H13.5"/>') },
    logs:     { label: "Logs & alerts",  core: false, icon: ic('<path d="M2.5 11.5h3l2-5 3 9 2.5-6 1.5 2h3"/>') }
  };

  /* ============================ state ============================ */

  // `kind` is free text now, so the icon is matched rather than keyed. Most
  // specific first — "Application backend" must hit api, not web.
  /* ===================== kinds, categories, traits =====================
     Two separate things that used to be one:

       KNOWN_KINDS  free text you typed  ->  a category
       CATEGORY     a category           ->  an icon, and the traits it implies

     `kind` is free text and always will be — the world has more things in it
     than any list. A category is bounded by the rules that ask about it, which
     is why a closed list is safe here and would not be for kinds.
  */

  const CATEGORY = {
    client:       { icon: "web",       traits: ["user-facing"] },
    mobile:       { icon: "mobile",    traits: ["user-facing"] },
    service:      { icon: "api",       traits: ["we-run-it"] },
    store:        { icon: "db",        traits: ["persists", "we-run-it"] },
    "fast-store": { icon: "cache",     traits: ["persists", "we-run-it"] },
    blob:         { icon: "storage",   traits: ["persists", "we-run-it"] },
    auth:         { icon: "auth",      traits: ["authorizes", "we-run-it"] },
    payments:     { icon: "payments",  traits: [] },
    "inbound-events": { icon: "webhooks", traits: ["we-run-it", "async"] },
    email:        { icon: "email",     traits: ["async"] },
    search:       { icon: "search",    traits: ["persists"] },
    realtime:     { icon: "realtime",  traits: ["we-run-it", "async"] },
    queue:        { icon: "jobs",      traits: ["we-run-it", "async"] },
    observability:{ icon: "logs",      traits: [] },
    group:        { icon: "group",     traits: [] },
    external:     { icon: "external",  traits: [] },
    unknown:      { icon: "generic",   traits: [] },
  };

  // Most specific first — "Application backend" must reach service, not client.
  const KNOWN_KINDS = [
    [/\bgroup\b/i, "group"],
    [/postgres|mysql|sqlite|mongo|supabase|dynamo|planetscale|firestore|indexeddb|\bdatabase\b|\bdb\b/i, "store"],
    [/redis|memcach|valkey|upstash|session store/i, "fast-store"],
    [/\bs3\b|\br2\b|bucket|cloudinary|uploadthing|\bgcs\b|object storage|file storage|blob storage/i, "blob"],
    [/stripe|paddle|lemonsqueezy|adyen|braintree|payment|billing|checkout/i, "payments"],
    [/webhook|incoming event/i, "inbound-events"],
    [/clerk|auth0|nextauth|better.?auth|cognito|\bauth\b|account|\blogin\b|identity/i, "auth"],
    [/resend|sendgrid|postmark|mailgun|\bses\b|email|newsletter|\bmail\b/i, "email"],
    [/algolia|meilisearch|typesense|elasticsearch|search index|\bsearch\b/i, "search"],
    [/pusher|ably|websocket|socket\.io|liveblocks|realtime|live update/i, "realtime"],
    [/sentry|datadog|axiom|logtail|betterstack|\blog(s|ging)?\b|monitor|observab/i, "observability"],
    [/\bsqs\b|bullmq|inngest|trigger\.dev|temporal|queue|worker|\bjob\b|cron|scrap|background/i, "queue"],
    [/\bapi\b|backend|\bserver\b|\bservice\b/i, "service"],
    [/mobile|\bios\b|android|react native/i, "mobile"],
    [/third.?party|someone else|external/i, "external"],
    [/\bweb\b|\bapp\b|\bsite\b|frontend|next|react|svelte|static|dashboard/i, "client"],
  ];

  function categoryOf(kind) {
    for (var i = 0; i < KNOWN_KINDS.length; i++) if (KNOWN_KINDS[i][0].test(kind || "")) return KNOWN_KINDS[i][1];
    return "unknown";
  }
  const kindKey = (kind) => CATEGORY[categoryOf(kind)].icon;      // icon lookups still work
  const iconFor = (kind) => KINDS[kindKey(kind)];

  /* Tier 2 — what the sentence says, when the kind didn't settle it. Same
     keyword engine the domain rules use. An unrecognised block ends with no
     traits at all: fewer checks, never a wrong one. */
  const TRAIT_WORDS = {
    persists:      /\bstores?\b|\bkeeps?\b|\bsaved?\b|\bremembers?\b|\brecords?\b|survive a restart/i,
    "user-facing": /\bpeople\b|\busers?\b|visitors?|customers?|\bstaff\b|\bbrowser\b|lets you|lets them|lets someone/i,
    "we-run-it":   /\bhandles?\b|\bserves?\b|\bruns?\b|\bprocess(es)?\b|our (own )?(code|server)/i,
    authorizes:    /who is|who's allowed|permission|signs? (people )?up|logs? (them|people) in|proves who/i,
    async:         /\blater\b|nightly|every night|scheduled|in the background|queue|without waiting/i,
  };

  function traitsOf(node) {
    const cat = categoryOf(node.kind);
    const set = new Set(CATEGORY[cat].traits);

    // Tier 2 runs ONLY when the kind told us nothing. A sentence describes what
    // the product does, not what this block is — "People sign up and log in" on
    // a web app would otherwise mark the app itself as the thing doing the
    // authorising, and the rule that should teach you about accounts goes quiet.
    if (cat === "unknown") {
      const text = (node.name || "") + " " + (node.intent || "");
      for (const t in TRAIT_WORDS) if (TRAIT_WORDS[t].test(text)) set.add(t);
    }
    return set;
  }


  // Readable slug ids — they end up in file paths and git diffs, where a uuid
  // would be unreadable.
  function slug(name, taken) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "block";
    if (!/^[a-z]/.test(base)) base = "b-" + base;
    var id = base, i = 2;
    while (taken.has(id)) id = base + "-" + i++;
    taken.add(id);
    return id;
  }
  const nodeIds = () => new Set(S.nodes.map((n) => n.id));

  /* The pre-boot placeholder, and the shape everything resets to. Empty on
     purpose: an empty sheet asks a question, it does not hand you a demo
     block you then have to delete. This used to seed a "Photo feed", which
     the old Start over button dropped on top of whatever you had. */
  const seed = () => ({
    nodes: [],
    edges: [],
    notes: [],
    types: {},
    dismissed: [],
    prompt: "",
    sel: null
  });

  // In memory a block carries its own x/y because everything that draws wants
  // it there. The split into two files happens only at the disk boundary.
  function toDoc(s) {
    const layout = {};
    s.nodes.forEach((n) => { layout[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
    // Notes take positions in layout.json for the same reason blocks do: the
    // coordinate churn would otherwise bury the semantic diff.
    (s.notes || []).forEach((n) => {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) layout[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
    });
    return {
      version: 1,
      language: "typescript",
      prompt: s.prompt || "",
      notes: (s.notes || []).map((n) => ({ id: n.id, text: n.text || "" })),
      nodes: s.nodes.map((n) => {
        const out = { id: n.id, name: n.name, kind: n.kind, intent: n.intent, details: n.details || "" };
        if (n.anchor) out.anchor = n.anchor;
        if (n.parent) out.parent = n.parent;
        if (n.authored && n.authored.length) out.authored = n.authored;
        return out;
      }),
      edges: s.edges.map((e) => ({
        id: e.id, from: e.from, to: e.to, label: e.label,
        origin: e.origin === "scan" ? "scan" : "user",
        operations: e.operations,
      })),
      types: s.types || {},
      dismissed: s.dismissed || [],
      layout: layout,
    };
  }

  function fromDoc(doc) {
    const s = {
      nodes: doc.nodes.map((n) => {
        const pos = (doc.layout || {})[n.id];
        return Object.assign({}, n, {
          x: pos ? pos.x : null,          // null means "not placed yet"
          y: pos ? pos.y : null,
        });
      }),
      edges: doc.edges.map((e) => Object.assign({ operations: [] }, e)),
      notes: (doc.notes || []).map((n) => {
        const pos = (doc.layout || {})[n.id];
        return Object.assign({}, n, { x: pos ? pos.x : null, y: pos ? pos.y : null });
      }),
      types: doc.types || {},
      dismissed: doc.dismissed || [],
      prompt: doc.prompt || "",
      sel: null,
    };
    return s;
  }

  /* ===================== export for an AI agent =====================
     A plain Markdown brief — every block's kind, one-line intent, and the
     deeper details; every connection's label and the calls defined on it.
     Deliberately not the raw system.json: that's the format for plangolin
     itself, this is for pasting into a chat window or a coding agent's
     prompt. Pure formatting of what's already on screen — no network call,
     works with no API key configured. */
  function buildMarkdown(s) {
    const lines = [];
    const childrenOf = (id) => s.nodes.filter((n) => n.parent === id);
    const byId = (id) => s.nodes.find((n) => n.id === id);

    lines.push("# " + (s.prompt && s.prompt.trim() ? s.prompt.trim() : "Untitled system"));
    lines.push("");
    lines.push("_Sketched with plangolin. Anything the plan check or deep review still has open below is a deliberate gap, not an oversight — resolve it, or decide it doesn't apply, before treating this as complete._");
    lines.push("");
    lines.push("## Blocks");

    s.nodes.forEach((n) => {
      lines.push("");
      lines.push("### " + n.name + " (" + (n.kind && n.kind.trim() ? n.kind : "kind not specified") + ")");
      if (n.parent) { const p = byId(n.parent); if (p) lines.push("_Part of: " + p.name + "_"); }
      const kids = childrenOf(n.id);
      if (kids.length) lines.push("_Contains: " + kids.map((k) => k.name).join(", ") + "_");
      lines.push("");
      lines.push(n.intent && n.intent.trim() ? n.intent.trim() : "_(no description provided)_");
      if (n.details && n.details.trim()) { lines.push(""); lines.push(n.details.trim()); }
    });

    lines.push("");
    lines.push("## Connections");

    if (!s.edges.length) {
      lines.push("");
      lines.push("_None yet._");
    } else {
      s.edges.forEach((e) => {
        const a = byId(e.from), b = byId(e.to);
        if (!a || !b) return;
        lines.push("");
        lines.push("### " + a.name + " → " + b.name);
        if (e.label && e.label.trim()) lines.push("_" + e.label.trim() + "_");
        (e.operations || []).forEach((o) => {
          lines.push("- `" + (o.name || "call") + "(" + (o.sends || "") + ")` → " + (o.returns || "?"));
        });
      });
    }

    return lines.join("\n").trim() + "\n";
  }

  /* A fuller companion to buildMarkdown(), meant to be handed to an AI agent
     that will actually build the system — same content, plus each block's
     real (or proposed) folder, called out explicitly, so the agent knows
     where things go without guessing. Never scaffolds anything itself; it
     only describes the structure. Written to disk as plangolin/BUILD.md
     *and* copied to the clipboard — see the export handler below. */
  function buildSpec(s) {
    const lines = [];
    const childrenOf = (id) => s.nodes.filter((n) => n.parent === id);
    const byId = (id) => s.nodes.find((n) => n.id === id);

    lines.push("# Build spec: " + (s.prompt && s.prompt.trim() ? s.prompt.trim() : "Untitled system"));
    lines.push("");
    lines.push("_Generated by plangolin. Folder paths below are real if this project already has code there, or proposed if this is a fresh build — either way, nothing on disk has been created for you. Anything the plan check or deep review still has open is a deliberate gap, not an oversight._");
    lines.push("");
    lines.push("## Blocks");

    s.nodes.forEach((n) => {
      lines.push("");
      lines.push("### " + n.name + " (" + (n.kind && n.kind.trim() ? n.kind : "kind not specified") + ")");
      lines.push("Folder: `" + (n.anchor && n.anchor.dir ? n.anchor.dir : "not yet determined") + "`");
      if (n.parent) { const p = byId(n.parent); if (p) lines.push("_Part of: " + p.name + "_"); }
      const kids = childrenOf(n.id);
      if (kids.length) lines.push("_Contains: " + kids.map((k) => k.name).join(", ") + "_");
      lines.push("");
      lines.push(n.intent && n.intent.trim() ? n.intent.trim() : "_(no description provided)_");
      if (n.details && n.details.trim()) { lines.push(""); lines.push(n.details.trim()); }
    });

    lines.push("");
    lines.push("## Connections");

    if (!s.edges.length) {
      lines.push("");
      lines.push("_None yet._");
    } else {
      s.edges.forEach((e) => {
        const a = byId(e.from), b = byId(e.to);
        if (!a || !b) return;
        lines.push("");
        lines.push("### " + a.name + " → " + b.name);
        if (e.label && e.label.trim()) lines.push("_" + e.label.trim() + "_");
        (e.operations || []).forEach((o) => {
          lines.push("- `" + (o.name || "call") + "(" + (o.sends || "") + ")` → " + (o.returns || "?"));
        });
      });
    }

    return lines.join("\n").trim() + "\n";
  }

  let S = seed();
  let ready = false;

  /* ======================= the one door =======================
     Every change to the document goes through applyMove. Four things write to
     it — the canvas, the plan check, and later the generator and chat — and if
     each does it its own way they drift apart, and chat becomes a rewrite
     rather than an edit. One door also gives undo for free.

     Handlers mutate a *copy*; the live document is only swapped in once the
     move validates. A rejected move can never leave the document half-changed.
  */

  const clone = (d) => (typeof structuredClone === "function" ? structuredClone(d) : JSON.parse(JSON.stringify(d)));
  const docOf = (s) => ({ nodes: s.nodes, edges: s.edges, notes: s.notes || [], types: s.types, dismissed: s.dismissed, prompt: s.prompt });
  const find = (d, id) => d.nodes.find((n) => n.id === id);
  const findEdge = (d, id) => d.edges.find((e) => e.id === id);

  const findNote = (d, id) => (d.notes || []).find((n) => n.id === id);

  /* A field you typed into is yours, and a sync never rewrites it —
     structure is derived, words are authored. Moves carrying origin "scan"
     came from plangolin itself (the scan naming a block, "Update from code"
     refreshing a stale description), so they must not mark anything: doing
     so would freeze plangolin's own prose against every future update. */
  function authored(n, field, m) {
    if (m && m.origin === "scan") return;
    if (!n.authored) n.authored = [];
    if (!n.authored.includes(field)) { n.authored.push(field); n.authored.sort(); }
  }

  const MOVES = {
    /* Notes are annotation, not architecture. They never gain traits, never
       fire a check, and never count against the six-block cap — which is why
       they live in their own array rather than as a kind of node. */
    addNote(d, m) {
      if (!m.note || !m.note.id) return "addNote needs a note with an id";
      if (findNote(d, m.note.id)) return 'a note called "' + m.note.id + '" already exists';
      (d.notes = d.notes || []).push(Object.assign({ text: "" }, m.note));
    },
    setNoteText(d, m) {
      const n = findNote(d, m.id);
      if (!n) return "no such note: " + m.id;
      n.text = String(m.text == null ? "" : m.text).slice(0, 400);
    },
    moveNote(d, m) {
      const n = findNote(d, m.id);
      if (!n) return "no such note: " + m.id;
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return "moveNote needs finite coordinates";
      n.x = Math.round(m.x); n.y = Math.round(m.y);
    },
    removeNote(d, m) {
      const i = (d.notes || []).findIndex((n) => n.id === m.id);
      if (i < 0) return "no such note: " + m.id;
      d.notes.splice(i, 1);
    },

    addNode(d, m) {
      if (!m.node || !m.node.id) return "addNode needs a node with an id";
      if (find(d, m.node.id)) return 'a block called "' + m.node.id + '" already exists';
      d.nodes.push(Object.assign({ name: "", kind: "", intent: "", details: "" }, m.node));
    },
    removeNode(d, m) {
      const n = find(d, m.id);
      if (!n) return "no such block: " + m.id;
      d.nodes.forEach((c) => { if (c.parent === m.id) delete c.parent; });   // free, don't orphan
      d.edges = d.edges.filter((e) => e.from !== m.id && e.to !== m.id);
      d.nodes = d.nodes.filter((x) => x.id !== m.id);
    },
    setName(d, m)   { const n = find(d, m.id); if (!n) return "no such block"; authored(n, "name", m); n.name = String(m.name); },
    setKind(d, m)   { const n = find(d, m.id); if (!n) return "no such block"; authored(n, "kind", m); n.kind = String(m.kind); },
    setIntent(d, m) { const n = find(d, m.id); if (!n) return "no such block"; authored(n, "intent", m); n.intent = String(m.intent); },
    setDetails(d, m) { const n = find(d, m.id); if (!n) return "no such block"; authored(n, "details", m); n.details = String(m.details); },
    // No inspector field drives this — it's only ever set by AI (structure
    // proposal during export, or discovery during "Update from code"), or by
    // hand-editing system.json directly, same as everything else plangolin
    // already lets you edit by hand.
    setAnchor(d, m) {
      const n = find(d, m.id); if (!n) return "no such block";
      const dir = m.dir == null ? "" : String(m.dir).trim().replace(/^\/+/, "");
      if (!dir) { delete n.anchor; return; }
      // Never trade a set of real files for a guessed folder. A scan gives a
      // block the exact paths it owns; a proposed dir is strictly less
      // information, so it only applies where there is nothing to lose.
      if (n.anchor && Array.isArray(n.anchor.paths) && n.anchor.paths.length) {
        return "block already owns specific files";
      }
      n.anchor = { dir };
    },
    moveNode(d, m)  {
      const n = find(d, m.id); if (!n) return "no such block";
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return "moveNode needs finite coordinates";
      n.x = Math.round(m.x); n.y = Math.round(m.y);
    },
    setParent(d, m) {
      const n = find(d, m.id); if (!n) return "no such block";
      if (m.parent === null) { delete n.parent; return; }
      if (!find(d, m.parent)) return "no such parent: " + m.parent;
      if (m.parent === m.id) return "a block cannot contain itself";
      for (let p = find(d, m.parent); p; p = p.parent ? find(d, p.parent) : null) {
        if (p.id === m.id) return "that would make a loop";   // no cycles in containment
      }
      n.parent = m.parent;
    },
    connect(d, m) {
      if (!find(d, m.from) || !find(d, m.to)) return "cannot connect blocks that don't exist";
      if (m.from === m.to) return "a block cannot connect to itself";
      const id = m.from + "__" + m.to;
      if (findEdge(d, id) || findEdge(d, m.to + "__" + m.from)) return null;   // already linked; not an error
      // Who drew this. A line you dragged is a claim about the system, so a
      // sync that can't find code behind it reports that rather than quietly
      // deleting it. A line the scan proposed is just kept up to date.
      d.edges.push({
        id: id, from: m.from, to: m.to, label: m.label || "",
        origin: m.origin === "scan" ? "scan" : "user",
        // A scan knows the names that cross a line, straight from the import
        // statements, so it may supply them. Hand-drawn lines arrive empty
        // and stay dashed until someone says what crosses.
        operations: (Array.isArray(m.operations) ? m.operations : [])
          .filter((o) => o && typeof o.name === "string" && o.name)
          .map((o) => ({ name: String(o.name).slice(0, 60), sends: String(o.sends || ""), returns: String(o.returns || "") })),
      });
    },
    disconnect(d, m) {
      if (!findEdge(d, m.id)) return "no such line";
      d.edges = d.edges.filter((e) => e.id !== m.id);
    },
    setLabel(d, m) { const e = findEdge(d, m.id); if (!e) return "no such line"; e.label = String(m.label); },
    setOperation(d, m) {
      const e = findEdge(d, m.edgeId); if (!e) return "no such line";
      const i = m.index == null ? e.operations.length : m.index;
      if (i < 0 || i > e.operations.length) return "operation index out of range";
      e.operations[i] = Object.assign({ name: "", sends: "", returns: "" }, m.op);
    },
    removeOperation(d, m) {
      const e = findEdge(d, m.edgeId); if (!e) return "no such line";
      if (m.index < 0 || m.index >= e.operations.length) return "operation index out of range";
      e.operations.splice(m.index, 1);
    },
    setType(d, m)    { if (!m.name) return "setType needs a name"; d.types[m.name] = m.shape || {}; },
    removeType(d, m) { delete d.types[m.name]; },
    dismiss(d, m)    { if (d.dismissed.indexOf(m.checkId) === -1) d.dismissed.push(m.checkId); },
  };

  const undoStack = [];
  const UNDO_LIMIT = 60;

  function snapshot() { return clone(docOf(S)); }

  function restore(doc) {
    S.nodes = doc.nodes; S.edges = doc.edges; S.notes = doc.notes || [];
    S.types = doc.types; S.dismissed = doc.dismissed; S.prompt = doc.prompt;
    if (S.sel && !find(S, S.sel.id) && !findEdge(S, S.sel.id)) S.sel = null;
    if (viewRoot && !find(S, viewRoot)) viewRoot = null;
  }

  /* opts.transient — apply without recording undo. Used while dragging, where
     one undo entry per frame would be useless. The drag records one entry at
     the start instead. */
  function applyMove(move, opts) {
    opts = opts || {};
    const handler = MOVES[move && move.t];
    if (!handler) { console.warn("plangolin: unknown move", move); return false; }

    const next = clone(docOf(S));
    let error;
    try { error = handler(next, move); }
    catch (err) { error = err.message; }
    if (error) { console.warn("plangolin: rejected", move.t + " —", error); return false; }

    if (!opts.transient) checkpoint();
    restore(next);
    return true;
  }

  /* One undo entry, and the moment the sheet stops being disposable.
     Every deliberate edit goes through here — including the ones that apply
     several moves transiently under a single entry, like accepting a check or
     folding a group — which is why the retry offer retires here rather than
     inside applyMove. Transient moves on their own (the generator's replay,
     auto-layout) deliberately do not count as editing. */
  function checkpoint() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    clearRetry();
    // A dead-end screen is only true until you start drawing on top of it.
    clearIdle();
  }

  function applyMoves(moves) { return moves.every((m) => applyMove(m, { transient: true })); }

  function undo() {
    if (!undoStack.length) return false;
    restore(undoStack.pop());
    render();
    return true;
  }

                       // don't save over the file before we've read it
  let pan = { x: 0, y: 0 };

  /* Scale. pan is in screen pixels and zoom multiplies world coordinates, so
     a world point lands at world * zoom + pan. That is exactly what
     `translate(pan) scale(zoom)` does against .world's transform-origin of
     0 0, which means the DOM stays the authority: hit-testing through
     .closest() and every getBoundingClientRect() already account for the
     scale, and none of them need to know it exists.

     Fit stops at 1. A three-block sheet blown up to fill a monitor looks
     like a mistake, and the whole premise here is a diagram small enough to
     hold in your head — magnifying it says the opposite. Deliberate zooming
     in past 100% is still allowed; it just is never chosen for you. */
  let zoom = 1;
  const ZOOM_MIN = 0.25, ZOOM_MAX = 2, FIT_MAX = 1;
  const GRID = 22;                        // .canvas background-size, scaled with the world

  const toWorldX = (sx) => (sx - pan.x) / zoom;
  const toWorldY = (sy) => (sy - pan.y) / zoom;

  let hoverCheck = null;

  // Which container's children the canvas is currently showing. null means
  // the real top level. Never persisted — a peer to pan, not part of the
  // document — so reloading always opens back at the top.
  let viewRoot = null;

  /* Where the camera was at each level, keyed by viewRoot ("" for the top).
     Coming back out of a block should look like leaving it did: resetting to
     the origin throws away the spatial memory you just spent attention
     building, which is the one thing drawing the system in a fixed place was
     for. Peer to pan, and dropped on reload for the same reason. */
  const camByView = new Map();

  // Deep review — a separate, on-demand AI pass. Never persisted: it's advice
  // to weigh against the sheet, not part of the document. A finding drops out
  // of this list once accepted or dismissed; a fresh review replaces the
  // whole list.
  let aiFindings = [];
  let aiReviewNote = "";
  let aiReviewBusy = false;

  // Check against code — free, read-only, no AI. Never persisted: "never
  // store what you can compute" — this is recomputed fresh on every click.
  let syncResult = null;
  // Which blocks changed inside, by id, with how many files moved. Read once
  // when a sync lands rather than recomputed on every render() — the sheet
  // redraws on every drag, and scanning the change list each frame would make
  // dragging cost more the bigger the change was.
  let changedInside = new Map();
  // Automatic syncs are free — no key, no network, no model, ~30ms of local
  // work — so the gap isn't about cost. It's about not re-reading the whole
  // project every time a click passes through the window on its way somewhere
  // else. Coming back after real work is always longer than this.
  let lastSyncAt = 0;
  const SYNC_GAP_MS = 3000;
  // Wires the last sync disagreed with. `wiresGone` holds edge ids the sheet
  // draws that no code backs; `wiresNew` holds block pairs the code links that
  // the sheet has never drawn. Both are drift — the sheet against the code as
  // it stands, not against a baseline. On a sheet you keep acknowledged the
  // two converge, because you were in agreement until the agent ran.
  let wiresGone = new Set();
  let wiresNew = [];
  // The changed blocks, grouped into separate changes. `pickedGroup` is the
  // one being looked at, or null for all of them — Gleicher's select-subset,
  // which is the only one of his three scalability moves that works when a
  // change is too big to hold at once.
  let changeGroups = [];
  let pickedGroup = null;
  // Titles the model gave each change, by group index.
  let changeNames = new Map();
  let namingBusy = false;
  /* What state the sheet is showing. The work in flight by default: on a
     branch that is everything since it left the trunk, and on the trunk
     itself what has not been pushed. Either way it is "what has happened
     here that is not yet everyone's", which is the question without needing
     to have marked anything read. */
  let baseline = { kind: "branch" };
  let baselineList = null;         // filled the first time the menu opens
  let syncNote = "";
  let syncBusy = false;

  // Update from code — same idea as Deep review's queue, not Complete
  // System's one-shot apply: real code changes are exactly the case where
  // you want to look before you commit to a diagram edit, not after. An
  // item drops out once accepted or dismissed; a fresh run replaces the
  // whole queue.
  let refreshQueue = [];
  let refreshNote = "";
  let refreshBusy = false;

  /* The live plan review, or null. Polled rather than pushed: a plan arrives
     while the tab may be in the background, and one request every two seconds
     against a server on this machine costs nothing measurable — a socket to
     avoid it would be the first dependency in the product. */
  let plan = null;
  let planCut = new Set();          // proposal keys the user has crossed out
  let planAt = 0;                   // which proposal the stepper is showing
  let planSending = false;          // an answer is in flight; see sendAnswer
  /* Whether /api/doc handed us a document. A review opens either way — see
     boot() — but a ghost does not: it is drawn beside the block it relates to,
     and on a sheet that never loaded there are no blocks to relate it to. It
     would also look like a sheet, which is the one thing that just failed. */
  let sheetLoaded = false;
  /* Where each proposed block is drawn. Computed by renderNodes and read by
     renderWires, which runs after it — the blocks and the lines have to agree
     about where a ghost is, and two calls to ghostPositions() would be two
     answers the moment anything about it stopped being deterministic. */
  /* The change view — the baseline picker, the checks bulb, and everything
     reachable from either — predates the plan review and now competes with it
     for attention. Someone deciding whether to accept a plan is not asking
     what git did last week.

     Turned off rather than deleted. It works, it is tested, and shelving it
     should stay cheap to reverse: flip this to true and it comes back whole,
     with its tests still passing in the meantime. Deleting it would have taken
     those tests with it and made the decision expensive to undo. */
  const CHANGE_VIEW = false;

  let ghostAt = new Map();
  /* A dragged proposal belongs to this review, not the sheet. Keeping it
     beside the review state lets ordinary redraws preserve the user's spatial
     choice without putting a made-up node through the document save path. */
  let movedGhosts = new Map();

  /* Must match proposalKey in src/plan-brief.js exactly — the literals are
     pinned by test/plan-brief.test.js, and this line is the other half of
     that pair. There is no build step here, so the browser cannot import it,
     and a key the server does not recognise is read as a rejection rather
     than an error — the one disagreement in this feature that would fail
     silently. */
  const planKey = (kind, a, b) => (kind === "edge" ? "edge:" + a + ">" + b : kind + ":" + a);

  const canvas = document.getElementById("canvas");
  const world = document.getElementById("world");
  const wires = document.getElementById("wires");
  const labelLayer = document.getElementById("wire-labels");
  const inspectorEl = document.getElementById("inspector");

  /* Selecting a block and asking to see its details are two different things.
     A drag begins with a selection, and the panel must not fly out on the way
     — so this is set by a click that did not turn into a drag, never by the
     selection itself. */
  let inspectorOpen = false;
  // The patch is transient evidence for the selected block. It lives beside
  // the inspector rather than in the document, and a new selection invalidates
  // which block the evidence came from.
  let hunkView = null;
  const checksEl = document.getElementById("checks");
  const shell = document.getElementById("shell");

  const node = (id) => S.nodes.find((n) => n.id === id);
  const has = (k) => S.nodes.some((n) => kindKey(n.kind) === k);
  const first = (k) => S.nodes.find((n) => kindKey(n.kind) === k);
  const linked = (a, b) => S.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  const degree = (id) => S.edges.filter((e) => e.from === id || e.to === id).length;
  const corpus = () => S.nodes.map((n) => (n.name + " " + n.intent)).join(" ").toLowerCase();
  const mentions = (words) => { const c = corpus(); return words.some((w) => c.includes(w)); };
  // ---- containment: a node may contain other nodes (C4-style) ----
  const childrenOf = (id) => S.nodes.filter((n) => n.parent === id);
  const isContainer = (id) => childrenOf(id).length > 0;

  // A container is always drawn folded now — double-click navigates into it
  // rather than unfolding it in place (see enterNode). So "what's on the
  // sheet right now" is just: the direct children of whatever we've
  // navigated into, or the real top-level nodes if we haven't navigated
  // anywhere.
  function currentLevelNodes() {
    return viewRoot ? childrenOf(viewRoot) : S.nodes.filter((n) => !n.parent);
  }

  // Projects any node id to whichever node is actually drawn at the current
  // level: itself, if it's a direct child of viewRoot (or a real top-level
  // node when viewRoot is null); otherwise the ancestor that is. Returns
  // null if id's chain never reaches this level at all — the id belongs to
  // an unrelated branch of the tree, or is nested deeper and viewRoot isn't
  // one of its ancestors.
  function levelAncestor(id) {
    let n = id ? node(id) : null;
    while (n) {
      const p = n.parent || null;
      if (p === viewRoot) return n.id;
      n = p ? node(p) : null;
    }
    return null;
  }

  // The breadcrumb trail for a view: root-most ancestor first, id itself
  // last. Derived from `parent`, never stored.
  function viewPath(id) {
    const path = [];
    let n = id ? node(id) : null;
    while (n) { path.unshift(n); n = n.parent ? node(n.parent) : null; }
    return path;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ============================ plan check ============================
     A table, not a function. Structural rules ask about traits, domain rules
     ask about categories, and neither names a `kind` directly. Adding a rule
     means adding a row — the engine below never changes.

     `each` iterates: "node" | "edge" | null (once for the whole sheet).
  */

  const RULES = [

    /* ---------- structural: trait predicates ---------- */

    { id: (c, n) => "no-intent-" + n.id, each: "node", sev: "missing", tag: "Say what it does",
      when: (c, n) => !n.intent.trim(),
      title: (c, n) => "“" + n.name + "” has no description",
      why: () => "plangolin reads the plain-English description to work out what else you need. Without it this block is just a box.",
      marks: (c, n) => [n.id],
      act: (c, n) => ({ label: "Describe it", kind: "select", target: n.id }) },

    { id: "exposed-state", sev: "risk", tag: "Risk",
      when: (c) => c.exposedPair(),
      title: (c) => { const p = c.exposedPair(); return "“" + p[0].name + "” talks straight to “" + p[1].name + "”"; },
      why: () => "That means the database password ships to every visitor's browser. Put something you run in between.",
      marks: (c) => c.exposedPair().map((n) => n.id) },

    { id: "no-service", sev: "missing", tag: "Missing",
      when: (c) => c.any("user-facing") && !c.any("we-run-it"),
      title: () => "Nothing to send requests to",
      why: () => "A browser or phone can't hold your data or your secrets. It needs a server to talk to.",
      marks: (c) => [c.first("user-facing").id],
      act: (c) => ({ label: "Add API server", add: { kind: "api", name: "API server",
        intent: "Handles requests from the app and talks to everything else.",
        from: c.first("user-facing").id, label: "requests" } }) },

    { id: "no-persistence", sev: "missing", tag: "Missing",
      when: (c) => c.any("we-run-it") && !c.any("persists"),
      title: () => "Nothing here remembers anything",
      why: () => "Right now every restart loses all of it. You need somewhere durable to keep records.",
      marks: (c) => [c.first("we-run-it").id],
      act: (c) => ({ label: "Add database", add: { kind: "db", name: "Database",
        intent: "Stores accounts, posts and anything else that has to survive a restart.",
        from: c.first("we-run-it").id, label: "reads / writes" } }) },

    { id: "unprotected-state", sev: "risk", tag: "Risk",
      when: (c) => c.personalStore() && !c.any("authorizes"),
      title: () => "Personal data, and nothing checking who's asking",
      why: () => "Anyone who reaches it can read anyone's records. Something has to prove who is making each request.",
      marks: (c) => [c.personalStore().id],
      act: (c) => ({ label: "Add accounts", add: { kind: "auth", name: "Accounts",
        intent: "Signs people up, logs them in, and proves who is making each request.",
        from: (c.first("we-run-it") || c.personalStore()).id, label: "verifies" } }) },

    { id: "unwired-pair", sev: "unwired", tag: "Not wired up",
      when: (c) => c.any("we-run-it") && c.any("persists") && !c.linked(c.first("we-run-it").id, c.first("persists").id)
                   && c.first("we-run-it").id !== c.first("persists").id,
      title: () => "The server and the database aren't connected",
      why: () => "Draw the line so it's clear which block owns the data.",
      marks: (c) => [c.first("we-run-it").id, c.first("persists").id],
      act: (c) => ({ label: "Connect them", wire: { from: c.first("we-run-it").id, to: c.first("persists").id, label: "reads / writes" } }) },

    { id: (c, n) => "orphan-" + n.id, each: "node", sev: "unwired", tag: "Not wired up",
      when: (c, n) => c.onSheet.length > 1 && c.degree(n.id) === 0 && !c.isContainer(n.id),
      title: (c, n) => "“" + n.name + "” isn't connected to anything",
      why: () => "Every block should exchange something with at least one other, or it isn't part of the system.",
      marks: (c, n) => [n.id] },

    { id: (c, e) => "no-contract-" + e.id, each: "edge", sev: "unwired", tag: "Undefined",
      when: (c, e) => e.operations.length === 0,
      title: (c, e) => "What actually crosses " + c.name(e.from) + " → " + c.name(e.to) + "?",
      why: (c, e) => "“" + (e.label || "connects") + "” isn't enough to build against. Name one call, what it sends, and what comes back.",
      marks: (c, e) => [e.from, e.to],
      act: (c, e) => ({ label: "Define the calls", kind: "selectEdge", target: e.id }) },

    /* ---------- domain: category + what the sentence says ---------- */

    { id: "need-auth", sev: "missing", tag: "Missing",
      when: (c) => c.mentions(["sign up", "signup", "log in", "login", "account", "user", "profile", "password"]) && !c.any("authorizes"),
      title: () => "You mention accounts, but nothing checks who someone is",
      why: () => "Anyone could act as anyone else. Never store passwords yourself — use a service or a hashing library.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add accounts", add: { kind: "auth", name: "Accounts",
        intent: "Signs people up, logs them in, and proves who is making each request.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "verifies" } }) },

    { id: "need-storage", sev: "missing", tag: "Missing",
      when: (c) => c.mentions(["photo", "image", "upload", "file", "video", "avatar", "picture", "attachment", "pdf"]) && !c.cat("blob"),
      title: () => "Where do the uploads go?",
      why: () => "Files don't belong in a database — they'll make it slow and expensive. Put them in object storage and keep only the link.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add file storage", add: { kind: "storage", name: "File storage",
        intent: "Holds uploaded photos and files. The database keeps only the URL.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "puts / gets" } }) },

    { id: "need-payments", sev: "missing", tag: "Missing",
      when: (c) => c.mentions(["pay", "payment", "checkout", "subscription", "billing", "card", "purchase", "buy"]) && !c.cat("payments"),
      title: () => "You mention money, but nothing takes it",
      why: () => "Never touch card numbers yourself. Hand it to a payment provider and let them carry the compliance.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add payments", add: { kind: "payments", name: "Payments",
        intent: "Takes card details through a provider so we never store them.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "charges" } }) },

    { id: "need-webhook", sev: "missing", tag: "Missing",
      when: (c) => c.cat("payments") && !c.cat("inbound-events"),
      title: () => "Payments will call you back — nothing is listening",
      why: () => "A card can succeed minutes later, or fail after you've shipped. The provider tells you by calling a URL you expose.",
      marks: (c) => [c.cat("payments").id],
      act: (c) => ({ label: "Add incoming events", add: { kind: "webhooks", name: "Incoming events",
        intent: "Receives callbacks from the payment provider and updates the order.",
        from: c.cat("payments").id, label: "notifies" } }) },

    { id: "pay-no-auth", sev: "risk", tag: "Risk",
      when: (c) => c.cat("payments") && !c.any("authorizes"),
      title: () => "You can't charge someone you can't identify",
      why: () => "Payments without accounts means no receipts, no refunds and no way to prove who agreed to what.",
      marks: (c) => [c.cat("payments").id],
      act: (c) => ({ label: "Add accounts", add: { kind: "auth", name: "Accounts",
        intent: "Signs people up and proves who is making each request.",
        from: (c.first("we-run-it") || c.cat("payments")).id, label: "verifies" } }) },

    { id: "need-session", sev: "idea", tag: "Worth adding",
      when: (c) => c.any("authorizes") && !c.cat("fast-store"),
      title: () => "Sessions need somewhere to live",
      why: () => "Once someone logs in you have to remember them between requests — that's a session store, not your main database.",
      marks: (c) => [c.first("authorizes").id],
      act: (c) => ({ label: "Add session store", add: { kind: "cache", name: "Session store",
        intent: "Keeps login sessions and short-lived tokens. Fast, and safe to lose.",
        from: c.first("authorizes").id, label: "sessions" } }) },

    { id: "need-email", sev: "idea", tag: "Worth adding",
      when: (c) => c.mentions(["email", "notify", "notification", "reset password", "welcome", "invite", "confirm"]) && !c.cat("email"),
      title: () => "Something has to actually send the mail",
      why: () => "Sending from your own server lands in spam. Use a provider, and send from a background job so nobody waits on it.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add email & alerts", add: { kind: "email", name: "Email & alerts",
        intent: "Sends sign-up confirmations, password resets and notifications.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "sends" } }) },

    { id: "need-jobs", sev: "idea", tag: "Worth adding",
      when: (c) => c.mentions(["resize", "export", "report", "daily", "scheduled", "cron", "batch", "process", "transcode", "thumbnail"]) && !c.cat("queue"),
      title: () => "Slow work shouldn't happen while someone waits",
      why: () => "Anything past about a second — resizing, exports, bulk sends — belongs in a queue the server hands off to.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add background work", add: { kind: "jobs", name: "Background work",
        intent: "Runs the slow jobs — resizing images, exports, scheduled sends.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "enqueues" } }) },

    { id: "need-realtime", sev: "idea", tag: "Worth adding",
      when: (c) => c.mentions(["chat", "live", "realtime", "real-time", "presence", "typing", "instant"]) && !c.cat("realtime"),
      title: () => "“Live” means a connection that stays open",
      why: () => "Normal requests only go one way. To push updates out you need websockets or a hosted realtime service.",
      marks: (c) => [(c.first("we-run-it") || c.onSheet[0]).id],
      act: (c) => ({ label: "Add live updates", add: { kind: "realtime", name: "Live updates",
        intent: "Keeps a connection open so changes appear without a refresh.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "pushes" } }) },

    { id: "need-search", sev: "idea", tag: "Worth adding",
      when: (c) => c.mentions(["search", "filter", "find", "browse", "discover"]) && c.any("persists") && !c.cat("search"),
      title: () => "Search gets slow before you expect it to",
      why: () => "A database <code>LIKE</code> query works for a few thousand rows, then falls over. A search index is built for this.",
      marks: (c) => [c.first("persists").id],
      act: (c) => ({ label: "Add search index", add: { kind: "search", name: "Search index",
        intent: "Keeps a searchable copy of posts so queries stay fast.",
        from: c.first("persists").id, label: "indexes" } }) },

    { id: "need-logs", sev: "idea", tag: "Worth adding",
      when: (c) => c.onSheet.length >= 4 && !c.cat("observability"),
      title: () => "Four blocks in, and no way to see what broke",
      why: () => "When something fails at 2am you want a log to read, not a guess. Add it before you need it.",
      marks: () => [],
      act: (c) => ({ label: "Add logs & alerts", add: { kind: "logs", name: "Logs & alerts",
        intent: "Collects errors and timings from every block, and pages someone when it's bad.",
        from: (c.first("we-run-it") || c.onSheet[0]).id, label: "reports to" } }) },

    /* ---------- the sheet itself ---------- */

    { id: "crowded", sev: "idea", tag: "Getting crowded",
      when: (c) => c.onSheet.length > 6,
      title: (c) => "That's " + c.onSheet.length + " blocks on one sheet",
      why: (c) => {
        const g = c.groupable();
        return g
          ? "About six is what anyone can hold in their head at once. “" + esc(g.names.join("”, “")) +
            "” only ever talk to " + esc(g.hub.name) + " — they can fold away behind it and open again when you need them."
          : "About six is what anyone can hold in their head at once. Once blocks are connected, plangolin can fold a cluster away behind a single block — right now nothing is wired up enough to fold.";
      },
      marks: (c) => { const g = c.groupable(); return g ? [g.hub.id] : []; },
      act: (c) => { const g = c.groupable(); return g ? { label: "Group those " + g.ids.length,
        group: { ids: g.ids, name: g.label, near: g.hub.id } } : null; } },
  ];

  /* A cluster worth folding: blocks that hang off exactly one hub and talk to
     nothing else. The way *in* to a system is never a supporting detail, so a
     user-facing block is never folded away — that's a trait question now, not
     a hardcoded list of kinds. */
  function groupable() {
    let best = null;
    currentLevelNodes().forEach((hub) => {
      if (isContainer(hub.id)) return;
      const leaves = currentLevelNodes().filter((n) =>
        n.id !== hub.id && !isContainer(n.id) &&
        !traitsOf(n).has("user-facing") &&
        degree(n.id) === 1 && linked(n.id, hub.id));
      if (leaves.length >= 2 && (!best || leaves.length > best.ids.length)) {
        best = { hub: hub, ids: leaves.map((n) => n.id), names: leaves.map((n) => n.name),
                 label: hub.name + " services" };
      }
    });
    return best;
  }

  /* ---------- the engine. It knows nothing about any particular rule. ---------- */

  function context() {
    const onSheet = currentLevelNodes();
    const traits = new Map();
    S.nodes.forEach((n) => traits.set(n.id, traitsOf(n)));

    const c = {
      onSheet: onSheet,
      nodes: S.nodes,
      edges: S.edges,
      isContainer: isContainer,
      degree: degree,
      linked: linked,
      groupable: groupable,
      name: (id) => (node(id) || {}).name || id,
      is: (n, t) => traits.get(n.id).has(t),
      any: (t) => onSheet.some((n) => traits.get(n.id).has(t)),
      all: (t) => onSheet.filter((n) => traits.get(n.id).has(t)),
      first: (t) => onSheet.find((n) => traits.get(n.id).has(t)),
      cat: (k) => onSheet.find((n) => categoryOf(n.kind) === k),
      mentions: (words) => { const s = corpus(); return words.some((w) => s.includes(w)); },

      // a user-facing block wired straight to something that persists,
      // with nothing we run in between
      exposedPair: () => {
        for (const a of onSheet) {
          if (!traits.get(a.id).has("user-facing")) continue;
          for (const e of S.edges) {
            const other = e.from === a.id ? node(e.to) : e.to === a.id ? node(e.from) : null;
            if (!other) continue;
            const t = traits.get(other.id);
            if (t && t.has("persists") && !t.has("we-run-it")) return [a, other];
            if (t && t.has("persists") && categoryOf(other.kind) === "store") return [a, other];
          }
        }
        return null;
      },

      personalStore: () => onSheet.find((n) =>
        traits.get(n.id).has("persists") &&
        /\baccounts?\b|\bpeople\b|\busers?\b|personal|profile|customer/i.test(n.intent + " " + n.name)),
    };
    return c;
  }

  function planCheck() {
    const c = context();
    const out = [];

    for (const rule of RULES) {
      const items = rule.each === "node" ? c.onSheet
                  : rule.each === "edge" ? S.edges
                  : [null];
      for (const item of items) {
        let fires;
        try { fires = rule.when(c, item); } catch (err) { fires = false; }   // a rule that throws stays quiet
        if (!fires) continue;
        const id = typeof rule.id === "function" ? rule.id(c, item) : rule.id;
        if (S.dismissed.indexOf(id) !== -1) continue;
        out.push({
          id: id, sev: rule.sev, tag: rule.tag,
          title: rule.title(c, item),
          why: rule.why(c, item),
          marks: (rule.marks ? rule.marks(c, item) : []).filter(Boolean),
          act: rule.act ? rule.act(c, item) : null,
        });
      }
    }

    const order = { risk: 0, missing: 1, unwired: 2, idea: 3 };
    return out.sort((x, y) =>
      (y.id === "crowded") - (x.id === "crowded") || order[x.sev] - order[y.sev]);
  }

  /* ============================ geometry ============================ */

  const NODE_W = 198;
  const heights = {};

  function anchors(e) {
    return between(node(e.from), node(e.to));
  }

  /* Takes the two ends as drawn, not as ids. A proposed line has an end that
     is not in S.nodes at all — a ghost, positioned for the length of one
     review — and it has to come out of the same builder as every other line
     or the two would drift apart. */
  function between(a, b) {
    if (!a || !b) return null;
    const ha = heights[a.id] || 80, hb = heights[b.id] || 80;
    const forward = b.x >= a.x;
    return {
      x1: forward ? a.x + NODE_W : a.x, y1: a.y + ha / 2,
      x2: forward ? b.x : b.x + NODE_W,  y2: b.y + hb / 2,
      dir: forward ? 1 : -1
    };
  }

  // `spread` bows the line sideways so several lines between the same two
  // blocks read as a group and as countable strands at once, rather than
  // stacking into one. Holten found the same thing with edge bundling: fully
  // merging hides how many edges a bundle holds, and a strength short of full
  // "retains visual bundles while still resolving ambiguity".
  function curve(p, spread) {
    const dx = Math.max(46, Math.abs(p.x2 - p.x1) * 0.45) * p.dir;
    const s = spread || 0;
    return "M " + p.x1 + " " + p.y1 +
      " C " + (p.x1 + dx) + " " + (p.y1 + s) + ", " + (p.x2 - dx) + " " + (p.y2 + s) + ", " + p.x2 + " " + p.y2;
  }

  // Deterministic wobble so the review circle reads as hand-drawn, not vector-perfect.
  function roughEllipse(cx, cy, rx, ry, seedNum) {
    let s = seedNum * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const pts = [];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2 * 1.06 - 0.3;
      const j = 1 + (rnd() - 0.5) * 0.055;
      pts.push([cx + Math.cos(t) * rx * j, cy + Math.sin(t) * ry * j]);
    }
    return "M " + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L ");
  }

  /* ======================= brand mark =======================
     The pangolin in the masthead. Low-frequency drift rather than per-vertex
     noise: a hand drifts slowly and overshoots, it does not jitter. Drawn once
     at load and again on a theme change — never during interaction.

     Sized to the drawing's real ink bounds, not to a padded box, so it fits the
     existing masthead line without adding a pixel of height.

     The back and tail are NOT stroked. Their contour is formed by the tips of
     the outermost scales, which is what gives a pangolin its sawtooth
     silhouette — the one thing an armadillo never has, because its bands make a
     smooth outline. Only the bare parts carry an ink line: the conical head and
     the belly.                                                             */

  // The only knob. A walking pangolin is a 3.4:1 silhouette, so this trades
  // directly against how large the animal reads — there is no slack left in the
  // box to crop.
  const MARK_W = 56;
  const MARK_BOX = { x: 1, y: 8, w: 122, h: 35 };

  const PG = {
    // ridge the outermost scales ride on: a small head, then a strong arch
    dorsal: [[4,32],[9,29.5],[15,27],[21,23.5],[28,19],[36,15],[45,12.8],[54,13.2],
             [63,15.6],[71,18.8],[80,22.4],[89,26],[98,29.6],[106,33],[113,35.8],[118,37.6]],
    // bare underside, nose -> chin -> chest -> belly -> vent
    belly:  [[4,32],[9,34],[15,35.4],[23,36.6],[32,37.6],[42,38.2],[52,38],[61,36.8],[68,35]],
    // tail underside — the tail is plated top and bottom, so this is scaled too
    tailLo: [[68,35],[76,34.6],[85,35.6],[94,36.8],[102,37.8],[110,38.6],[118,37.6]],
    // lower limit of trunk armour; everything below it is bare hide
    lo:     [[20,27],[27,28.6],[35,30],[44,31],[53,31.4],[61,31.4],[68,31.6]],
    // stubby and tucked well under — in profile a pangolin reads as almost legless
    fore:   [[29,37.2],[28.4,40],[26.8,41.6]],
    hind:   [[57,36.4],[58,39.6],[56.6,41.4]],
  };

  function driftFn(seedNum) {
    let s = seedNum * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const a = [[1, rnd() * 6.283], [1.7, rnd() * 6.283], [2.6, rnd() * 6.283]];
    return (t) => (Math.sin(t * a[0][0] + a[0][1]) * 0.55 +
                   Math.sin(t * a[1][0] + a[1][1]) * 0.30 +
                   Math.sin(t * a[2][0] + a[2][1]) * 0.15) * 0.0275;
  }

  function markWobble(pts, seedNum, amp) {
    const dx = driftFn(seedNum), dy = driftFn(seedNum + 977);
    return pts.map((p, i) => {
      const t = (i / pts.length) * 6.283;
      return [p[0] + dx(t) * amp, p[1] + dy(t) * amp];
    });
  }

  function markPath(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1],
        (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (close) ctx.closePath();
  }

  function alongPoly(pts, t) {
    const n = pts.length - 1;
    const x = Math.max(0, Math.min(0.99999, t)) * n;
    const i = Math.floor(x), f = x - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
            pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
  }

  /* one keratin scale — broad base, free tip pointing back toward the tail */
  function markScale(ctx, cx, cy, w, h, ang, fill) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, -h);
    ctx.quadraticCurveTo(w * 0.72, -h * 0.78, w, 0);
    ctx.quadraticCurveTo(w * 0.72, h * 0.78, -w * 0.55, h);
    ctx.quadraticCurveTo(-w * 0.92, 0, -w * 0.55, -h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  /* The bulb is drawn, not iconographic — same drift function as the mark and
     the review circle, so the thing that tells you something is wrong is
     visibly the same hand that drew the sheet. Dark filament when clean; lit,
     and glowing in the highest open severity, when not. */
  const BULB = {
    glass: [[10,2.4],[14.4,4],[16.6,7.8],[16.1,11.6],[13.4,14.4],[13,16.6],
            [7,16.6],[6.6,14.4],[3.9,11.6],[3.4,7.8],[5.6,4],[10,2.4]],
    cap:   [[7.1,17.9],[12.9,17.9]],
    cap2:  [[7.4,19.4],[12.6,19.4]],
    coil:  [[8.2,13.6],[8.9,10.6],[10,12.4],[11.1,10.6],[11.8,13.6]],
    rays:  [[[10,0.4],[10,-1.6]], [[17.6,3.2],[19.1,1.7]], [[2.4,3.2],[0.9,1.7]],
            [[19.2,9.6],[21.2,9.6]], [[0.8,9.6],[-1.2,9.6]]],
  };

  /* The way back to what you asked for. Drawn rather than iconographic, from
     the same wobble as the bulb it replaces and the mark on the sheet — a
     question set in a UI font next to hand-drawn blocks reads as a control
     borrowed from somewhere else.

     Two strokes and a dot, in the bulb's 22-unit space so both marks sit at
     the same weight: the hook, and the point under it. */
  const ASK = {
    hook: [[5.2,6.6],[5.8,3.6],[8.4,2.1],[11.6,2.4],[13.7,4.4],[13.6,7.2],
           [11.4,9.1],[10.2,10.8],[10.05,12.7]],
    dot:  [[10,15.9],[10.5,16.2],[10.3,16.9],[9.6,16.9],[9.5,16.2],[10,15.9]],
  };

  let lastBulbSev = null;


  /* Same construction as drawBulb, minus the severity states: this control has
     nothing to warn about. It says "here is the sentence you typed", and the
     only thing it ever needs to be is legible. */
  function drawAsk() {
    const cv = document.getElementById("ask-mark");
    if (!cv) return;
    const W = 26, H = 30, dpr = window.devicePixelRatio || 1;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const k = W / 22, amp = 300 / W;
    ctx.save();
    ctx.translate(1.6, 4);
    ctx.scale(k, k);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = css.getPropertyValue("--ink").trim();
    ctx.lineWidth = 1.7;
    markPath(ctx, markWobble(ASK.hook, 23, amp), false); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    markPath(ctx, markWobble(ASK.dot, 51, amp * .5), true); ctx.fill();
    ctx.restore();
  }

  function drawBulb(sev) {
    lastBulbSev = sev;
    const cv = document.getElementById("bulb-mark");
    if (!cv) return;
    const W = 26, H = 30, dpr = window.devicePixelRatio || 1;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const ink = v("--ink");
    const lit = sev ? v(sev === "risk" ? "--risk" : sev === "idea" ? "--idea" : "--missing") : null;

    const k = W / 22;
    ctx.save();
    ctx.translate(1.6, 4);
    ctx.scale(k, k);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const amp = 300 / W;

    // CSS needs the colour too, for the hover drop-shadow.
    cv.parentElement.style.setProperty("--bulb-glow", lit || "transparent");

    if (lit) {                                  // glow first, under the linework
      const hot = cv.parentElement.matches(":hover");
      ctx.save();
      ctx.globalAlpha = hot ? 0.34 : 0.22;
      ctx.fillStyle = lit;
      ctx.beginPath(); ctx.arc(10, 9.6, hot ? 9.8 : 8.6, 0, 6.283); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = lit; ctx.lineWidth = 1.5;
      BULB.rays.forEach((r, i) => { markPath(ctx, markWobble(r, 60 + i * 31, amp * .5), false); ctx.stroke(); });
    }

    ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    markPath(ctx, markWobble(BULB.glass, 17, amp), false); ctx.stroke();
    markPath(ctx, markWobble(BULB.cap, 44, amp * .4), false); ctx.stroke();
    markPath(ctx, markWobble(BULB.cap2, 71, amp * .4), false); ctx.stroke();

    ctx.strokeStyle = lit || v("--ink-faint");
    ctx.lineWidth = lit ? 1.6 : 1.2;
    markPath(ctx, markWobble(BULB.coil, 98, amp * .5), false); ctx.stroke();
    ctx.restore();
  }

  function drawBrandMark(width) {
    const cv = document.getElementById("brand");
    if (!cv) return;

    const w = width || MARK_W;
    const h = Math.round(w * (MARK_BOX.h / MARK_BOX.w));
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);

    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const ink = v("--ink"), lit = v("--scale-lit"),
          deep = v("--scale-deep"), hide = v("--hide");

    const k = w / MARK_BOX.w;
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(-MARK_BOX.x, -MARK_BOX.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const amp = 260 / w;
    const dors = markWobble(PG.dorsal, 41, amp);
    const bel  = markWobble(PG.belly, 354, amp);
    const tlo  = markWobble(PG.tailLo, 512, amp);

    // 1. the whole animal as bare hide; the armour goes on top of it
    markPath(ctx, dors.concat(tlo.slice().reverse(), bel.slice().reverse()), true);
    ctx.fillStyle = hide;
    ctx.fill();

    // 2. limbs first, so the armour overlaps the shoulder and haunch
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.7, 1.4 / k);
    markPath(ctx, markWobble(PG.hind, 331, amp * 0.4), false); ctx.stroke();
    markPath(ctx, markWobble(PG.fore, 300, amp * 0.4), false); ctx.stroke();

    // 3. armour, laid tail-first so each scale tucks under the one ahead of it.
    //    The outermost scale is centred ON the contour, not inset, so its tip
    //    breaks the silhouette — that sawtooth edge is the whole point.
    // Fewer, larger scales read better small than more, smaller ones.
    const rows = w > 85 ? 13 : (w > 64 ? 11 : 9);
    for (let r = rows - 1; r >= 0; r--) {
      const s = r / (rows - 1);
      const t = 0.16 + s * 0.84;
      const top = alongPoly(PG.dorsal, t);
      const nxt = alongPoly(PG.dorsal, Math.min(0.999, t + 0.05));
      const ang = Math.atan2(nxt[1] - top[1], nxt[0] - top[0]);
      const taper = 1 - s * 0.46;
      const sw = 6.4 * taper, sh = 3.5 * taper;

      // trunk armour stops at PG.lo; on the tail it wraps to the underside
      const onTail = s > 0.52;
      const low = onTail
        ? alongPoly(PG.tailLo, (s - 0.52) / 0.48)
        : alongPoly(PG.lo, s / 0.52);

      markScale(ctx, top[0] + sw * 0.18, top[1], sw, sh, ang, lit);
      markScale(ctx, top[0] + (low[0] - top[0]) * 0.55 + sw * 0.15,
                     top[1] + (low[1] - top[1]) * 0.55,
                     sw * 0.9, sh * 0.86, ang, deep);
      if (onTail) {
        markScale(ctx, low[0] + sw * 0.15, low[1], sw * 0.82, sh * 0.8, ang, deep);
      }
    }

    // 4. ink only where there is no armour: the head, then the belly
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.85, 1.8 / k);
    markPath(ctx, dors.slice(0, 4), false);
    ctx.stroke();
    markPath(ctx, bel, false);
    ctx.stroke();

    // 5. the eye sits low and far forward on a very small head
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(13.5, 31.4, 1.0, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  /* --------------------------- the roll ----------------------------

     A pangolin under threat curls into a ball — it is the one thing the
     animal is known for, and the Malay name it is called by, pengguling,
     means "the one that rolls". So the wait already had a spinner in it;
     nothing needed inventing.

     Same hand as the masthead: the same markScale, the same three mascot
     tones, the same rule that armour is never outlined — its edge is made
     of scale tips, which is what gives the rim its sawtooth.

     Two things make the rotation legible. The snout stays put relative to
     the ball and travels round with it, so there is something to follow;
     and the lighting does NOT, because the fill is picked from each
     scale's angle in the world rather than on the body. Plates therefore
     brighten as they come over the top and darken as they go under, which
     is what tells you the ball is turning rather than the drawing spinning. */

  const BALL_BOX = 100;
  const BALL_R = 40;

  /* A curled pangolin is an artichoke, not an ammonite — which is what a
     visible spiral made of it. Three things from the animal decide the
     drawing:

       the face tucks UNDER THE TAIL, so nothing of the head shows;
       the plates overlap enough to curl "without exposing bare spots",
         so no bare hide shows either;
       the curve makes THE SHARP EDGES STICK OUT, which is the rim.

     So: staggered rows of plates covering the whole disc, tips flaring
     outward rather than lying flat, drawn centre-first so each row lies
     over the one inside it and the outermost tips break the silhouette.

     Rotation is read from the tail — one run of larger plates riding a
     little proud of the rest, sweeping round as it turns. It is the only
     landmark a featureless ball of armour can honestly have. */
  const BALL_ROWS = [
    { r: 0.00, n: 1,  size: 0.62 },
    { r: 0.26, n: 6,  size: 0.78 },
    { r: 0.48, n: 10, size: 0.88 },
    { r: 0.68, n: 14, size: 0.96 },
    { r: 0.86, n: 18, size: 1.00 },
    { r: 1.00, n: 21, size: 0.96 },
  ];
  const BALL_TAIL = 7;      // plates in the tail band
  const BALL_LEAN = 0.42;   // how far a tip leans off straight-out

  /** Read once per open, not once per frame — getComputedStyle forces a
      style resolve, and sixty of those a second for five values that only
      change with the theme is the kind of thing that makes a small
      animation feel heavy on a laptop. */
  /* Small colour arithmetic, so a plate can be lipped by a darker copy of
     its own tone rather than by one fixed dark that disappears against the
     shaded side. Hex in, hex out; the CSS variables are all #rrggbb. */
  const hexOf = (c) => {
    const h = String(c).trim().replace("#", "");
    const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
  };
  const toHex = (rgb) =>
    "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

  function mixHex(a, b, t) {
    const x = hexOf(a), y = hexOf(b), f = Math.max(0, Math.min(1, t));
    return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * f));
  }
  const shade = (c, amount) => toHex(hexOf(c).map((v) => v * (1 - amount)));

  function ballPalette() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    return { ink: v("--ink"), lit: v("--scale-lit"), mid: v("--scale"),
             deep: v("--scale-deep"), hide: v("--hide") };
  }

  function drawRolled(cv, size, angle, pal) {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    // Resizing a canvas clears it, so only touch the attributes when they
    // actually differ — otherwise every frame pays for a reallocation.
    if (cv.width !== px) {
      cv.style.width = size + "px";
      cv.style.height = size + "px";
      cv.width = px;
      cv.height = px;
    }

    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const { ink, lit, mid, deep, hide } = pal || ballPalette();

    const k = size / BALL_BOX;
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(BALL_BOX / 2, BALL_BOX / 2);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const amp = 260 / size;
    const wob = markWobble([[0, 0]], 41, amp)[0];   // one shared hand-drift

    // 1. the mass underneath. Never seen once the armour is on, but it
    //    stops a hairline of paper showing between plates.
    ctx.beginPath();
    ctx.arc(wob[0], wob[1], BALL_R * 0.86, 0, 6.283);
    ctx.fillStyle = deep;
    ctx.fill();

    // Light sits above the sheet, so a plate is brightest at the top of its
    // travel and darkest underneath. Taken from the angle in the WORLD, not
    // on the body, so the shading stays put while the animal turns — that
    // is what reads as rolling rather than as a picture being spun.
    //
    // A continuous ramp, not three bands: banding made the whole underside
    // one flat tone, and a plate the same colour as its own shadow has no
    // edge, so the bottom half collapsed into a blob.
    const toneAt = (world) => {
      const up = -Math.sin(world);                 // -1 under, +1 over
      return up >= 0 ? mixHex(mid, lit, up) : mixHex(mid, deep, -up);
    };

    const plate = (world, rr, w, h, lean, fill) => {
      const cx = Math.cos(world) * rr + wob[0];
      const cy = Math.sin(world) * rr + wob[1];
      // Every plate is lipped by a darker copy of ITSELF, so the edge holds
      // wherever it is in the roll rather than only where the body is pale.
      markScale(ctx, cx + 0.5, cy + 0.5, w * 1.09, h * 1.14, world + lean, shade(fill, 0.3));
      markScale(ctx, cx, cy, w, h, world + lean, fill);
    };

    // 2. the armour, centre outward so each row lies over the one inside it
    for (const row of BALL_ROWS) {
      for (let i = 0; i < row.n; i++) {
        // Rows offset by half a step, so plates sit in the gaps of the row
        // beneath instead of lining up into spokes.
        const world = ((i + (row.n % 2 ? 0.5 : 0)) / row.n) * 6.283 + angle;
        const rr = BALL_R * row.r * 0.82;
        plate(world, rr, 9.6 * row.size, 5.6 * row.size, BALL_LEAN, toneAt(world));
      }
    }

    // 3. the tail, laid over the back. The one landmark on the ball, so the
    //    turn can be followed without inventing a face that should be
    //    tucked out of sight.
    for (let i = 0; i < BALL_TAIL; i++) {
      const t = i / (BALL_TAIL - 1);
      const world = angle + 1.15 + t * 1.5;
      // Rides the outer row rather than outside it — sitting proud of the
      // silhouette made the ball bulge on one side instead of turning.
      const rr = BALL_R * (0.82 - t * 0.14);
      const grow = 1.16 - t * 0.24;
      plate(world, rr, 9.6 * grow, 5.6 * grow, BALL_LEAN - 0.08, toneAt(world));
    }

    ctx.restore();
  }

  /* ---------------------------- the face ----------------------------

     Head-on, for the tab icon. Same rule as the side mark: the armoured
     part is not outlined — its edge is made of scale tips — and ink only
     touches bare hide.

     A round head with big eyes is the infant schema and reads as a cartoon
     baby whatever you put on it, so the proportions come off the animal
     instead. A pangolin's head is a narrow wedge: armour wraps it like a
     hood from temple to temple, the bare muzzle tapers well past where a
     mammal's face would stop, and the eyes are very small and set at the
     sides where the hood meets bare skin. The wedge is doing the work the
     sawtooth back does on the side mark.

     Drawn in a 32-unit box and rasterised small, so everything is blunter
     than scale realism wants. Nine hood scales is the most that still reads
     as separate scales at 16px rather than as texture. */

  const FACE_BOX = { x: 3.7, y: 4.4, w: 24.6, h: 24.6 };
  const FACE_MID = [16, 17];

  const PGF = {
    // the contour the outermost scales ride on — a hood, left temple up
    // over the crown and back down to the right. Not stroked.
    hood:   [[8.0,16.0],[8.2,11.8],[10.0,8.4],[12.8,6.2],[16,5.5],
             [19.2,6.2],[22.0,8.4],[23.8,11.8],[24.0,16.0]],
    // bare hide: the long muzzle, right temple down to a blunt rounded tip
    // and back up the left. Converging to a point makes an arrowhead.
    muzzle: [[24.0,16.0],[23.2,20.2],[21.4,23.8],[19.0,26.6],[17.4,28.4],[16,29.0],
             [14.6,28.4],[13.0,26.6],[10.6,23.8],[8.8,20.2],[8.0,16.0]],
  };

  function drawFace(ctx, css) {
    const v = (n) => css.getPropertyValue(n).trim();
    const ink = v("--ink"), lit = v("--scale-lit"),
          deep = v("--scale-deep"), hide = v("--hide");

    const hood   = markWobble(PGF.hood, 88, 1.2);
    const muzzle = markWobble(PGF.muzzle, 613, 1.2);

    // 1. the whole head as bare hide, armour on top
    markPath(ctx, hood.concat(muzzle.slice(1)), true);
    ctx.fillStyle = hide;
    ctx.fill();

    // 2. ink on the bare parts only — the muzzle, never the hood. Laid
    //    before the armour so the blunt ends of the line disappear under
    //    the jaw-corner scales instead of stopping in mid-air.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.8;
    markPath(ctx, muzzle, false);
    ctx.stroke();

    // 3. the armour, in two different registers.
    //
    //    Head scales lie almost flat against the skull and overlap backward,
    //    so head-on you are looking at the flat of a plate, not the point of
    //    a spike. Every version of this that pointed scales outward from the
    //    centre came out as a sunburst — a mane, a crown, a hedgehog. So the
    //    body of the armour is laid as rows of plates with their tips down
    //    the face, each row drawn over the one above it so its scalloped
    //    edge shows, which is what tiling actually looks like.
    //
    //    Only the topmost row keeps the radial angle, and only just enough
    //    to notch the crown line — the house rule is that armour makes the
    //    silhouette, and a completely smooth dome would drop it.
    const ang = (p) => Math.atan2(p[1] - FACE_MID[1], p[0] - FACE_MID[0]);

    for (let i = 0; i < 9; i++) {
      const p = alongPoly(PGF.hood, i / 8);
      const k2 = 1 - Math.abs(i / 8 - 0.5) * 0.5;
      markScale(ctx, FACE_MID[0] + (p[0] - FACE_MID[0]) * 0.95,
                     FACE_MID[1] + (p[1] - FACE_MID[1]) * 0.95,
                     1.9 * k2, 1.2 * k2, ang(p), deep);
    }

    // Rows run top-down so each lower row overlaps the one behind it, and
    // are clipped to the head — laid out to reach past the skull on purpose,
    // so the outermost plate in each row is cut by the silhouette rather
    // than stopping short of it and leaving a bald rim.
    ctx.save();
    markPath(ctx, hood.concat(muzzle.slice(1)), true);
    ctx.clip();

    const DOWN = Math.PI / 2;
    const PLATES = [
      { y:  9.4, half: 4.6, n: 4 },
      { y: 12.8, half: 6.2, n: 5 },
      { y: 16.2, half: 7.4, n: 6 },
    ];
    for (const row of PLATES) {
      for (let i = 0; i < row.n; i++) {
        const x = 16 + (i / (row.n - 1) - 0.5) * row.half * 2;
        // splayed with distance from the midline, so the rows wrap the skull
        const a = DOWN + ((x - 16) / 16) * 0.55;
        markScale(ctx, x, row.y - 0.5, 2.3, 1.5, a, deep);
        markScale(ctx, x, row.y, 2.3, 1.5, a, lit);
      }
    }
    ctx.restore();

    // 4. eyes on the bare face just below the armour, small and well to the
    //    sides. A pangolin's are smaller still, but below about a dot this
    //    wide they stop reading as eyes and start reading as dirt.
    ctx.fillStyle = ink;
    for (const ex of [11.4, 20.6]) {
      ctx.beginPath();
      ctx.arc(ex, 19.4, 0.8, 0, 6.283);
      ctx.fill();
    }
    // a pair of nostrils at the tip. One dot in the middle of a face is a
    // mouth, and turns the whole thing back into a cartoon.
    for (const nx of [15.1, 16.9]) {
      ctx.beginPath();
      ctx.arc(nx, 26.9, 0.42, 0, 6.283);
      ctx.fill();
    }
  }

  /* Paints the face into an offscreen canvas and swaps the tab icon to it.
     Same theme dependency as the mark, so it is repainted on the same
     signals — a dark-theme icon drawn with light-theme ink disappears
     against the tab strip. */
  function drawFavicon(size) {
    const px = size || 64;
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const ctx = cv.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const k = px / FACE_BOX.w;
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(-FACE_BOX.x, -FACE_BOX.y);
    drawFace(ctx, getComputedStyle(document.documentElement));
    ctx.restore();

    const link = document.getElementById("favicon");
    if (link) link.href = cv.toDataURL("image/png");
    return cv;
  }

  /* ============================ render ============================ */

  let dragTemp = null;
  const overlay = document.getElementById("overlay");

  function sevColor(sev) {
    const css = getComputedStyle(document.documentElement);
    if (sev === "risk") return css.getPropertyValue("--risk").trim();
    if (sev === "idea") return css.getPropertyValue("--idea").trim();
    return css.getPropertyValue("--missing").trim();
  }

  // A check points at what it means, the way a cutaway diagram labels a part —
  // and someone small is standing there working.
  function drawOverlay() {
    overlay.innerHTML = "";
    if (!hoverCheck) return;
    const card = checksEl.querySelector('.check[data-id="' + hoverCheck.id + '"]');
    if (!card) return;
    const cr = card.getBoundingClientRect();
    const colour = sevColor(hoverCheck.sev);
    const ns = "http://www.w3.org/2000/svg";
    const add = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach((a) => el.setAttribute(a, attrs[a]));
      overlay.appendChild(el);
      return el;
    };

    const canvasRect = canvas.getBoundingClientRect();
    const el = world.querySelector('.node[data-id="' + levelAncestor(primaryMark()) + '"]');
    if (!el) return;
    const nr = el.getBoundingClientRect();
    if (nr.right < canvasRect.left || nr.left > canvasRect.right) return;

    /* The panel is on the left now, so the leader leaves its right edge and
       approaches the block from the left. It used to start at the card's left
       edge — correct for a right-hand rail, but with the panel over here that
       ran the line, and its halo, straight across the panel's own text. */
    const panel = document.getElementById("checkpanel");
    const pr = panel && panelOpen() ? panel.getBoundingClientRect() : null;
    const startX = pr ? pr.right + 8 : cr.right + 6;
    const y1 = Math.min(Math.max(cr.top + 20, canvasRect.top + 12), canvasRect.bottom - 12);
    const y2 = nr.top + nr.height / 2;
    const x2 = Math.max(nr.left - 14, startX + 12);

    /* If the block is still behind the panel the leader would double back over
       the thing it came from — but bailing entirely left the hover with no
       feedback at all, which is worse. Ring the block and skip the leader. */
    // The block is ringed by renderNodes regardless — that is what makes the
    // hover legible even when the block sits behind the panel and the leader
    // has to be skipped. Bailing out of this whole function used to take the
    // ring with it.
    if (nr.left < startX) return;

    const d = "M " + startX + " " + y1 + " V " + y2 + " H " + x2;
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper-2").trim();
    add("path", { d: d, fill: "none", stroke: paper, "stroke-width": 6, "stroke-linejoin": "round" });
    add("path", { d: d, class: "leader", stroke: colour });
    add("circle", { cx: x2, cy: y2, r: 3.2, class: "leader-dot", fill: colour });
    figure(add, Math.max(nr.left - 24, startX + 6), nr.bottom + 14);
  }

  // The block a check is really about — the rest are context, named in the title.
  function primaryMark() {
    return hoverCheck && hoverCheck.marks && hoverCheck.marks.length ? hoverCheck.marks[0] : null;
  }

  // ~26px tall, drawn in ink, one arm up at the thing being discussed.
  function figure(add, x, y) {
    add("circle", { cx: x, cy: y - 21, r: 4.2, class: "figure-fill" });
    add("path", { class: "figure", d:
      "M " + x + " " + (y - 16.5) + " V " + (y - 7) +
      " M " + x + " " + (y - 7) + " L " + (x - 4.5) + " " + y +
      " M " + x + " " + (y - 7) + " L " + (x + 4.5) + " " + y +
      " M " + x + " " + (y - 14) + " L " + (x + 8) + " " + (y - 19) +
      " M " + x + " " + (y - 14) + " L " + (x - 5.5) + " " + (y - 9) });
  }

  let saveTimer = null;
  function persist() {
    if (!ready) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      fetch("/api/doc", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toDoc(S)),
      }).catch(function (e) { console.warn("could not save:", e.message); });
    }, 400);
  }

  function render() {
    renderNotes();
    persist();
    applyCamera();
    renderNodes();
    renderBreadcrumb();
    renderHint();
    requestAnimationFrame(() => { measure(); renderWires(); });
    renderInspector();
    renderChecks();
    // The door belongs to the sheet, so it is drawn wherever the sheet is —
    // not only on the path that loads an existing one. A first scan arrives
    // at the graph through applyMove and render(), and leaving it out here
    // meant a new user's sheet had no way in until something happened to
    // trigger a sync.
    renderChangeBar();
    document.getElementById("stat").textContent =
      S.nodes.length + (S.nodes.length === 1 ? " block" : " blocks") + " · " +
      S.edges.length + (S.edges.length === 1 ? " line" : " lines");
  }

  function renderNodes() {
    [].slice.call(world.querySelectorAll(".node")).forEach((el) => el.remove());
    const flagged = new Set();
    if (hoverCheck) (hoverCheck.marks || []).forEach((m) => flagged.add(m));

    currentLevelNodes().forEach((n) => {
      const k = iconFor(n.kind);
      const kids = childrenOf(n.id).length;
      const moved = (changedInside.get(n.id) || []).length;
      // Looking at one change dims everything that isn't part of it. Dimmed,
      // not hidden: the rest of the system is the context that makes the part
      // legible, and a block that vanished would take its position with it.
      const outside = pickedGroup !== null && changeGroups[pickedGroup] &&
                      !changeGroups[pickedGroup].blocks.includes(n.id);
      const el = document.createElement("div");
      el.className = "node" + (S.sel && S.sel.type === "node" && S.sel.id === n.id ? " sel" : "") +
                     (flagged.has(n.id) ? " flagged" : "") + (kids ? " collapsed" : "") +
                     (moved ? " inside" : "") + (outside ? " aside" : "");
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      el.dataset.id = n.id;
      el.tabIndex = 0;
      el.innerHTML =
        (moved ? '<span class="node-changed">' + moved + ' changed</span>' : "") +
        // The block's own kind is what the badge says — design §5 makes kind
        // free text that drives the *icon*, with a generic icon when it isn't
        // recognised. Only a block with no kind at all falls back to the
        // category's label.
        // No title attribute — a native tooltip lingers over the canvas after
        // the pointer leaves, and the full text is in the inspector anyway.
        '<div class="node-top">' + k.icon + '<span class="node-kind">' + esc((n.kind || "").trim() || k.label) + "</span>" +
          // The child count keeps the pill. What changed has its own tab on
          // the top edge, so a block that holds three things and had two of
          // them change can say both.
          (kids ? '<span class="node-count">' + kids + ' inside</span>' : "") + "</div>" +
        '<div class="node-name">' + esc(n.name) + "</div>" +
        '<div class="node-intent' + (n.intent.trim() ? "" : " empty") + '">' +
          esc(n.intent.trim() || "What should this do?") + "</div>" +
        holdsHtml(n.id) +
        '<button class="port" data-port="' + n.id + '" aria-label="Connect from ' + esc(n.name) + '"></button>';
      world.appendChild(el);
    });

    /* The blocks a plan would add, drawn where they would go. They never enter
       S.nodes and never go through applyMove: nothing in a review is saved,
       and the sheet on disk is untouched until somebody builds the thing for
       real. No tabIndex and no port keep a ghost out of selection and wiring;
       dragging only changes the transient position held with this review. */
    ghostAt = new Map();
    if (!sheetLoaded || !plan || plan.status !== "ready") return;
    ghostAt = ghostPositions(plan.delta.additions);
    for (const a of plan.delta.additions) {
      const p = ghostAt.get(a.id);
      const k = iconFor(a.kind);
      const el = document.createElement("div");
      el.className = "node";
      el.dataset.id = a.id;
      el.dataset.proposed = "true";
      el.dataset.cut = String(planCut.has(planKey("add", a.id)));
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.innerHTML =
        '<div class="node-top">' + k.icon +
          '<span class="node-kind">' + esc((a.kind || "").trim() || k.label) + "</span></div>" +
        '<div class="node-name">' + esc(a.name) + "</div>" +
        '<div class="node-intent">' + esc(a.intent || "") + "</div>";
      world.appendChild(el);
    }
    // The elements were just replaced; put the spotlight back on the new ones.
    applyPlanLit();
  }

  /* Where a proposed block sits. Beside the block it connects to, because a
     proposal's whole meaning is its relationship to what already exists — and
     below the sheet when it connects to nothing, which is itself worth seeing.
     Deterministic so a ghost does not jump every two-second poll.
     Never written anywhere: a position for something that does not exist is
     not part of the document, so placeUnpositioned() never sees one. */
  const GHOST_DX = 260, GHOST_DY = 150;

  const boxesOverlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /* Nudges a candidate box clear of everything already claimed — real blocks
     and any ghost this same pass has already placed. Straight down a row at a
     time, same as the beside-the-hub rule already steps in GHOST_DY units, so
     a run of clashes reads as a column rather than a scatter. Six rows is the
     same "that's a lot on one sheet" threshold the crowded check uses — past
     it, stacking any further stops looking like a deliberate layout, so the
     sweep starts a new column instead. Both loops are bounded by `taken`,
     which is finite, so this always halts: far enough right, nothing left to
     clash with. */
  const GHOST_MAX_ROWS = 6;

  /* A ghost is laid out at a fixed height rather than a measured one. Real
     blocks are measured on the first render and never change, so `heights` is
     already settled for them by the time a review opens; a ghost is measured
     only *after* it has been placed, so reading `heights` for one made the
     first pass and every pass after it disagree — which is the jump the
     comment above promises does not happen. This is above the tallest a
     proposal can be. plan-delta.js caps a proposal at 60 characters of name,
     40 of kind and 200 of intent; measured in this stylesheet, all three at
     their cap and every character a wrap opportunity comes to 214px, and
     realistic prose at the intent cap to 187. Overshooting costs a little air
     under a short ghost. Undershooting costs the overlap this exists to
     prevent, so the margin is on this side. */
  const GHOST_H = 220;
  function settle(x0, y0, w, h, taken) {
    for (let col = 0; ; col++) {
      const x = x0 + col * GHOST_DX;
      for (let row = 0; row <= GHOST_MAX_ROWS; row++) {
        const box = { x: x, y: y0 + row * GHOST_DY, w: w, h: h };
        if (!taken.some((t) => boxesOverlap(box, t))) return box;
      }
    }
  }

  function ghostPositions(additions) {
    const at = new Map();
    const real = currentLevelNodes();
    const below = real.length ? Math.max(...real.map((n) => n.y || 0)) + GHOST_DY : 120;
    // What a ghost must clear. Real blocks first, in sheet order — additions
    // never move those — then each ghost placed earlier in this same call, so
    // two proposals never land on each other either.
    const taken = real.map((n) => ({ x: n.x || 0, y: n.y || 0, w: NODE_W, h: heights[n.id] || 80 }));
    additions.forEach((a, i) => {
      const moved = movedGhosts.get(a.id);
      if (moved) {
        at.set(a.id, { x: moved.x, y: moved.y });
        taken.push({ x: moved.x, y: moved.y, w: NODE_W, h: GHOST_H });
        return;
      }
      const link = (plan.delta.connections || []).find((c) => c.to === a.id || c.from === a.id);
      const other = link && real.find((n) => n.id === (link.to === a.id ? link.from : link.to));
      const x0 = other ? (other.x || 0) + GHOST_DX : 120 + i * GHOST_DX;
      const y0 = other ? (other.y || 0) + GHOST_DY : below;
      const box = settle(x0, y0, NODE_W, GHOST_H, taken);
      at.set(a.id, { x: box.x, y: box.y });
      taken.push(box);
    });
    return at;
  }

  function measure() {
    [].slice.call(world.querySelectorAll(".node")).forEach((el) => {
      heights[el.dataset.id] = el.offsetHeight;
    });
  }

  // Root-most ancestor first, current view last — clicking a crumb jumps
  // viewRoot to that ancestor (or back to the top for the "Home" crumb).
  // Hidden entirely at the top level: nothing to navigate back out of.
  function renderBreadcrumb() {
    const el = document.getElementById("breadcrumb");
    if (!el) return;
    if (!viewRoot) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;
    const path = viewPath(viewRoot);
    el.innerHTML =
      '<button class="crumb" data-id="">Home</button>' +
      path.map((n) => '<span class="crumb-sep">/</span><button class="crumb" data-id="' +
        esc(n.id) + '">' + esc(n.name) + "</button>").join("");
    el.querySelectorAll(".crumb").forEach((b) => {
      b.addEventListener("click", () => goToView(b.dataset.id || null));
    });
  }

  /* The zoom readout, and the third way back. It is absent at 100% and
     appears only once the scale is not 1 — the app has no permanent chrome
     for a reason, and a control that is only useful in a state you are
     usually not in should cost nothing in the state you usually are in.

     Clicking it fits rather than returning to 100%, because someone who has
     zoomed out far enough to be lost wants to see the system, not to see it
     at a particular size. */
  function renderZoom() {
    const el = document.getElementById("zoom");
    if (!el) return;
    const pct = Math.round(zoom * 100);
    el.textContent = pct + "%";
    el.hidden = pct === 100;
    el.title = "Fit the sheet (Shift+1)";
  }

  /* The shortcut said before it is needed, rather than after. The readout
     above only appears once you have already left 100%, which is one step
     too late to be help — by then you are looking for the way back rather
     than being told there is one.

     Tied to whether this level has anything on it: an empty sheet offers
     nothing to focus, and a tip about a view control on a blank page is
     furniture. */
  /* The hint says what is worth pressing where you are. While a review is
     open that is the stepper, not the camera: every one of these is a shortcut
     for a decision the panel is currently asking for, and a reader who has to
     reach for the mouse six times will stop reading and start clicking. */
  const REVIEW_KEYS =
    '<span class="hint-what">Step</span><kbd class="key">←</kbd><kbd class="key">→</kbd>' +
    '<span class="key-join">·</span><span class="hint-what">keep</span><kbd class="key">K</kbd>' +
    '<span class="key-join">·</span><span class="hint-what">cut</span><kbd class="key">C</kbd>' +
    '<span class="key-join">·</span><span class="hint-what">drag by the title bar</span>';
  const FOCUS_KEYS =
    '<kbd class="key">Shift</kbd><span class="key-join">+</span><kbd class="key">1</kbd>' +
    '<span class="hint-what">to focus</span>';

  /* Sits under the panel while a review is open, wherever the panel has been
     dragged to, and returns to the corner when there is no review. Measured
     rather than assumed: the panel's height changes with the proposal, and
     with the reason field when something is cut. */
  function positionHint() {
    const el = document.getElementById("plan-keys");
    const panel = document.getElementById("planpanel");
    if (!el) return;
    if (!plan || !planOpen()) {
      el.style.left = ""; el.style.top = "";
      el.style.right = ""; el.style.bottom = "";
      return;
    }
    const c = canvas.getBoundingClientRect(), p = panel.getBoundingClientRect();
    const below = p.bottom - c.top + 8;
    // If the panel is low enough that under it leaves the canvas, go above it
    // instead rather than off the bottom edge.
    const fits = below + el.offsetHeight + 8 < c.height;
    el.style.right = "auto"; el.style.bottom = "auto";
    el.style.left = Math.round(p.left - c.left) + "px";
    el.style.top = Math.round(fits ? below : p.top - c.top - el.offsetHeight - 8) + "px";
  }

  /* Two hints, because there are two questions.
     The corner one is about the camera and is true whether or not a review is
     open, so it stays where it has always been. The stepper's keys belong to
     the panel and travel with it. Putting both in one line meant the camera
     hint vanished the moment a review started, which is exactly when someone
     reaching for Shift+1 needs it. */
  function renderHint() {
    const el = document.getElementById("hint");
    if (el) {
      el.hidden = !currentLevelNodes().length;
      if (el.dataset.mode !== "sheet") { el.dataset.mode = "sheet"; el.innerHTML = FOCUS_KEYS; }
    }
    const keys = document.getElementById("plan-keys");
    if (keys) {
      const reviewing = !!plan && planOpen() && plan.status === "ready";
      keys.hidden = !reviewing;
      if (reviewing && keys.dataset.filled !== "1") {
        keys.dataset.filled = "1"; keys.innerHTML = REVIEW_KEYS;
      }
    }
  }

  // Which project this sheet is for. The server pins it to the directory
  // plangolin was run from, so it is fixed for the life of the process:
  // written once at boot, never re-rendered, and deliberately not a crumb.
  //
  // The tab title carries it too. Without that every sheet is called
  // "plangolin", so two projects open at once are indistinguishable in the
  // tab bar — which is where you actually notice you've lost track of which
  // one you're looking at.
  function showProject(root) {
    if (!root) return;
    // Basename only: the full path is on the tooltip for when two projects
    // share a folder name and the short form stops being enough.
    const name = String(root).replace(/[/\\]+$/, "").split(/[/\\]/).pop() || String(root);
    document.title = name + " — plangolin";
    const el = document.getElementById("project");
    if (!el) return;
    el.textContent = name;
    el.title = String(root);
    el.hidden = false;
  }

  // Double-click on a container navigates into it — an independent view
  // scoped to its own children, with its own crowding cap (context()/
  // groupable() key off currentLevelNodes(), which is viewRoot-scoped).
  function enterNode(id, selectId) {
    if (!isContainer(id)) return;
    // Selection first: goToView renders, and the block you named should
    // arrive already selected rather than lighting up a frame later.
    if (selectId && find(S, selectId)) S.sel = { type: "node", id: selectId };
    goToView(id);
  }

  /* ------------------- what a block holds -------------------

     Double-click is a real way in and nothing says so, which is the
     documented failure of progressive disclosure: people never find a level
     because the affordance is too discreet. A count is not enough either —
     "3 inside" says a door exists but not what is behind it, and the thing
     that decides whether anyone opens a door is knowing what they will get.

     So the names go on the card, and the names are the targets. Clicking one
     does not just go in, it goes to that block.

     Capped at two, because a card that grows with its contents makes every
     block a different height and a container of twenty unreadable. Six
     children costs exactly what three does. */
  const HOLDS_SHOWN = 2;

  /* The strip of changes. Names the blocks rather than the change, because
     naming it is a model's job and nothing here has asked one — "Billing,
     Stripe +2" is what can be said for free, and it is already the thing the
     commit message didn't say: that these six blocks are two changes. */
  /* What the control says it is showing — the state, in the same words the
     list offers, so the button and the list can never disagree about what
     you picked. */
  function stateLabel() {
    const b = (syncResult && syncResult.baseline) || null;
    // The answer's kind, not the request's: on a trunk with nothing to push
    // the server falls back, and the button must say what actually ran.
    const kind = b ? b.kind : baseline.kind;
    if (kind === "commit") {
      const c = ((baselineList && baselineList.commits) || []).find((x) => x.hash === baseline.ref);
      return c ? c.subject : "Commit " + String(baseline.ref || "").slice(0, 7);
    }
    if (kind === "uncommitted") return "Uncommitted work";
    return b && b.against ? "Since " + b.against : "Current branch";
  }

  function renderBaselineBtn() {
    const el = document.getElementById("state-label");
    if (!el) return;
    /* A live review is one of the things this sheet can be showing, and while
       its panel is shut the door is the only way back to it — so it says so.
       The state it would otherwise name is one click away again the moment
       the review is back on screen. */
    el.textContent = (plan && !planOpen()) ? "Claude’s plan" : stateLabel();
  }

  /* The states, listed. Ordered by how often someone wants them rather than
     by how git thinks: the work in flight, the working tree, then one
     commit. */
  function renderBaselineMenu() {
    const menu = document.getElementById("baseline-menu");
    if (!menu) return;
    const L = baselineList;
    if (!L) { menu.innerHTML = '<div class="hd">reading git…</div>'; return; }
    if (!L.repo) {
      menu.innerHTML = '<div class="hd">no git here</div>' +
        '<div class="base-note">Uncommitted work is all there is to compare.</div>';
      return;
    }

    const cur = (k, r) => baseline.kind === k && (baseline.ref || "") === (r || "");
    const row = (kind, ref, label, extra, current) =>
      '<button class="base-row" data-kind="' + kind + '" data-ref="' + esc(ref || "") +
        '" aria-current="' + !!current + '"><span class="subj">' + label + "</span>" +
        '<span class="sp"></span>' + (extra || "") + "</button>";

    menu.innerHTML =
      row("branch", "", "Current branch",
        '<span class="ago">work in flight</span>', cur("branch")) +
      row("uncommitted", "", "Uncommitted work",
        '<span class="ago">not committed</span>', cur("uncommitted")) +
      (L.commits.length ? '<div class="rule"></div><div class="hd">one commit</div>' : "") +
      L.commits.map((c) =>
        row("commit", c.hash, esc(c.subject),
          // What that commit moved. An em-dash is the useful row — a commit
          // that changed no architecture, which a list with no model behind
          // it cannot tell you.
          '<span class="blocks' + (c.blocks ? "" : " none") + '">' +
            (c.blocks == null ? "?" : c.blocks || "—") + "</span>" +
          '<span class="ago">' + esc(c.when.replace(" ago", "")) + "</span>",
          cur("commit", c.hash))).join("");
  }

  /** One git call per commit listed, and most sessions never open the panel,
      so it is fetched when the panel opens rather than on load. */
  async function loadBaselines() {
    renderBaselineMenu();
    try {
      const res = await fetch("/api/baselines", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodes: S.nodes.map((n) => ({ id: n.id, anchor: n.anchor })) }),
      });
      baselineList = await res.json();
    } catch {
      baselineList = { repo: false, commits: [], branches: [] };
    }
    renderBaselineMenu();
    renderBaselineBtn();
  }

  document.getElementById("baseline-menu").addEventListener("click", async (ev) => {
    const row = ev.target.closest(".base-row");
    if (!row || !row.dataset.kind) return;
    baseline = { kind: row.dataset.kind, ...(row.dataset.ref ? { ref: row.dataset.ref } : {}) };
    // A new state is a new set of changes, so the old selection and the old
    // titles describe something no longer on screen.
    pickedGroup = null;
    changeNames = new Map();
    renderBaselineMenu();
    // Choosing is finishing: the panel exists to pick a state, and leaving it
    // open over the sheet makes you close it to see what you just chose.
    setChangesOpen(false);
    lastSyncAt = 0;                 // asked for, so the debounce does not apply
    await runSync();
  });

  /* The one model call the diff view makes. Asked for, never automatic —
     everything else on the sheet is derived and costs nothing, and a call
     that fired on its own would make the whole thing feel expensive. */
  async function nameTheChanges() {
    if (namingBusy || !changeGroups.length) return;
    namingBusy = true; renderChangeBar();

    const files = {};
    for (const g of changeGroups) {
      for (const id of g.blocks) {
        const moved = changedInside.get(id);
        if (moved && moved.length) files[id] = moved;
      }
    }
    let payload;
    try {
      const res = await fetch("/api/name-change", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          changes: changeGroups.map((g, i) => ({ id: "c" + i, blocks: g.blocks })),
          nodes: S.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind, intent: n.intent })),
          files,
          // The same ref the marks were measured against, so the diff the
          // model reads is the change you are looking at.
          ref: (syncResult && syncResult.baseline && syncResult.baseline.ref) || "HEAD",
        }),
      });
      payload = await res.json();
    } catch {
      payload = { error: "Couldn't reach the server." };
    }
    namingBusy = false;

    if (payload.error) {
      syncNote = payload.error;
      renderChangeBar(); renderChecks();
      return;
    }
    /* The model returns the changes it can see, each citing which of the
       groups it covers. Several ids on one entry is it merging work the
       import graph could not tell was one job — a lint pass in two
       unconnected places, a feature and its tests. Rebuilding the strip from
       its answer is the whole point: the free grouping was a guess from
       references, and this one has read the code. */
    const answer = payload.changes || [];
    if (!answer.length && payload.note) { syncNote = payload.note; renderChecks(); }
    if (answer.length) {
      const rebuilt = [];
      const names = new Map();
      for (const c of answer) {
        const idx = (c.ids || []).map((id) => Number(String(id).slice(1)))
          .filter((i) => Number.isInteger(i) && changeGroups[i]);
        if (!idx.length) continue;
        const blocks = [...new Set(idx.flatMap((i) => changeGroups[i].blocks))].sort();
        names.set(rebuilt.length, c.title);
        rebuilt.push({ blocks, n: blocks.length });
        /* Applied here rather than held for later. Asking what the change
           was for IS the deliberate act, so there is no further moment to
           wait for — and a block whose words you wrote yourself is still
           never touched. Undoable like any other edit. */
        for (const b of c.blocks || []) {
          const n = node(b.id);
          if (n && !(n.authored || []).includes("intent")) {
            applyMove({ t: "setIntent", id: b.id, intent: b.intent });
          }
        }
      }
      // Anything the model did not account for keeps its place unnamed rather
      // than disappearing: a block that moved is still news without a title.
      const taken = new Set(rebuilt.flatMap((g) => g.blocks));
      for (const g of changeGroups) {
        if (g.blocks.some((b) => taken.has(b))) continue;
        rebuilt.push(g);
      }
      changeGroups = rebuilt;
      changeNames = names;
      pickedGroup = null;
    }

    renderChangeBar();
    if (!inspectorEl.contains(document.activeElement)) renderInspector();
  }

  const INLINE_MAX = 2;

  function renderChangeBar() {
    if (!CHANGE_VIEW) return;
    const door = document.getElementById("change-door");
    const inline = document.getElementById("change-inline");
    const groupsEl = document.getElementById("changebar-groups");

    /* The door is there as soon as there is a sheet, not once the first sync
       has answered. It holds the picker, which is worth reaching before any
       answer exists — and gating it on the result meant the page painted
       without it and then popped it in a beat later, which reads as the
       control arriving late rather than as the count arriving. */
    /* Also there while a review is live, even on a sheet with no blocks — a
       review can open against an empty or unreadable sheet, and this is the
       way back to a panel the ✕ closed. */
    door.hidden = !S.nodes.length && !plan;
    if (door.hidden) {
      inline.hidden = true; groupsEl.innerHTML = "";
      if (changesOpen()) setChangesOpen(false);
      return;
    }

    const moved = changedInside.size;
    // Blocks, never lines. The count is what the control is for.
    document.getElementById("change-count").textContent = moved || "";
    door.classList.toggle("lit", moved > 0);
    renderBaselineBtn();

    const label = (g, i) => {
      if (changeNames.has(i)) return changeNames.get(i);
      const names = g.blocks.map((id) => { const n = node(id); return n ? n.name : id; });
      const head = names.slice(0, 2).join(", ");
      return head + (names.length > 2 ? " +" + (names.length - 2) : "");
    };
    const chip = (g, i) =>
      '<button class="change-chip" data-group="' + i + '" aria-pressed="' +
        (pickedGroup === i) + '">' + esc(label(g, i)) +
        ' <i>' + g.n + (g.n === 1 ? " block" : " blocks") + "</i></button>";
    // Offered once, and only while the chips still say which boxes rather
    // than what for. Asking twice about the same change buys nothing.
    const nameBtn = (changeNames.size || namingBusy)
      ? (namingBusy ? '<span class="naming">naming…</span>' : "")
      : '<button class="name-btn" id="name-btn" type="button">' +
          '<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" ' +
          'stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
          '<path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.4 5.4l2.1 2.1M12.5 12.5l2.1 2.1' +
          'M14.6 5.4l-2.1 2.1M7.5 12.5l-2.1 2.1"/></svg> What were these for?</button>';

    /* One or two changes read beside the mark without opening anything —
       that is the shape of one agent session, and having to click to see it
       would put the answer back behind a question. More than two and they go
       in the panel, where seven chips are a list rather than a strip
       wrapping across the sheet. */
    // Not while the door is open: the panel holds the same chips, and two
    // copies of one list overlapping is worse than either alone.
    const short = changeGroups.length > 0 && changeGroups.length <= INLINE_MAX && !changesOpen();
    inline.hidden = !short;
    inline.innerHTML = short ? changeGroups.map(chip).join("") + nameBtn : "";
    groupsEl.innerHTML = changeGroups.length
      ? '<span class="lead">' + changeGroups.length +
          (changeGroups.length === 1 ? " change" : " changes") + "</span>" +
        changeGroups.map(chip).join("") + nameBtn
      : '<span class="lead">nothing has moved</span>';
  }

  document.getElementById("change-door").addEventListener("click", () => {
    // A shut review is what the door is offering, so that is what it opens.
    // Nothing else is lost: the states are behind the same door again as soon
    // as the review is on screen.
    if (plan && !planOpen()) return setPlanOpen(true);
    setChangesOpen(!changesOpen());
  });
  document.getElementById("change-close").addEventListener("click", () => setChangesOpen(false));

  /* ============================ the plan review ============================
     What a plan would do to this sheet, before anybody builds it. Everything
     below is read-only against the document: the proposals are drawn, listed
     and answered, and the only thing that leaves the browser is the answer. */

  const planOpen = () => shell.dataset.plan === "open";

  function setPlanOpen(open) {
    const panel = document.getElementById("planpanel");
    const opening = open && !planOpen();
    // Focus leaves before the panel is hidden. Approve and Skip both close the
    // panel they are inside, and marking the ancestor of the focused button
    // aria-hidden leaves it addressable to a screen reader and to nothing else.
    if (!open && panel.contains(document.activeElement)) document.activeElement.blur();
    shell.dataset.plan = open ? "open" : "closed";
    panel.setAttribute("aria-hidden", String(!open));
    // The state door says what the sheet is showing, and while a review is
    // live and shut it is the way back into it. See renderChangeBar.
    renderChangeBar();
    // A review opens itself after the sheet's first layout pass. Refit on that
    // transition or the initial camera still reflects the unobscured canvas.
    if (opening && sheetLoaded) fitAfterSettling();
  }

  /* Fit once everything the fit depends on has stopped moving.
     centreOnLevel waits a single frame, which is enough for measured block
     heights and not enough for the panel: it opens empty, then fills, then
     grows, and its width is subtracted from the room the drawing gets. Fitting
     against the half-built panel produced a sheet at two-thirds the scale it
     should have been, with no way to tell — Shift+1 silently corrected it.

     Two frames, then a beat, then fit. The beat is for the panel's own
     transition; measuring mid-animation is measuring a number that is about to
     be wrong. */
  let fitPending = null;
  function fitAfterSettling() {
    clearTimeout(fitPending);
    fitPending = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        measure();
        fitLevel(false);
      }));
    }, 120);
  }

  /* The parts of the drawing a review can change, and only those. Not
     render(): render() persists the sheet, so crossing out a proposal would
     write the document to disk — for a change that is never going to be part
     of it. */
  function drawPlan() {
    renderNodes();
    requestAnimationFrame(() => {
      measure(); renderWires();
      // renderWires rebuilds the paths too, so the wire half is re-applied here.
      applyPlanLit();
    });
  }

  /* The proposals, in the order a person would meet them: what is new, then
     what it connects to, then what that changes about what already exists.
     A final entry is not a proposal but the summary — the place Approve
     lives, so agreeing happens after seeing everything rather than beside
     the first thing. */
  function planStepList() {
    if (!plan || plan.status !== "ready") return [];
    const d = plan.delta;
    const nameOf = (id) => {
      const added = d.additions.find((a) => a.id === id);
      if (added) return added.name;
      const n = node(id);
      return n ? n.name : id;
    };
    const reachFor = (ids) => (plan.reach || [])
      .filter((r) => ids.includes(r.via))
      .map((r) => ({ ...r, name: nameOf(r.id) }));
    const out = [];
    d.additions.forEach((a) => out.push({
      key: planKey("add", a.id), mark: "+", name: a.name, why: a.intent,
      steps: a.steps, lit: [a.id], detail: a.dir ? "New block · lives in " + a.dir : "New block",
      files: a.files || [], reach: reachFor([a.id]),
    }));
    d.connections.forEach((c) => out.push({
      key: planKey("edge", c.from, c.to), mark: "→",
      name: nameOf(c.from) + " → " + nameOf(c.to), why: c.label,
      steps: c.steps, lit: [c.from, c.to], wire: c.from + " " + c.to,
      detail: "New line between two blocks", reach: reachFor([c.from, c.to]),
    }));
    d.touches.forEach((x) => out.push({
      key: planKey("touch", x.id), mark: "~", name: nameOf(x.id), why: x.why,
      steps: x.steps, lit: [x.id], size: x.size || "small",
      detail: "Existing block · its description changes", reach: reachFor([x.id]),
    }));
    out.push({ summary: true, lit: [] });
    return out;
  }

  /* A plan step is raw material — it can run to six hundred characters and
     carry a fenced code block, and pasting one into a review panel produced a
     wall nobody could read. The benchmark's guided tour never quotes source
     either: each of its steps carries a short authored title and description
     written to be read.
     We already have the authored version — a proposal's own name and its one
     line. So the plan's own words move behind a disclosure, for the reader who
     wants to check the proposal against what was actually written, and the
     panel leads with the short form. */
  const SAID_CHARS = 240;
  function saidFor(list) {
    const byStep = new Map((plan.steps || []).map((s) => [s.n, s.text]));
    const text = (list || []).map((n) => (byStep.get(n) || "").trim()).filter(Boolean)
      // A fence in a plan is an illustration of the change, not a description
      // of it, and it is the single worst thing to drop into a narrow panel.
      .map((x) => x.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1"))
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean).join(" · ");
    if (!text) return "";
    return text.length > SAID_CHARS ? text.slice(0, SAID_CHARS - 1).trimEnd() + "…" : text;
  }

  /* What this proposal is, in a sentence, before any of its detail. "calls
     into" on its own is a label for a line, not a description of a change. */
  /* What is happening, in the words someone would use out loud.
     "A new block", "a new line", "its description changes" are all about the
     drawing rather than about the system — and the reader is deciding about
     their software, not about a diagram. The heading already carries the name
     and the arrow; this sentence carries the consequence. */
  const cap = (x) => String(x || "").charAt(0).toUpperCase() + String(x || "").slice(1);

  function planSaysWhat(s) {
    if (s.mark === "+") {
      return "This does not exist yet. " + (s.why || "The plan does not say what it would do.");
    }
    if (s.mark === "→") {
      const [from, to] = s.name.split(" → ");
      /* The label is third person — "tracks requests", "provides middleware" —
         so a "to" clause produced "to tracks requests". It is a caption for
         the line, so it goes after the sentence, not inside it. */
      return from + " would start using " + to + "." + (s.why ? " " + cap(s.why) + "." : "");
    }
    return "This already exists, and what it does would change" +
           (s.why ? ": " + s.why + "." : ".");
  }

  function renderPlan() {
    const note = document.getElementById("plan-note");
    const body = document.getElementById("plan-body");
    const foot = document.getElementById("plan-foot") || document.querySelector(".plan-foot");
    if (!plan) { setPlanOpen(false); return; }

    const approve = document.getElementById("plan-approve");
    const thinking = plan.status === "thinking";
    approve.disabled = thinking;

    if (thinking) {
      renderAsk();
      note.textContent = "Reading the plan against your sheet…";
      body.hidden = true;
      document.getElementById("plan-dots").innerHTML = "";
      document.getElementById("plan-of").textContent = "";
      foot.dataset.stage = "thinking";
      return;
    }
    note.textContent = plan.note || "";
    body.hidden = false;

    const list = planStepList();
    if (planAt >= list.length) planAt = list.length - 1;
    if (planAt < 0) planAt = 0;
    const s = list[planAt];

    /* The dots carry state, not just position: filled for kept, hollow for
       cut, so what you have already decided is legible without stepping back
       through it. */
    document.getElementById("plan-dots").innerHTML = list.map((st, i) => {
      const cls = ["plan-dot"];
      if (i === planAt) cls.push("now");
      else if (st.summary) cls.push("end");
      else if (planCut.has(st.key)) cls.push("cut");
      else if (i < planAt) cls.push("kept");
      return '<span class="' + cls.join(" ") + '"></span>';
    }).join("");
    document.getElementById("plan-of").textContent = (planAt + 1) + " of " + list.length;

    const cut = document.getElementById("plan-cut");
    const keep = document.getElementById("plan-keep");
    if (s.summary) {
      const kept = list.filter((x) => !x.summary && !planCut.has(x.key)).length;
      const gone = list.filter((x) => !x.summary && planCut.has(x.key)).length;
      const idle = [...new Set(plan.delta.unplaced.flatMap((u) => u.steps))];
      document.getElementById("plan-mark").textContent = "";
      document.getElementById("plan-nm").textContent =
        list.length === 1 ? "This plan changes nothing structural" : "That's everything";
      document.getElementById("plan-size").textContent = "";
      document.getElementById("plan-from").textContent = "";
      document.getElementById("plan-why").textContent =
        (list.length === 1 ? "" : kept + " kept, " + gone + " cut. ") +
        (idle.length
          ? idle.length + " plan step" + (idle.length > 1 ? "s" : "") +
            " change nothing about the shape of your system and stay as written."
          : "");
      document.getElementById("plan-detail").textContent = "";
      document.getElementById("plan-reach").textContent = "";
      /* The steps themselves, not only how many. This number is the one the
         whole product turns on — it says how much of a long plan you are
         entitled to skim — and a count you cannot check is a claim, not
         evidence. The list panel this replaced could open them; losing that
         made the most important figure on screen the least verifiable. */
      const byStep = new Map((plan.steps || []).map((x) => [x.n, x.text]));
      const sorted = idle.slice().sort((a, b) => a - b);
      document.getElementById("plan-quote").innerHTML = sorted.length
        ? "<details><summary>which steps those are</summary><ol>" +
          sorted.map((n) => '<li value="' + n + '">' + esc(byStep.get(n) || "") + "</li>").join("") +
          "</ol></details>"
        : "";
      foot.dataset.stage = "summary";
    } else {
      document.getElementById("plan-mark").textContent = planCut.has(s.key) ? "✗" : s.mark;
      document.getElementById("plan-nm").textContent = s.name;
      document.getElementById("plan-size").textContent = s.size || "";
      document.getElementById("plan-from").textContent =
        "from step" + (s.steps.length > 1 ? "s " : " ") + s.steps.join(", ");
      document.getElementById("plan-why").textContent = planSaysWhat(s);
      /* A bare list of paths does not say what it is a list of. Adding and
         changing are different enough that the reader should not have to work
         out which one they are looking at from the marker alone. */
      const files = s.files || [];
      const filesEl = document.getElementById("plan-detail");
      filesEl.innerHTML = files.length
        ? '<span class="plan-files-label">' +
          (s.mark === "+" ? "Files it would add" : "Files it would change") + "</span>" +
          files.map((f) => '<code>' + esc(f) + "</code>").join("")
        : "";
      const reach = s.reach || [];
      document.getElementById("plan-reach").innerHTML = reach.length
        ? '<span class="plan-files-label">Already used by</span>' +
          reach.map((r) => esc(r.name) + ' <i>(' + esc(r.label) + ")</i>").join(", ")
        : "";
      const said = saidFor(s.steps);
      document.getElementById("plan-quote").innerHTML = said
        ? "<details><summary>what the plan said</summary><span>" + esc(said) + "</span></details>"
        : "";
      foot.dataset.stage = "step";
      keep.classList.toggle("on", !planCut.has(s.key));
      cut.classList.toggle("on", planCut.has(s.key));
    }
    document.getElementById("plan-panel-cut") && 0;
    document.getElementById("plan-prev").disabled = planAt === 0;
    document.getElementById("plan-next").disabled = planAt >= list.length - 1;

    litPlanNodes(s);
    renderAsk();
    renderHint();
    positionHint();
  }

  /* Dim everything the current step is not about. Dimmed, never hidden: the
     rest of the system is the context that makes the lit part legible, and a
     block that vanished would take its position with it — the same reason the
     change view dims rather than filters. */
  /* The flags only. Called from renderNodes, so any redraw — a pan, a poll, a
     proposal being cut — re-applies the spotlight instead of losing it. It was
     lost twice by being applied from the outside, which is the tell that it
     belongs with whatever builds the elements. */
  function applyPlanLit() {
    const s = planStepList()[planAt];
    const on = plan && plan.status === "ready" && s && !s.summary;
    shell.dataset.planSpot = on ? "on" : "off";
    const lit = new Set(on ? s.lit : []);
    const reached = new Set(on ? (s.reach || []).map((r) => r.id) : []);
    for (const el of world.querySelectorAll(".node")) {
      const isLit = lit.has(el.dataset.id);
      el.dataset.lit = String(isLit);
      el.dataset.reach = String(!isLit && reached.has(el.dataset.id));
    }
    for (const el of wires.querySelectorAll("path")) {
      el.dataset.lit = String(on && !!(s && s.wire) && el.dataset.pair === s.wire);
    }
    return on ? [...lit] : null;
  }

  /* Flags, then the camera. Only on a step change: moving the sheet on every
     redraw would fight the pan the reader is in the middle of. */
  function litPlanNodes(s) {
    const lit = applyPlanLit();
    if (lit && lit.length) bringIntoView(lit);
  }

  /* Bring the blocks a step is about into view, without re-fitting the whole
     sheet. Re-fitting on every step would rescale the drawing under the
     reader four times in a row, and the thing they are being asked to judge
     is where a block sits relative to the others. */
  function bringIntoView(ids) {
    const boxes = ids.map((id) => {
      const n = node(id);
      if (n && Number.isFinite(n.x)) return { x: n.x, y: n.y, h: heights[id] || 80 };
      const g = ghostAt.get(id);
      return g ? { x: g.x, y: g.y, h: GHOST_H } : null;
    }).filter(Boolean);
    if (!boxes.length) return;
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + NODE_W));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const panel = document.getElementById("planpanel").getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const pad = 40;
    const L = pad, R = canvas.clientWidth - pad, T = pad, B = canvas.clientHeight - pad;
    const sx0 = x0 * zoom + pan.x, sy0 = y0 * zoom + pan.y;
    const sx1 = x1 * zoom + pan.x, sy1 = y1 * zoom + pan.y;
    // Clear of the panel too — it is the thing asking the question, so it must
    // not be sitting on top of the answer.
    const pl = panel.left - cr.left, pr = panel.right - cr.left;
    const pt = panel.top - cr.top, pb = panel.bottom - cr.top;
    const hits = sx1 > pl && sx0 < pr && sy1 > pt && sy0 < pb;
    let dx = 0, dy = 0;
    if (sx0 < L) dx = L - sx0; else if (sx1 > R) dx = R - sx1;
    if (sy0 < T) dy = T - sy0; else if (sy1 > B) dy = B - sy1;
    if (hits && !dx) dx = (pl - 24) - sx1 > -9999 ? Math.min(0, (pl - 24) - sx1) : 0;
    if (dx || dy) panTo(pan.x + dx, pan.y + dy, zoom);
  }

  /* What you asked for, in the corner the bulb used to hold. A plan is judged
     against a request, and by the time four proposals have gone past, the
     request is the thing hardest to hold in your head. */
  function renderAsk() {
    const wrap = document.getElementById("askwrap");
    const brief = document.getElementById("ask-brief");
    if (!wrap || !brief) return;
    const live = !!plan;
    wrap.hidden = !live;
    if (!live) { wrap.dataset.open = "false"; return; }
    const idle = plan.status === "ready"
      ? [...new Set(plan.delta.unplaced.flatMap((u) => u.steps))].length : 0;
    const total = (plan.steps || []).length;
    brief.innerHTML =
      "<b>You asked for</b><span>" + esc(plan.request || firstStepText()) + "</span>" +
      (total ? '<b style="margin-top:5px">' + total + " plan step" + (total > 1 ? "s" : "") +
        (idle ? " · " + idle + " change nothing structural" : "") + "</b>" : "");
  }

  /* The server sends the plan's steps but not the sentence that prompted it,
     so the plan's own opening line stands in — which is what a plan opens
     with anyway. */
  function firstStepText() {
    const s = (plan.steps || [])[0];
    return s ? s.text : "";
  }

  document.getElementById("ask").addEventListener("click", () => {
    const wrap = document.getElementById("askwrap");
    const open = wrap.dataset.open !== "true";
    wrap.dataset.open = String(open);
    document.getElementById("ask").setAttribute("aria-expanded", String(open));
  });

  /* Dragged by its grip, and let go somewhere sensible. The docks are never
     drawn: showing the targets explains the mechanism when the glide already
     communicates the result. */
  (function draggablePanel() {
    const panel = document.getElementById("planpanel");
    const grip = document.getElementById("plan-grip");
    let drag = null;

    /* Where the panel is allowed to come to rest. The top-left corner is not
       one of them: the question mark lives there, and it is the one control
       that must stay reachable while the panel is being moved around — it
       holds the request the whole review is judged against. So the left-hand
       docks start below it rather than on top of it. */
    const docks = () => {
      const c = canvas.getBoundingClientRect();
      const ask = document.getElementById("askwrap");
      const clear = ask && !ask.hidden ? ask.getBoundingClientRect().height + 24 : 0;
      const w = panel.offsetWidth, h = panel.offsetHeight, m = 14;
      const bottom = Math.max(m, c.height - h - m);
      return [
        { x: m, y: Math.max(m + clear, m) },
        { x: c.width - w - m, y: m },
        { x: m, y: bottom },
        { x: c.width - w - m, y: bottom },
        { x: c.width - w - m, y: (c.height - h) / 2 },
      ];
    };
    const nearest = (x, y) => docks().reduce((best, d) =>
      ((d.x - x) ** 2 + (d.y - y) ** 2) < ((best.x - x) ** 2 + (best.y - y) ** 2) ? d : best);

    // The canvas pans on mousedown and the panel sits inside it, so without
    // this a drag of the panel drags the sheet underneath it as well.
    grip.addEventListener("mousedown", (ev) => ev.stopPropagation());
    grip.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      ev.stopPropagation();
      ev.preventDefault();
      const p = panel.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      drag = { dx: ev.clientX - p.left, dy: ev.clientY - p.top, c };
      panel.dataset.dragging = "true";
      // Anchored by left/top from here on, so the CSS right/bottom rules stop
      // fighting the drag.
      panel.style.left = (p.left - c.left) + "px";
      panel.style.top = (p.top - c.top) + "px";
      panel.style.right = "auto"; panel.style.bottom = "auto";
      grip.setPointerCapture(ev.pointerId);
    });
    grip.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      panel.style.left = (ev.clientX - drag.c.left - drag.dx) + "px";
      panel.style.top = (ev.clientY - drag.c.top - drag.dy) + "px";
      positionHint();
    });
    const land = () => {
      if (!drag) return;
      const d = nearest(parseFloat(panel.style.left), parseFloat(panel.style.top));
      // Belt and braces: a dock is a target, not a guarantee, and the mark
      // must be reachable however the panel got where it is.
      const ask = document.getElementById("askwrap");
      if (ask && !ask.hidden) {
        const c = canvas.getBoundingClientRect(), a = ask.getBoundingClientRect();
        const ax = a.right - c.left + 10, ay = a.bottom - c.top + 10;
        if (d.x < ax && d.y < ay) d.y = ay;
      }
      panel.dataset.dragging = "false";        // transition back on: this glides
      panel.style.left = d.x + "px";
      panel.style.top = d.y + "px";
      drag = null;
      // After the glide, not during: the panel's final rect is what to sit under.
      setTimeout(positionHint, 360);
    };
    grip.addEventListener("pointerup", land);
    grip.addEventListener("pointercancel", land);
  })();

  function planDecide(cutIt) {
    const list = planStepList();
    const s = list[planAt];
    if (!s || s.summary) return;
    cutIt ? planCut.add(s.key) : planCut.delete(s.key);
    renderPlan();
    drawPlan();
  }

  function planGo(delta) {
    const list = planStepList();
    planAt = Math.max(0, Math.min(list.length - 1, planAt + delta));
    renderPlan();
  }

  document.getElementById("plan-next").addEventListener("click", () => planGo(1));
  document.getElementById("plan-prev").addEventListener("click", () => planGo(-1));
  document.getElementById("plan-keep").addEventListener("click", () => { planDecide(false); planGo(1); });
  document.getElementById("plan-cut").addEventListener("click", () => { planDecide(true); planGo(1); });

  /* Reviewing is a reading task, and six decisions is six round trips to the
     mouse otherwise. */
  document.addEventListener("keydown", (ev) => {
    if (!plan || !planOpen() || plan.status !== "ready") return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    if (el && el.isContentEditable) return;
    if (ev.key === "ArrowRight") { planGo(1); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { planGo(-1); ev.preventDefault(); }
    else if (ev.key === "k" || ev.key === "K") { planDecide(false); planGo(1); }
    else if (ev.key === "c" || ev.key === "C") { planDecide(true); planGo(1); }
  });


  /* Closing is not answering. The review stays live and the state door becomes
     the way back to it — a panel that says "this is a question you are asked"
     must not have a ✕ that loses the question, because the command asking it
     is blocked for ten minutes either way. */
  /* Collapse, not close.
     The ✕ used to hand the review back to the state door, which was the way
     into it again — and that door is switched off now, so closing lost the
     question with no way to ask for it back. The command is blocked either
     way, so there is nothing to be gained by making it disappear: it folds
     down to its title bar, still draggable, and unfolds when you click it.
     Skip remains the way to answer "not interested". */
  document.getElementById("plan-close").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const panel = document.getElementById("planpanel");
    const shut = panel.dataset.collapsed === "true";
    panel.dataset.collapsed = String(!shut);
    ev.currentTarget.textContent = shut ? "×" : "▸";
    ev.currentTarget.setAttribute("aria-label", shut ? "Collapse" : "Expand");
  });

  /* The answer, and the only thing that leaves the browser. Awaited and
     checked before the panel closes: a POST that failed used to look exactly
     like one that worked, which meant the person walked away believing they
     had answered while the command they were holding up sat out its timeout.
     An error in the panel is a worse minute and a better ten. */
  async function sendAnswer(body) {
    if (planSending) return;
    planSending = true;
    const note = document.getElementById("plan-note");
    const was = plan;
    try {
      const res = await fetch("/api/plan/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out || out.ok === false) throw new Error("refused");
      plan = null; movedGhosts.clear(); setPlanOpen(false); drawPlan();
    } catch {
      // Only if this is still the review that was being answered — a poll may
      // have moved on while the request was out.
      if (plan === was) {
        note.textContent = "That didn't reach plangolin. Is the command still waiting? Try again.";
      }
    } finally {
      planSending = false;
    }
  }

  /* Skip is gone from the panel.
     It resolved the review as unanswered, so the agent proceeded with the plan
     exactly as written — which is what approving with nothing cut already
     does, except approving also sends the "do not touch" list. So the quick
     button was the one that threw the product's output away, sitting at equal
     weight beside the one that kept it.

     The route still accepts `skipped`, because a caller that genuinely wants
     to abandon a review should be able to, and the command still gives up on
     its own after ten minutes. Nothing here is a dead end without it. */

  document.getElementById("plan-approve").addEventListener("click", () => {
    if (!plan) return;
    const d = plan.delta;
    const all = [
      ...d.additions.map((a) => planKey("add", a.id)),
      ...d.touches.map((t) => planKey("touch", t.id)),
      ...d.connections.map((c) => planKey("edge", c.from, c.to)),
    ];
    sendAnswer({
      id: plan.id,
      accepted: all.filter((k) => !planCut.has(k)),
      nodes: S.nodes.map((n) => ({ id: n.id, name: n.name, intent: n.intent })),
    });
  });

  /* The review this browser has already drawn, as id and status. Compared
     against rather than against `plan` itself, because a review that has been
     answered leaves `plan` null while the server goes on reporting it — and
     "different from null" would then be true on every poll for the rest of
     the session, redrawing the whole sheet every two seconds. */
  let planSeen = "";

  async function pollPlan() {
    try {
      const { review } = await fetch("/api/plan").then((r) => r.json());
      const stamp = review ? review.id + ":" + review.status : "";
      const wasThinking = !!plan && plan.status === "thinking";
      if (stamp === planSeen) return;
      planSeen = stamp;
      // Proposal ids can recur in a later review; carrying a coordinate across
      // that boundary would make a new proposal inherit an old decision.
      movedGhosts.clear();
      // A review that has been answered is over: it stays on the server so the
      // command waiting on it can read the brief, but there is nothing left to
      // show and reopening the panel over a decision already sent would be a
      // question asked twice.
      plan = review && (review.status === "thinking" || review.status === "ready") ? review : null;
      // A new review starts with everything accepted. Rejecting is the
      // deliberate act; requiring a click per block to approve a plan you
      // agree with would make the common case the expensive one.
      if (plan && plan.status === "ready") { planCut = new Set(); planAt = 0; }
      /* thinking -> ready is when the panel gains its content and the sheet
         gains its ghosts. Both change what a fit should produce, so this is
         the moment to compute one. */
      if (plan && plan.status === "ready" && wasThinking) fitAfterSettling();
      /* An empty folder puts "No code here yet" over the canvas, which is the
         right thing to say to someone who opened plangolin on the wrong
         directory and the wrong thing to say to someone reviewing a plan for a
         project that does not exist yet. The ghosts render underneath it either
         way, so without this the greenfield case looks like a dead end while
         the whole answer sits one layer down. */
      if (plan) clearIdle();
      if (plan) setPlanOpen(true);
      renderPlan();
      drawPlan();
    } catch { /* the server is restarting, or gone. Ask again shortly. */ }
  }
  /* Started by boot rather than at parse. The panel names the blocks a plan
     touches, and a first answer that arrived before the sheet did listed
     their ids instead — the review would then have been read against a
     document the browser had not loaded yet. */
  function startPlanPolling() {
    setInterval(pollPlan, 2000);
    pollPlan();
  }

  // The chips live in two places now — beside the mark when there are one or
  // two, in the panel when there are more — so the handler is on the canvas
  // and keys off the chip itself.
  canvas.addEventListener("click", (ev) => {
    if (ev.target.closest("#name-btn")) { nameTheChanges(); return; }
    const chip = ev.target.closest(".change-chip");
    if (!chip) return;
    const i = Number(chip.dataset.group);
    // Pressing the one already chosen goes back to all of them. A chooser
    // with no way out is a filter you get stuck inside.
    pickedGroup = pickedGroup === i ? null : i;
    renderChangeBar();
    renderNodes();
    requestAnimationFrame(() => { measure(); renderWires(); });
  });

  /* Did anything move inside this block, at any depth? A container's own
     anchor usually covers its children's files, so it is marked whenever they
     are — but the reverse matters more: a name in the holds line has to know
     about a change several levels down, or the door tells you nothing about
     what is behind it. */
  function movedUnder(id) {
    if (changedInside.has(id)) return true;
    return childrenOf(id).some((k) => movedUnder(k.id));
  }

  function holdsHtml(id) {
    const kids = childrenOf(id);
    if (!kids.length) return "";
    const shown = kids.slice(0, HOLDS_SHOWN);
    const rest = kids.length - shown.length;
    // The way in already lists the names; marking the ones that moved is what
    // turns "3 inside" into knowing which door to open. Same dashed pine as
    // the block itself, so it is plainly the same fact at a smaller size.
    const link = (k) =>
      '<button class="holds-go' + (movedUnder(k.id) ? " moved" : "") +
        '" data-enter="' + esc(id) + '" data-pick="' + esc(k.id) + '">' +
        esc(k.name) + "</button>";
    return '<p class="node-holds">holds ' + shown.map(link).join(", ") +
      (rest
        ? ', <button class="holds-go more" data-enter="' + esc(id) + '">+' + rest + " more</button>"
        : "") +
      "</p>";
  }

  function renderWires() {
    wires.innerHTML = "";
    labelLayer.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const add = (tag, attrs, txt, layer) => {
      const el = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach((a) => el.setAttribute(a, attrs[a]));
      if (txt != null) el.textContent = txt;
      (layer || wires).appendChild(el);
      return el;
    };

    /* Lines follow their endpoints up into whatever block is actually drawn.
     *
     * Several lines between the same two blocks are SPLAYED rather than merged
     * while there are few of them, and merged into one counted line only once
     * there are enough to be worth hiding. Merging exists to spend a limited
     * entity budget well; on a sheet with eight blocks there is no budget
     * pressure, and "2 lines" then costs the reader everything the two lines
     * would have said while saving one stroke.
     *
     * Aggregation research names both halves of this: an aggregate must
     * "convey information about the underlying data that is currently not
     * visible", and the whole justification for aggregating in the first place
     * is the entity budget. Below the threshold there is no budget to spend.
     */
    const SPLAY_UP_TO = 4;
    const SPREAD = 26;

    const bundles = new Map();
    S.edges.forEach((e) => {
      const a = levelAncestor(e.from), b = levelAncestor(e.to);
      if (!a || !b || a === b) return;              // not part of this level, or wholly inside one block here
      const key = a + ">" + b;
      if (!bundles.has(key)) bundles.set(key, { from: a, to: b, members: [] });
      bundles.get(key).members.push(e);
    });

    bundles.forEach((bu) => {
      const p = anchors(bu);
      if (!p) return;
      const splayed = bu.members.length <= SPLAY_UP_TO;

      if (!splayed) {
        // Too many to read apart. One line, labelled with how many it stands
        // for, and no per-line selection — it is not one line to select.
        const d = curve(p);
        const operations = bu.members.flatMap((m) => m.operations);
        add("path", { d: d, class: "wire" + (operations.length === 0 ? " loose" : "") });
        add("text", { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 - 7, class: "wire-label" },
          bu.members.length + " lines", labelLayer);
        return;
      }

      bu.members.forEach((e, i) => {
        // Centred on the straight run: one line is unbowed, two bow apart
        // evenly, and so on.
        const spread = (i - (bu.members.length - 1) / 2) * SPREAD;
        const d = curve(p, spread);
        const sel = S.sel && S.sel.type === "edge" && S.sel.id === e.id;
        const gone = wiresGone.has(e.id);
        add("path", { d: d, class: "wire" + (sel ? " sel" : "") +
          (e.operations.length === 0 ? " loose" : "") + (gone ? " gone" : "") });
        const hit = add("path", { d: d, class: "wire-hit" });
        hit.addEventListener("mousedown", (ev) => { ev.stopPropagation(); select("edge", e.id); });
        if (e.label) {
          add("text", { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 - 7 + spread * 0.75, class: "wire-label" },
            e.label, labelLayer);
        }
      });
    });

    /* Lines that leave this view entirely.
     *
     * Inside a block, a line to something in a different branch has no
     * endpoint here at all — the far end resolves to nothing, and this used to
     * skip it. That silently deleted the most useful fact on the sheet: open
     * the frontend and you could no longer see that two of its blocks call the
     * server, because the server is not at this level.
     *
     * So it gets a stub: a short line off the block, named for where it
     * actually goes. Borrowed from hardware schematics, where a sub-sheet's
     * crossing wires appear as named pins on its boundary rather than
     * vanishing. Nothing is hidden and nothing is added to the canvas.
     */
    const STUB_LEN = 54;
    const stubs = new Map();
    S.edges.forEach((e) => {
      const a = levelAncestor(e.from), b = levelAncestor(e.to);
      if (a && b) return;                       // both ends here, already drawn
      if (!a && !b) return;                     // neither end here; not ours to say
      const here = a || b;
      const outward = !!a;                      // a resolved means the line leaves
      const far = node(outward ? e.to : e.from);
      if (!far) return;
      const key = here + (outward ? ">" : "<") + far.id;
      if (!stubs.has(key)) stubs.set(key, { here, outward, name: far.name || far.id });
    });

    // Several stubs off one block stack, so they are spread down its side the
    // same way parallel lines are spread apart.
    const perBlock = new Map();
    stubs.forEach((s) => {
      if (!perBlock.has(s.here)) perBlock.set(s.here, []);
      perBlock.get(s.here).push(s);
    });

    perBlock.forEach((list, id) => {
      const n = node(id);
      if (!n) return;
      const h = heights[id] || 80;
      list.forEach((s, i) => {
        const y = n.y + h / 2 + (i - (list.length - 1) / 2) * 22;
        const x1 = s.outward ? n.x + NODE_W : n.x;
        const x2 = s.outward ? x1 + STUB_LEN : x1 - STUB_LEN;
        add("path", { d: "M " + x1 + " " + y + " L " + x2 + " " + y, class: "wire wire-stub" });
        // The anchor has to come from a class: .wire-label sets text-anchor
        // in the stylesheet, and a stylesheet rule beats a presentation
        // attribute however specific the attribute looks.
        add("text", {
          x: s.outward ? x2 + 6 : x2 - 6, y: y + 3,
          class: "wire-label wire-stub-label " + (s.outward ? "anchor-start" : "anchor-end"),
        }, (s.outward ? "→ " : "← ") + s.name, labelLayer);
      });
    });

    /* Lines the code has that the sheet never drew. Drawn rather than listed,
       because "these two now talk" is a fact about the shape of the system and
       a sentence in a panel is the one place it cannot be seen. Heavier and
       dashed: present, but not yet part of the drawing you approved. Bundled
       to their drawn ancestors so a new line into a collapsed block lands on
       the block rather than vanishing with its child. */
    const drawn = new Set();
    S.edges.forEach((e) => {
      const a = levelAncestor(e.from), b = levelAncestor(e.to);
      if (a && b && a !== b) drawn.add(a + ">" + b);
    });
    const seen = new Set();
    wiresNew.forEach((w) => {
      const a = levelAncestor(w.from), b = levelAncestor(w.to);
      if (!a || !b || a === b) return;
      const key = a + ">" + b;
      if (drawn.has(key) || seen.has(key)) return;   // already on the sheet, or already added once
      seen.add(key);
      const p = anchors({ from: a, to: b });
      if (!p) return;
      // No text on it. A label sits at the line's midpoint, and two adjacent
      // blocks have no midpoint to spare — it lands on the far block's name.
      // The line's own weight is what says this, the way `loose` already
      // carries "no operations defined" without a word on the canvas.
      add("path", { d: curve(p), class: "wire gained" });
    });

    if (dragTemp) add("path", { d: curve(dragTemp), class: "wire temp" });

    /* The lines a plan would draw. Last, so a proposal sits over the drawing
       it is proposing to change rather than under it, and outside the splay
       and merge logic above — a proposal is never one of several lines between
       the same pair, so there is nothing to spread apart or count.
       Either end may be a ghost or a real block; an end that resolves to
       neither is skipped, because a line to nowhere says something the plan
       did not. */
    if (plan && plan.status === "ready") {
      const end = (id) => {
        const g = ghostAt.get(id);
        if (g) return { id: id, x: g.x, y: g.y };
        const here = levelAncestor(id);
        return here ? node(here) : null;
      };
      for (const c of plan.delta.connections) {
        const a = end(c.from), b = end(c.to);
        if (!a || !b || a.id === b.id) continue;
        const p = between(a, b);
        if (!p) continue;
        add("path", {
          d: curve(p), class: "wire",
          "data-proposed": "true",
          // So a step can light the one line it is about.
          "data-pair": c.from + " " + c.to,
          "data-cut": String(planCut.has(planKey("edge", c.from, c.to))),
        });
      }
    }

    // One callout, one part. Circling every marked block merges into a blob and
    // stops reading as a diagram label.
    if (hoverCheck) {
      const n = node(levelAncestor(primaryMark()));
      if (n) {
        const h = heights[n.id] || 80;
        add("path", {
          d: roughEllipse(n.x + NODE_W / 2, n.y + h / 2, NODE_W / 2 + 9, h / 2 + 8, n.id.length * 7 + n.id.charCodeAt(0)),
          fill: "none", stroke: sevColor(hoverCheck.sev), "stroke-width": 2.1, opacity: .9
        });
      }
    }

    drawOverlay();
  }

  /* The files behind a block's "N changed" mark. Says what it compared
     against, not what it was asked to compare against — a sync on a project
     with no git silently has no baseline, and a panel that named one anyway
     would be describing something that never happened. */
  const SHOW_FILES = 8;
  /* What the sheet actually compared against, in words. Named once and used
     everywhere, because the panel and the block description must never
     disagree about which window they are describing. */
  function sinceLabel() {
    const base = (syncResult && syncResult.baseline) || {};
    if (!base.ref) return "";
    if (base.kind === "branch") return base.against ? "since " + base.against : "on this branch";
    if (base.kind === "commit") return "in that commit";
    if (base.fellBack) return "in work you haven't committed";
    return "since " + base.ref.slice(0, 8);
  }

  function sinceText() {
    const label = sinceLabel();
    return label ? " " + esc(label) : "";
  }

  function hunkRows(patch) {
    let oldLine = 0, newLine = 0;
    return patch.replace(/\n$/, "").split("\n").map((line) => {
      const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (header) {
        oldLine = Number(header[1]); newLine = Number(header[2]);
        return '<div class="hunk-line hunk-range"><span></span><span></span><code>' + esc(line) + "</code></div>";
      }

      let kind = "context", oldNo = "", newNo = "";
      if (line[0] === "+") { kind = "add"; newNo = newLine++; }
      else if (line[0] === "-") { kind = "del"; oldNo = oldLine++; }
      else if (line[0] === " ") { oldNo = oldLine++; newNo = newLine++; }
      else kind = "meta";
      return '<div class="hunk-line hunk-' + kind + '"><span class="line-no">' + oldNo +
        '</span><span class="line-no">' + newNo + "</span><code>" + esc(line) + "</code></div>";
    }).join("");
  }

  function renderHunkDrawer() {
    const drawer = document.getElementById("hunk-drawer");
    const body = document.getElementById("hunk-body");
    document.getElementById("hunk-title").textContent = hunkView.path;
    document.getElementById("hunk-since").textContent = sinceLabel();
    if (hunkView.loading) {
      body.innerHTML = '<p class="hunk-message">Reading the changed lines…</p>';
    } else if (hunkView.error) {
      body.innerHTML = '<p class="hunk-message">' + esc(hunkView.error) + "</p>";
    } else if (!hunkView.patch) {
      body.innerHTML = '<p class="hunk-message">' + esc(hunkView.reason || "There are no text hunks for this file.") + "</p>";
    } else {
      body.innerHTML = '<div class="hunk-lines">' + hunkRows(hunkView.patch) + "</div>" +
        (hunkView.truncated ? '<p class="hunk-truncated">Showing the first 64 KiB of this patch.</p>' : "");
    }
    drawer.hidden = false;
  }

  function closeHunks() {
    if (!hunkView) return;
    hunkView = null;
    renderInspector();
  }

  async function openHunks(file) {
    const resolved = syncResult && syncResult.baseline;
    hunkView = { path: file, loading: true };
    const request = hunkView;
    renderInspector();
    requestAnimationFrame(() => document.getElementById("hunk-close").focus());

    try {
      const url = new URL("/api/hunks", location.origin);
      url.searchParams.set("path", file);
      if (resolved) {
        url.searchParams.set("kind", resolved.kind || "");
        url.searchParams.set("ref", resolved.ref || "");
        if (resolved.rootCommit) url.searchParams.set("rootCommit", "true");
      }
      const res = await fetch(url);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Couldn't read that patch.");
      if (hunkView !== request) return;
      hunkView = { path: file, ...payload };
    } catch (err) {
      if (hunkView !== request) return;
      hunkView = { path: file, error: err.message || "Couldn't read that patch." };
    }
    renderInspector();
  }

  function changedFilesHtml(id) {
    const files = changedInside.get(id);
    if (!files || !files.length) return "";
    const rest = files.length - SHOW_FILES;
    return '<div class="field changed-field">' +
      '<label>' + files.length + (files.length === 1 ? " file" : " files") +
        " changed" + sinceText() + "</label>" +
      '<ul class="changed-files">' +
        files.slice(0, SHOW_FILES).map((f) => '<li><button type="button" class="changed-file" data-file="' +
          esc(f) + '">' + esc(f) + "</button></li>").join("") +
        (rest > 0 ? '<li class="more">and ' + rest + " more</li>" : "") +
      "</ul></div>";
  }

  function renderInspector() {
    // The rail opens on selection and closes on deselect. Opening it by hand
    // (the stub) is honoured until the next selection change.
    // No stub, no empty state: with nothing selected the rail is not there at
    // all. Selecting a block is its own discovery trigger, so there is nothing
    // to rediscover — unlike the plan check, which nobody can go looking for.
    const rail = document.getElementById("rail-right");
    if (!S.sel) { inspectorOpen = false; hunkView = null; }
    const showPanel = !!S.sel && inspectorOpen;
    // inert, not hidden: display:none cannot be transitioned, and the panel has
    // to keep its box for the column to animate open. inert still takes it out
    // of the tab order and the accessibility tree while it is shut.
    rail.hidden = false;
    rail.inert = !showPanel;
    shell.dataset.inspector = showPanel ? "open" : "closed";
    const showingHunks = showPanel && !!hunkView;
    shell.dataset.hunks = showingHunks ? "open" : "closed";
    document.getElementById("inspector-head").hidden = showingHunks;
    inspectorEl.hidden = showingHunks;
    document.getElementById("hunk-drawer").hidden = !showingHunks;
    if (!S.sel) return;
    if (showingHunks) return renderHunkDrawer();
    inspectorEl.className = "inspector";

    if (S.sel.type === "node") {
      const n = node(S.sel.id);
      if (!n) { S.sel = null; return renderInspector(); }
      inspectorEl.innerHTML =
        // Above the name, because a marked block is usually why you clicked.
        // Real paths rather than a count: the count is what got you here, and
        // it is the one question the card cannot answer for itself. Capped —
        // an agent touching forty files in one block would otherwise push
        // every editable field off the panel.
        changedFilesHtml(n.id) +
        '<div class="field"><label for="f-name">Name</label>' +
          '<input type="text" id="f-name" value="' + esc(n.name) + '"></div>' +
        // Free text with suggestions, never a dropdown. Design §5: kind is
        // "Postgres", "Supabase", "that old PHP thing" — no enum, no
        // validation. A select could not hold what a scan produces ("Browser
        // UI", "Node CLI"), showed the first option as if it were selected,
        // and overwrote the real value the moment anyone touched it.
        '<div class="field"><label for="f-kind">Kind</label>' +
          '<input type="text" id="f-kind" list="kind-options" placeholder="Postgres, React app, S3…" value="' + esc(n.kind || "") + '">' +
          '<datalist id="kind-options">' +
            Object.keys(KINDS).filter((k) => KINDS[k].core)
              .map((k) => '<option value="' + esc(KINDS[k].label) + '"></option>').join("") +
          "</datalist>" +
          '<div class="field-help">Whatever it actually is. Drives the icon; anything unrecognised still works.</div></div>' +
        '<div class="field"><label for="f-intent">What should this do?</label>' +
          '<textarea id="f-intent" placeholder="People sign up, post photos, and follow each other.">' + esc(n.intent) + "</textarea>" +
          '<div class="field-help">Write it the way you’d explain it to a friend. plangolin reads this to work out what else you need.</div></div>' +
        '<div class="field"><label for="f-details">Details</label>' +
          '<textarea id="f-details" class="field-details" placeholder="What it owns, the key operations it exposes, anything worth knowing before building it.">' + esc(n.details || "") + "</textarea>" +
          '<div class="field-help">Optional — the deeper write-up. Kept out of the canvas card so the diagram stays readable.</div></div>' +
        '<button class="link-btn danger" id="f-del">Remove this block</button>';

      const nid = n.id;
      [].slice.call(inspectorEl.querySelectorAll(".changed-file")).forEach((button) => {
        button.addEventListener("click", () => openHunks(button.dataset.file));
      });
      document.getElementById("f-name").addEventListener("input", (ev) => {
        applyMove({ t: "setName", id: nid, name: ev.target.value }); softRender();
      });
      document.getElementById("f-kind").addEventListener("input", (ev) => {
        applyMove({ t: "setKind", id: nid, kind: ev.target.value }); render();
      });
      document.getElementById("f-intent").addEventListener("input", (ev) => {
        applyMove({ t: "setIntent", id: nid, intent: ev.target.value }); softRender();
      });
      document.getElementById("f-details").addEventListener("input", (ev) => {
        applyMove({ t: "setDetails", id: nid, details: ev.target.value }); softRender();
      });
      document.getElementById("f-del").addEventListener("click", () => {
        applyMove({ t: "removeNode", id: nid });
        S.sel = null; render();
      });

    } else {
      const e = S.edges.find((x) => x.id === S.sel.id);
      if (!e) { S.sel = null; return renderInspector(); }
      const a = node(e.from), b = node(e.to);
      inspectorEl.innerHTML =
        '<div class="field"><label>Line</label>' +
          '<div style="font-family:var(--mono);font-size:12px">' + esc(a.name) + " → " + esc(b.name) + "</div></div>" +
        '<div class="field"><label for="f-label">In two words</label>' +
          '<input type="text" id="f-label" value="' + esc(e.label) + '" placeholder="reads / writes"></div>' +
        '<div class="field"><label>The calls that cross it</label>' +
          '<div class="contract-head"><span>Call</span><span>Sends</span><span>Returns</span><span></span></div>' +
          '<div id="ops"></div>' +
          '<button class="link-btn" id="f-addop">+ Add a call</button>' +
          '<div class="field-help">This is the part plangolin can hold you to. Blocks change constantly; what crosses between them shouldn’t.</div></div>' +
        '<button class="link-btn danger" id="f-delink">Remove this line</button>';

      const opsEl = document.getElementById("ops");
      const drawOps = () => {
        opsEl.innerHTML = e.operations.map((o, i) =>
          '<div class="contract-row">' +
            '<input type="text" data-i="' + i + '" data-f="name" value="' + esc(o.name) + '" placeholder="createPost">' +
            '<input type="text" data-i="' + i + '" data-f="sends" value="' + esc(o.sends) + '" placeholder="caption, file">' +
            '<input type="text" data-i="' + i + '" data-f="returns" value="' + esc(o.returns) + '" placeholder="post id">' +
            '<button class="row-x" data-x="' + i + '" aria-label="Remove call">×</button>' +
          "</div>").join("");
        [].slice.call(opsEl.querySelectorAll("input")).forEach((inp) => {
          inp.addEventListener("input", (ev) => {
            const i = +ev.target.dataset.i;
            const op = Object.assign({}, e.operations[i]);
            op[ev.target.dataset.f] = ev.target.value;
            applyMove({ t: "setOperation", edgeId: eid, index: i, op: op });
            softRender();
          });
        });
        [].slice.call(opsEl.querySelectorAll("[data-x]")).forEach((btn) => {
          btn.addEventListener("click", () => {
            applyMove({ t: "removeOperation", edgeId: eid, index: +btn.dataset.x }); render();
          });
        });
      };
      drawOps();

      const eid = e.id;
      document.getElementById("f-label").addEventListener("input", (ev) => {
        applyMove({ t: "setLabel", id: eid, label: ev.target.value }); softRender();
      });
      document.getElementById("f-addop").addEventListener("click", () => {
        applyMove({ t: "setOperation", edgeId: eid, op: { name: "", sends: "", returns: "" } }); render();
      });
      document.getElementById("f-delink").addEventListener("click", () => {
        applyMove({ t: "disconnect", id: eid }); S.sel = null; render();
      });
    }
  }

  // Re-render everything except the inspector, so typing never loses focus.
  function softRender() {
    persist();
    renderNodes();
    requestAnimationFrame(() => { measure(); renderWires(); });
    renderChecks();
  }

  function renderChecks() {
    if (!CHANGE_VIEW) return;
    const list = planCheck();
    // Collapsed, the strip still carries the top check in full — tag, title and
    // its action. The list is the teaching surface; a bare count would put it
    // behind a click, and nobody clicks for something they don't know is there.
    // The bulb is the whole signal now: lit and glowing in the highest open
    // severity, with the count beside it. No lead strip — the panel it opens
    // carries the reasons.
    const order = { risk: 0, missing: 1, unwired: 2, ai: 3, idea: 4 };
    const top = list.slice().sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9))[0];
    drawBulb(top ? top.sev : null);
    document.getElementById("check-count").textContent = list.length ? String(list.length) : "";

    const localHtml = list.length
      ? list.map((c) =>
          '<div class="check" data-sev="' + c.sev + '" data-id="' + c.id + '">' +
            '<span class="check-tag">' + esc(c.tag) + "</span>" +
            '<p class="check-title">' + esc(c.title) + "</p>" +
            '<p class="check-why">' + c.why + "</p>" +
            (c.act ? '<button class="check-act" data-act="' + c.id + '">' + esc(c.act.label) + "</button>" : "") +
          "</div>").join("")
      : '<div class="checks-clear">Nothing outstanding. Every block says what it does, every line says what crosses it. Add another block and plangolin will keep going.</div>';

    checksEl.innerHTML = localHtml + syncHtml() + changeLogHtml();

    [].slice.call(checksEl.querySelectorAll(".check[data-id]")).forEach((el) => {
      const c = list.find((x) => x.id === el.dataset.id);
      if (!c) return;
      el.addEventListener("mouseenter", () => {
        hoverCheck = c; renderNodes();
        requestAnimationFrame(() => { measure(); renderWires(); });
        spotlight(c);                          // bring the block it means into view
      });
      el.addEventListener("mouseleave", () => { hoverCheck = null; renderNodes(); requestAnimationFrame(() => { measure(); renderWires(); }); });
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-act]")) return;   // the fix button has its own job
        spotlight(c, true);
      });
    });

    [].slice.call(checksEl.querySelectorAll("[data-act]")).forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = list.find((x) => x.id === btn.dataset.act);
        hoverCheck = null;
        applyAction(c.act);
      });
    });

    wireAiReview();
    wireRefreshQueue();
  }

  /* ===================== deep review (AI, on demand) =====================
     Rendered as its own section below the deterministic checks, tagged
     differently, and never mixed into `list` above — these are judgement
     calls from a model, not a rule that either fires or stays quiet. */


  // AI-added blocks come with the connections the model thought to make —
  // which, in practice, is not reliably "all of them" despite being told to.
  // Rather than leave a block sitting on the sheet with no line to anything
  // (which just reads as broken), wire each orphan to the same anchor the
  // deterministic rules already pick for their own suggested adds: whatever
  // block we run ourselves, or failing that, whatever was on the sheet
  // first. A guessed connection that's wrong is still visible and editable;
  // a block with no line at all just looks like the feature failed.
  function wireOrphans(newIds) {
    const anchor = S.nodes.find((n) => newIds.indexOf(n.id) === -1 && traitsOf(n).has("we-run-it"))
      || S.nodes.find((n) => newIds.indexOf(n.id) === -1);
    if (!anchor) return;
    newIds.forEach((id) => {
      if (id !== anchor.id && degree(id) === 0) connect(anchor.id, id, "", true);
    });
  }

  function wireAiReview() {
    [].slice.call(checksEl.querySelectorAll("[data-ai-add]")).forEach((btn) => {
      btn.addEventListener("click", () => acceptFinding(Number(btn.dataset.aiAdd)));
    });
    [].slice.call(checksEl.querySelectorAll("[data-ai-dismiss]")).forEach((btn) => {
      btn.addEventListener("click", () => {
        aiFindings = aiFindings.filter((_, i) => i !== Number(btn.dataset.aiDismiss));
        renderChecks();
      });
    });
  }

  // Same placement logic as replaying a generated sketch: a move with no
  // position gets one from freeSpot, chained off the previous block in the
  // same finding so a multi-block suggestion doesn't pile up in one spot.
  function acceptFinding(i) {
    const f = aiFindings[i];
    if (!f) return;
    undoStack.push(snapshot());
    let anchor = null;
    const addedIds = [];
    f.moves.forEach((m) => {
      applyMove(m, { transient: true });
      if (m.t === "addNode") {
        const n = node(m.node.id);
        if (n && !Number.isFinite(n.x)) {
          const spot = freeSpot(anchor);
          n.x = spot.x; n.y = spot.y;
        }
        anchor = m.node.id;
        addedIds.push(m.node.id);
      }
    });
    wireOrphans(addedIds);
    aiFindings = aiFindings.filter((_, idx) => idx !== i);
    if (anchor) select("node", anchor); else render();
  }


  /* ===================== check against code (free, on demand) =====================
     Read-only diagnostic, no AI, no key needed — does each anchored block's
     folder still exist, does the code still import what the diagram
     implies. Rendered as its own section, same reasoning as Deep Review:
     an external-source snapshot doesn't fit the deterministic RULES engine
     (sync one frame at a time) or its dismiss-and-persist model (a missing
     folder isn't a decision to remember, it's a fact that can change). */

  function syncHtml() {
    if (syncNote) return '<div class="checks-ai-head">Check against code</div><div class="checks-clear">' + esc(syncNote) + "</div>";
    if (!syncResult) return "";

    /* No `imports` here. cb61123 moved import checking from a per-edge regex
       to the real reference graph, and those findings travel in `changes` now
       — where the sheet draws them as wires rather than listing them. The
       branch that read this field outlived the field by a day and threw on
       every press; it is gone rather than guarded, because a guard on a
       result nothing produces is a promise to a caller that no longer
       exists. */
    const { folders } = syncResult;
    if (!folders.length) {
      return '<div class="checks-ai-head">Check against code</div><div class="checks-clear">Nothing linked yet — export, or run "Update from code," to link blocks to real folders first.</div>';
    }

    const problems = folders.filter((f) => !f.exists || f.invalid);
    if (!problems.length) {
      /* Measured over 720 commit pairs, between a third and a half of them
         move nothing at all, measured over real git history. So this is
         not the rare case, it is the second most common thing the product
         ever says, and it has to carry its weight rather than read as an
         empty panel. What it means is worth stating: the drawing still
         matches the code, so the picture in your head is still right. */
      const moved = changedInside.size;
      const files = [...changedInside.values()].reduce((n, f) => n + f.length, 0);
      const since = sinceText();
      return '<div class="checks-ai-head">Check against code</div>' +
        '<div class="checks-clear">' +
        (moved
          ? "Everything still lines up. " + files + (files === 1 ? " file" : " files") +
            " changed" + since + ", across " + moved + (moved === 1 ? " block" : " blocks") +
            " — all of it inside blocks that already existed, so the shape of the system is unchanged."
          : "Nothing has moved" + since + ". The drawing and the code still agree.") +
        "</div>";
    }

    const rows = [];
    problems.forEach((f) => {
      rows.push(
        '<div class="check" data-sev="risk">' +
          '<span class="check-tag">Missing folder</span>' +
          '<p class="check-title">&#8220;' + esc(f.name) + '&#8221; is linked to &#8220;' + esc(f.dir) + '&#8221;</p>' +
          '<p class="check-why">' + (f.invalid ? "That path points outside the project." : "That folder doesn't exist anymore.") + "</p>" +
        "</div>"
      );
    });
    return '<div class="checks-ai-head">Check against code</div>' + rows.join("");
  }

  /* `quiet` is an automatic sync — on load, or on coming back to the tab.
     It updates the marks and says nothing: no button state, no "Reading the
     linked folders" note, and no error banner for a check nobody asked for.
     The marks are the overview and must simply be there; the panel is
     details-on-demand and stays the button's job. */
  async function runSync(quiet) {
    if (syncBusy) return;
    syncBusy = true;
    lastSyncAt = Date.now();
    if (!quiet) {
      syncNote = "Reading the linked folders.";
      renderChecks();
    }

    let payload;
    try {
      const res = await fetch("/api/sync", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodes: S.nodes.map((n) => ({ id: n.id, name: n.name, anchor: n.anchor })),
          edges: S.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
          // Uncommitted work is the only baseline the picker can offer yet.
          // A project with no git ignores this and answers exactly as before.
          // The state to show. `branch` resolves server-side, where git is;
          // `commit` carries the ref, because the ref is the whole choice.
          baseline,
        }),
      });
      payload = await res.json();
    } catch (e) {
      payload = { error: "Couldn't reach the server." };
    }

    syncBusy = false;
    // No button to restore: the sync runs on load and on returning to the
    // tab, so the only thing that reports it is the sheet itself.

    if (payload.error) {
      // A quiet sync keeps whatever the panel already said. Replacing it with
      // an error for a check the user never ran would be the app interrupting
      // itself; the marks go, which is enough to stop it claiming anything.
      if (!quiet) { syncResult = null; syncNote = payload.error; }
      // Marks from the last good sync would otherwise outlive the answer
      // that produced them, which is the one thing a drift detector mustn't do.
      changedInside = new Map();
      wiresGone = new Set();
      wiresNew = [];
      changeGroups = []; pickedGroup = null;
      changeNames = new Map();
    } else {
      syncResult = payload;
      syncNote = "";
      const cs = payload.changes || [];
      // The files, not just how many. A count on the card is the whole point
      // of the card, but a count is also a dead end — the next question is
      // always "which ones", and the answer is already in the payload.
      changedInside = new Map(
        cs.filter((c) => c.type === "block-changed-inside").map((c) => [c.block, c.files]),
      );
      // edge-contradicted is a line you drew yourself that the code disagrees
      // with; edge-lost is one the last scan drew. Both mean the same thing to
      // the eye — this line is no longer carrying anything — so they render
      // alike, and the panel keeps the distinction that matters for what to do
      // about it.
      wiresGone = new Set(
        cs.filter((c) => c.type === "edge-lost" || c.type === "edge-contradicted").map((c) => c.edgeId),
      );
      wiresNew = cs.filter((c) => c.type === "edge-added").map((c) => ({ from: c.from, to: c.to, kind: c.kind }));
      changeGroups = payload.groups || [];
      // A selection only survives if the same change is still there. After a
      // new sync the old index could point at something else entirely.
      if (pickedGroup !== null && pickedGroup >= changeGroups.length) pickedGroup = null;
      // Names describe the change that was named. A new sync is a new set of
      // changes, so keeping the old titles would caption the wrong thing.
      changeNames = new Map();
    }
    // The marks live on the blocks and on the wires between them, so both
    // layers redraw — renderChecks only touches the panel. Wires wait a frame
    // for measure(), which is where block heights come from and therefore
    // where a line knows what to point at. Not render(), which persists: a
    // sync changes nothing about the sheet, so it has nothing to write.
    renderNodes();
    requestAnimationFrame(() => { measure(); renderWires(); });
    renderChecks();
    // The panel carries the file list, so it goes stale with everything else —
    // but renderInspector rebuilds its innerHTML, and a background sync
    // landing mid-sentence would take the caret with it. Only when nobody is
    // typing in there.
    if (!inspectorEl.contains(document.activeElement)) renderInspector();
    // Nothing to acknowledge when nothing is unread, and a button offering to
    // clear an empty sheet is a button that teaches you it does nothing.
    renderChangeBar();
  }

  /* Shared by Complete System and Update from code: both apply everything
     they return in one shot rather than one accept at a time (like Deep
     Review), which means there's nothing left to look at afterward unless
     this exists. A plain record of what just changed — cleared on reset or
     the next run of either. */
  let changeLog = [];
  let changeLogLabel = "";

  function changeLogHtml() {
    if (!changeLog.length) return "";
    return '<div class="checks-ai-head">' + esc(changeLogLabel) + " — what changed</div>" +
      changeLog.map((c) =>
        '<div class="check" data-sev="idea">' +
          '<span class="check-tag">' + esc(c.kind) + "</span>" +
          '<p class="check-title">' + esc(c.title) + "</p>" +
          (c.detail ? '<p class="check-why">' + esc(c.detail) + "</p>" : "") +
        "</div>").join("");
  }

  /* ===================== complete system (AI, on demand) =====================
     The deliberate opposite of deep review: applies everything it returns in
     one shot, under a single undo entry, rather than one finding at a time —
     this is the "just fill it in" button, for after the incremental teaching
     has done its job. */

  let completeBusy = false;


  /* ===================== update from code (AI, on demand) =====================
     Grounded in real code instead of general judgement about the sketch —
     reads the folders already linked to blocks, and proposes rewriting the
     diagram side: refreshing a stale description, or adding a block for
     real code that isn't drawn yet. Unlike Complete System, this does NOT
     apply everything in one shot — real code changes are exactly the case
     where you want to look before it's locked in, so proposals sit in a
     review queue (same accept/dismiss-one-at-a-time shape as Deep Review)
     until you act on each one. Each item names the real file(s) it's
     grounded in — attached server-side, never asked of the model, so it's
     never a guess. */

  // Groups the flat move list into one review item per real change: a new
  // block plus the connects that wire it in, an updated block's intent and
  // details together, or a bare connect between two blocks that already
  // existed. Reads `node()` before anything is applied, so an update item
  // can show what it would replace.
  function groupRefreshMoves(moves) {
    const items = [];
    const byNewId = new Map();
    const byUpdateId = new Map();

    moves.forEach((m) => {
      if (m.t === "addNode") {
        const item = { kind: "add", tag: "New block", title: m.node.name,
          why: m.node.intent || "", citedFiles: (m.citedFiles || []).slice(), moves: [m] };
        items.push(item);
        byNewId.set(m.node.id, item);
        return;
      }
      if (m.t === "setIntent" || m.t === "setDetails") {
        let item = byUpdateId.get(m.id);
        if (!item) {
          const n = node(m.id);
          item = { kind: "update", tag: "Update", title: n ? n.name : m.id,
            why: "", citedFiles: [], moves: [], oldIntent: n ? n.intent : "" };
          items.push(item);
          byUpdateId.set(m.id, item);
        }
        item.moves.push(m);
        (m.citedFiles || []).forEach((f) => { if (item.citedFiles.indexOf(f) === -1) item.citedFiles.push(f); });
        if (m.t === "setIntent") {
          item.why = item.oldIntent && item.oldIntent !== m.intent
            ? "Was: “" + item.oldIntent + "” — now: “" + m.intent + "”"
            : "Now: “" + m.intent + "”";
        } else if (!item.why) {
          item.why = "Details updated: " + m.details.slice(0, 140) + (m.details.length > 140 ? "…" : "");
        }
        return;
      }
      if (m.t === "connect") {
        const target = byNewId.get(m.from) || byNewId.get(m.to);
        if (target) { target.moves.push(m); return; }
        const a = node(m.from), b = node(m.to);
        items.push({ kind: "connect", tag: "Connect",
          title: (a ? a.name : m.from) + " → " + (b ? b.name : m.to),
          why: m.label || "", citedFiles: [], moves: [m] });
      }
    });

    return items;
  }


  function wireRefreshQueue() {
    [].slice.call(checksEl.querySelectorAll("[data-refresh-add]")).forEach((btn) => {
      btn.addEventListener("click", () => acceptRefreshItem(Number(btn.dataset.refreshAdd)));
    });
    [].slice.call(checksEl.querySelectorAll("[data-refresh-dismiss]")).forEach((btn) => {
      btn.addEventListener("click", () => {
        refreshQueue = refreshQueue.filter((_, i) => i !== Number(btn.dataset.refreshDismiss));
        renderChecks();
      });
    });
  }

  // Accepting is just another applyMove() batch through the normal undo +
  // autosave path — identical to hand-editing a block. Nothing here talks
  // to git: the user commits their code and the updated system.json/
  // layout.json together, themselves, outside the app.
  function acceptRefreshItem(i) {
    const item = refreshQueue[i];
    if (!item) return;
    undoStack.push(snapshot());
    let anchor = null;
    const addedIds = [];
    item.moves.forEach((m) => {
      if (m.t === "addNode" && viewRoot) m.node.parent = viewRoot;
      applyMove(m, { transient: true });
      if (m.t === "addNode") {
        const n = node(m.node.id);
        if (n && (n.x == null || !isFinite(n.x))) {
          const spot = freeSpot(anchor);
          n.x = spot.x; n.y = spot.y;
        }
        anchor = m.node.id;
        addedIds.push(m.node.id);
      }
    });
    wireOrphans(addedIds);
    changeLog = changeLog.concat([{
      kind: item.kind === "add" ? "added" : item.kind === "update" ? "updated" : "connected",
      title: item.title, detail: item.why,
    }]);
    changeLogLabel = "Update from code";
    refreshQueue = refreshQueue.filter((_, idx) => idx !== i);
    if (anchor) select("node", anchor); else render();
  }


  /* ============================ actions ============================ */

  // Place a new block in the first free slot that is actually on screen,
  // preferring the space just right of the block that prompted it.
  /* The toolbar floats over the sheet and reserves no column, so the canvas is
     full-bleed and pans underneath it. Auto-layout still has to inset by its
     width or the leftmost block lands behind it. Excalidraw does exactly this —
     float visually, reserve geometrically (STYLES_PANEL_APPROX_WIDTH feeding
     getOffsets). 10px gutter + 58px bar + 16px breathing room. */
  const TOOLBAR_INSET = 84;

  /* Floating panels do not reserve layout space, so clientWidth alone cannot
     describe the part of the canvas a person can see. Measure only visible,
     right-anchored furniture; the change panel currently opens on the left,
     and the inspector rail already shrinks the canvas grid column, so both
     correctly contribute zero unless their layout changes to overlap it. */
  function rightOcclusion() {
    // At this breakpoint the flyouts become bottom sheets. Treating their full
    // width as a right inset would leave no horizontal room at all.
    if (window.matchMedia("(max-width: 900px)").matches) return 0;
    const cr = canvas.getBoundingClientRect();
    let covered = 0;
    ["planpanel", "checkpanel", "changepanel", "rail-right"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return;
      const css = getComputedStyle(el);
      if (css.display === "none" || css.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left >= cr.right || r.right <= cr.left) return;
      const rightAnchored = css.right !== "auto" || r.left >= cr.left + cr.width / 2;
      if (rightAnchored) covered = Math.max(covered, cr.right - r.left);
    });
    return Math.max(0, covered);
  }

  /* Pan the sheet so the block a check is about is actually visible, allowing
     for the panel sitting over the left of the canvas. Hovering nudges; clicking
     centres. Without this the panel would routinely cover the very block it is
     talking about. */
  const PANEL_INSET = 340;                     // 14 gutter + 312 panel + breathing room

  function spotlight(c, centre) {
    const id = (c.marks || [])[0];
    const n = id && node(id);
    if (!n) return;
    const h = heights[n.id] || 80;
    const left = panelOpen() ? PANEL_INSET : 24;
    const right = canvas.clientWidth - 24;
    const top = 76, bottom = canvas.clientHeight - 96;   // bulb above, toolbar below

    // The block on screen, at the current scale — the edges it is measured
    // against (panel, bulb, toolbar) are screen furniture and do not zoom,
    // so the comparison has to happen in screen units.
    const x = n.x * zoom + pan.x, y = n.y * zoom + pan.y;
    const w = NODE_W * zoom, hz = h * zoom;
    let dx = 0, dy = 0;
    if (centre) {
      dx = (left + right) / 2 - (x + w / 2);
      dy = (top + bottom) / 2 - (y + hz / 2);
    } else {
      if (x < left) dx = left - x;
      else if (x + w > right) dx = right - (x + w);
      if (y < top) dy = top - y;
      else if (y + hz > bottom) dy = bottom - (y + hz);
    }
    if (!dx && !dy) return;
    panTo(pan.x + dx, pan.y + dy);
  }

  const panelOpen = () => document.getElementById("shell").dataset.checks === "open";

  let panAnim = null;
  /* tz is optional: leave it out and the scale is held, which is what every
     caller that only wants to slide the sheet wants. */
  function panTo(tx, ty, tz) {
    if (panAnim) cancelAnimationFrame(panAnim);
    const z1 = tz == null ? zoom : tz;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { pan.x = tx; pan.y = ty; zoom = z1; applyCamera(); return; }
    const x0 = pan.x, y0 = pan.y, z0 = zoom, t0 = performance.now(), ms = 220;
    (function step(now) {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);         // ease-out, no overshoot
      pan.x = x0 + (tx - x0) * e;
      pan.y = y0 + (ty - y0) * e;
      // Geometrically, not linearly: halving then halving again should look
      // like two equal steps. It is the same reason zoom velocity comes out
      // exponential in van Wijk and Nuij's optimal path, and one line here.
      zoom = z0 * Math.pow(z1 / z0, e);
      applyCamera();
      if (t < 1) panAnim = requestAnimationFrame(step); else panAnim = null;
    })(t0);
  }

  /* The one place the camera reaches the screen. It used to be written out
     by hand in three places — render, the pan drag, and here — which is how
     they came to disagree; a scale term added to two of three would be a
     silent, intermittent bug.

     The grid scales with the world so the dots stay pinned to the same world
     points. Left unscaled, the paper slides against the blocks sitting on
     it and the whole sheet looks like it is floating. */
  function applyCamera() {
    world.style.transform =
      "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")";
    canvas.style.backgroundPosition = pan.x + "px " + pan.y + "px";
    canvas.style.backgroundSize = (GRID * zoom) + "px " + (GRID * zoom) + "px";
    renderZoom();
    drawOverlay();
  }

  /* The box around what is actually drawn at this level, in world
     coordinates. Heights are the measured ones where measure() has run and
     the same 80px fallback used everywhere else before it has. */
  function levelBounds() {
    const ns = currentLevelNodes().filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    /* Proposed blocks count as content. They are drawn on their own path and
       are deliberately absent from currentLevelNodes, so a fit computed from
       real blocks alone lands with the proposals off the edge — and since a
       proposal is placed beside whatever it connects to, "off the edge" is
       reliably underneath the panel that is asking about it. Fitting to the
       system while hiding the question about it is the wrong answer. */
    const boxes = ns.map((n) => ({ x: n.x, y: n.y, h: heights[n.id] || 80 }));
    ghostAt.forEach((p) => boxes.push({ x: p.x, y: p.y, h: GHOST_H }));
    if (!boxes.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boxes.forEach((b) => {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + NODE_W);
      y1 = Math.max(y1, b.y + b.h);
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /* The pan that centres this level's content at a given scale. Returns null
     when there is nothing to centre on — the one case a caller must not
     paper over, because panning to the computed centre of nothing is exactly
     how you land in an empty view with no cue which way anything is.

     TOOLBAR_INSET keeps the leftmost block clear of the add button, while a
     visible right flyout keeps the rightmost block out from underneath it. */
  function centredPan(atZoom) {
    const b = levelBounds();
    if (!b) return null;
    const z = atZoom || zoom;
    const w = (b.x1 - b.x0) * z, h = (b.y1 - b.y0) * z;
    const room = canvas.clientWidth - TOOLBAR_INSET - rightOcclusion();
    return {
      x: Math.round(TOOLBAR_INSET + Math.max(0, (room - w) / 2) - b.x0 * z),
      y: Math.round(Math.max(24, (canvas.clientHeight - h) / 2) - b.y0 * z),
    };
  }

  /* The scale at which this level's content fits, never above FIT_MAX.
     PAD is breathing room in screen pixels — content flush against the edge
     reads as cropped, as though there were more of it just out of sight. */
  const FIT_PAD = 56;

  function fitZoom() {
    const b = levelBounds();
    if (!b) return null;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w <= 0 || h <= 0) return null;
    const room = canvas.clientWidth - TOOLBAR_INSET - rightOcclusion() - FIT_PAD;
    const tall = canvas.clientHeight - FIT_PAD;
    const whole = Math.min(room / w, tall / h);

    /* Below a point, fitting everything is worse than fitting most of it.
       On a 1000px-wide window the review panel, the toolbar and the padding
       take 544 of it, so a sheet a thousand points across was being drawn at
       37% — every block on screen and not one of them readable. The reader is
       being asked to judge a proposal, and a drawing they have to squint at is
       not evidence.

       So the fit stops at a legible scale and lets the rest be panned to. The
       drawing loses completeness, which the reader can fix with a drag; below
       this it loses legibility, which they cannot fix at all. */
    const LEGIBLE = 0.62;
    return Math.max(ZOOM_MIN, Math.min(FIT_MAX, Math.max(whole, Math.min(LEGIBLE, FIT_MAX))));
  }

  /* Fit is the honest answer to "show me the system": everything at once, as
     large as that allows. It is what the first paint does, what Shift+1
     does, and what clicking the zoom readout does, so all three land in the
     same place — a view you can get back to is worth more than a clever one
     you cannot. */
  function fitLevel(animate) {
    const z = fitZoom();
    if (z == null) return;
    const to = centredPan(z);
    if (!to) return;
    if (animate) return panTo(to.x, to.y, z);   // applies the camera as it goes
    pan.x = to.x; pan.y = to.y; zoom = z;
    applyCamera();
  }

  /* Put this level's content in view without animating there. For arrivals —
     first paint, a scan finishing — where there is no previous view to move
     from and a slide in from the corner would be motion that means nothing.

     Deferred a frame because bounds need measured heights, and measure()
     runs in the rAF that render() queues. Ours is queued after it, so by the
     time this runs the heights are real. */
  function centreOnLevel() {
    requestAnimationFrame(() => fitLevel(false));
  }

  /* Every change of level goes through here, so the camera rules sit in one
     place rather than being duplicated at each call site — which is how the
     breadcrumb and enterNode came to share a bug.

     It moves rather than cutting. The motion is doing work: it says the
     level arriving came out of the block you clicked, and an instant jump is
     the one thing that cannot say that. panTo is already the app's motion at
     220ms and already honours prefers-reduced-motion, so this borrows both
     instead of inventing a second vocabulary. */
  function goToView(id) {
    camByView.set(viewRoot || "", { x: pan.x, y: pan.y, z: zoom });
    viewRoot = id || null;
    render();                          // from here, currentLevelNodes() is the new level
    // Where you left it wins over where the content is: a view you have
    // already arranged is a view you recognise.
    const remembered = camByView.get(viewRoot || "");
    if (remembered) return panTo(remembered.x, remembered.y, remembered.z);
    // A frame's wait, for the same reason centreOnLevel takes one: the
    // blocks of the level being entered have not been measured yet, and
    // fitting to fallback heights lands visibly off. panTo still starts from
    // the camera we came in on, so the motion is unchanged.
    requestAnimationFrame(() => {
      // A level you have not seen before is shown whole. Nothing to show
      // means holding the camera you came in on, not travelling to the
      // computed centre of nothing.
      if (fitZoom() == null) return;
      fitLevel(true);
    });
  }

  /* Zoom about a fixed screen point — usually the cursor. The world point
     under it must not move, which is the whole feel of zooming: you lean in
     on the thing you were looking at rather than on the middle of the
     screen. Solve wx * z + pan = sx for the new pan and that falls out. */
  function zoomAt(sx, sy, next) {
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (z === zoom) return;
    const wx = toWorldX(sx), wy = toWorldY(sy);
    zoom = z;
    pan.x = sx - wx * zoom;
    pan.y = sy - wy * zoom;
    applyCamera();
  }

  /* Ctrl/Cmd + wheel zooms, a bare wheel scrolls the sheet. That split is
     not a preference: a trackpad pinch arrives as a wheel event with
     ctrlKey set, so honouring it is what makes pinch work at all, and it is
     the same division Figma and Miro already taught people.

     passive: false because both branches preventDefault — without it the
     pinch zooms the whole browser page instead of the sheet. */
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) {
      // exp() so a notch is the same proportion of the current scale at
      // every scale, rather than a fixed step that crawls when zoomed out.
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, zoom * Math.exp(-ev.deltaY / 320));
      return;
    }
    pan.x -= ev.deltaX;
    pan.y -= ev.deltaY;
    applyCamera();
  }, { passive: false });

  function freeSpot(nearId) {
    const near = nearId ? node(nearId) : null;
    const COL = 250, ROW = 138;
    // The visible rectangle in world units. Zoomed out, that is a bigger
    // patch of world, which is the point: "where is there room on screen"
    // has to mean the screen you are actually looking at.
    const left = toWorldX(TOOLBAR_INSET);
    const top = toWorldY(24);
    const right = toWorldX(canvas.clientWidth - 24) - NODE_W;
    const bottom = toWorldY(canvas.clientHeight - 110);

    const free = (x, y) => !currentLevelNodes().some((n) => Math.abs(n.x - x) < NODE_W - 6 && Math.abs(n.y - y) < 106);
    const onSheet = (x, y) => x >= left - 8 && x <= right + 8 && y >= top - 8 && y <= bottom + 8;

    const tries = [];
    if (near) {
      tries.push([near.x + COL, near.y], [near.x + COL, near.y + ROW],
                 [near.x + COL, near.y - ROW], [near.x, near.y + ROW]);
    }
    // Then sweep rows outward from the parent's band so blocks stay grouped.
    const rows = [];
    const y0 = near ? near.y : top;
    for (let y = y0; y <= bottom; y += ROW) rows.push(y);
    for (let y = y0 - ROW; y >= top; y -= ROW) rows.push(y);
    rows.forEach((y) => { for (let x = left; x <= right; x += COL) tries.push([x, y]); });

    for (let i = 0; i < tries.length; i++) {
      const x = tries[i][0], y = tries[i][1];
      if (onSheet(x, y) && free(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    // Sheet is full — start a fresh row underneath.
    const maxY = currentLevelNodes().reduce((m, n) => Math.max(m, n.y), top);
    return { x: Math.round(left), y: Math.round(maxY + ROW) };
  }

  function applyAction(act) {
    if (!act) return;

    if (act.kind === "select") { select("node", act.target); focusIntent(); return; }
    if (act.kind === "selectEdge") { select("edge", act.target); return; }

    if (act.wire) { connect(act.wire.from, act.wire.to, act.wire.label); render(); return; }

    if (act.group) {
      const spot = freeSpot(act.group.near);
      const g = {
        id: slug(act.group.name, nodeIds()), kind: "Group", name: act.group.name,
        intent: "Everything in here only talks to " + (node(act.group.near) || {}).name + ".",
        x: spot.x, y: spot.y,
      };
      if (viewRoot) g.parent = viewRoot;
      // One undo entry for the whole grouping, not one per child.
      checkpoint();
      applyMove({ t: "addNode", node: g }, { transient: true });
      act.group.ids.forEach((id, i) => {
        applyMove({ t: "setParent", id: id, parent: g.id }, { transient: true });
        // Gather them so the outline, when opened, contains its own children
        // and nothing else.
        applyMove({ t: "moveNode", id: id,
                    x: spot.x + (i % 2) * (NODE_W + 30),
                    y: spot.y + Math.floor(i / 2) * 150 }, { transient: true });
      });
      select("node", g.id);
      return;
    }

    if (act.add) {
      const a = act.add;
      const spot = freeSpot(a.from);
      const n = { id: slug(a.name, nodeIds()), kind: (KINDS[a.kind] || {}).label || a.kind,
                  name: a.name, intent: a.intent, x: spot.x, y: spot.y };
      if (viewRoot) n.parent = viewRoot;
      checkpoint();
      applyMove({ t: "addNode", node: n }, { transient: true });
      if (a.from && node(a.from)) connect(a.from, n.id, a.label || "", true);
      select("node", n.id);
    }
  }

  function connect(from, to, label, transient) {
    applyMove({ t: "connect", from: from, to: to, label: label || "" }, { transient: !!transient });
  }

  function select(type, id, opts) {
    S.sel = { type: type, id: id };
    hunkView = null;
    if (!opts || opts.panel !== false) inspectorOpen = true;
    render();
  }

  function focusIntent() {
    requestAnimationFrame(() => {
      const t = document.getElementById("f-intent");
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    });
  }

  /* ============================ palette ============================ */

  // Why each non-core kind exists, in the words the check would use. Reference
  // only — nothing here is insertable.
  const WHY = {
    cache:    "Remembers someone between requests",
    email:    "Sends the mail so it doesn’t land in spam",
    payments: "Takes money without you touching card numbers",
    webhooks: "Listens for callbacks that arrive minutes later",
    search:   "Stays fast past a few thousand rows",
    realtime: "A connection that stays open",
    logs:     "How you see what broke",
  };

  /* ---------------------- the tools ----------------------
     Icon-only on purpose. These are verbs, and an arrow, a hand and a note are
     among the few genuinely conventional icons — the ones NN/g calls universal.
     The labelled-icon argument applies to the parts, which are domain nouns a
     beginner has no word for, and those live in the picker. */
  /* Reconciled, not rebuilt. A note holds a live caret while you type, and the
     blur that saves it triggers a render — tearing the element down mid-blur
     both throws and loses the cursor. Same reason the inspector is left alone
     during typing. */
  function renderNotes() {
    const live = new Set();
    (S.notes || []).forEach((n) => {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      live.add(n.id);
      let el = world.querySelector('.sticky[data-id="' + n.id + '"]');
      if (!el) {
        el = document.createElement("div");
        el.className = "sticky";
        el.dataset.id = n.id;
        el.innerHTML =
          '<div class="sticky-text" contenteditable="plaintext-only" ' +
          'data-placeholder="Note to self…"></div>' +
          '<button class="sticky-x" aria-label="Delete note">×</button>';
        const text = el.querySelector(".sticky-text");
        text.textContent = n.text || "";
        text.addEventListener("blur", () => {
          const v = text.textContent.trim();
          const cur = (S.notes || []).find((x) => x.id === n.id);
          if (cur && v !== cur.text) { applyMove({ t: "setNoteText", id: n.id, text: v }); render(); }
        });
        text.addEventListener("keydown", (ev) => { if (ev.key === "Escape") text.blur(); });
        el.querySelector(".sticky-x").addEventListener("click", () => {
          applyMove({ t: "removeNote", id: n.id }); render();
        });
        world.appendChild(el);
      }
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      // Never overwrite what someone is in the middle of typing.
      const text = el.querySelector(".sticky-text");
      if (document.activeElement !== text && text.textContent !== (n.text || "")) {
        text.textContent = n.text || "";
      }
    });
    [].slice.call(world.querySelectorAll(".sticky")).forEach((el) => {
      if (!live.has(el.dataset.id) && el.parentNode) el.remove();
    });
  }

  function buildPalette() {
    const core = document.getElementById("palette-core");
    const more = document.getElementById("palette-more");
    Object.keys(KINDS).forEach((k) => {
      if (KINDS[k].hidden) return;
      const isCore = !!KINDS[k].core;

      // Every kind is insertable. The two groups are ordering only — the second
      // set is what a rule will raise for you, which is worth saying, but it was
      // never a reason to withhold the button.
      const b = document.createElement("button");
      b.className = "part";
      b.type = "button";
      b.dataset.kind = k;
      b.draggable = true;
      b.innerHTML = KINDS[k].icon + "<span>" + esc(KINDS[k].label) +
        (isCore ? "" : "<em>" + esc(WHY[k] || "") + "</em>") + "</span>";
      b.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", k);
        ev.dataTransfer.effectAllowed = "copy";
      });
      b.addEventListener("click", () => {
        dropKind(k, toWorldX(TOOLBAR_INSET + 150), toWorldY(240));
        closePicker();
      });
      (isCore ? core : more).appendChild(b);
    });
  }

  /* ---------------------- tool dispatch ---------------------- */

  const pickerEl = () => document.getElementById("picker");
  const addBtn = () => document.getElementById("add-fab");

  const adderEl = () => document.getElementById("adder");
  const pickerOpen = () => adderEl() && adderEl().dataset.open === "true";

  function closePicker() {
    const a = adderEl(); if (!a) return;
    a.dataset.open = "false";
    pickerEl().setAttribute("aria-hidden", "true");
    const b = addBtn(); if (b) b.setAttribute("aria-expanded", "false");
  }
  /* The picker and the plan check both float over the top-left of the sheet,
     so only one may be open at a time — two overlapping panels over a canvas
     is just an obscured canvas. Opening either shuts the other. */
  function togglePicker() {
    const a = adderEl(); if (!a) return;
    const opening = !pickerOpen();
    if (opening) setChecksOpen(false);
    a.dataset.open = String(opening);
    pickerEl().setAttribute("aria-hidden", String(!opening));
    const b = addBtn(); if (b) b.setAttribute("aria-expanded", String(opening));
  }

  function addNote() {
    const spot = freeSpot(null);
    const id = "note-" + Math.abs(Date.now() % 100000).toString(36) + S.notes.length;
    applyMove({ t: "addNote", note: { id: id, text: "" } });
    applyMove({ t: "moveNote", id: id, x: spot.x, y: spot.y });
    render();
    const el = document.querySelector('.sticky[data-id="' + id + '"] .sticky-text');
    if (el) { el.focus(); }
  }

  function dropKind(kind, x, y) {
    const n = { id: slug(KINDS[kind].label, nodeIds()), kind: KINDS[kind].label,
                name: KINDS[kind].label, intent: "", x: Math.round(x), y: Math.round(y) };
    if (viewRoot) n.parent = viewRoot;
    applyMove({ t: "addNode", node: n });
    select("node", n.id);
    focusIntent();
  }

  canvas.addEventListener("dragover", (ev) => { ev.preventDefault(); canvas.classList.add("dropping"); });
  canvas.addEventListener("dragleave", () => canvas.classList.remove("dropping"));
  canvas.addEventListener("drop", (ev) => {
    ev.preventDefault();
    canvas.classList.remove("dropping");
    const kind = ev.dataTransfer.getData("text/plain");
    if (!KINDS[kind]) return;
    const r = canvas.getBoundingClientRect();
    // The half-card offset is in world units, so it comes off after the
    // conversion — the block lands under the cursor at any scale.
    dropKind(kind, toWorldX(ev.clientX - r.left) - NODE_W / 2, toWorldY(ev.clientY - r.top) - 34);
  });

  /* ============================ pointer ============================ */

  let mode = null; // 'node' | 'ghost' | 'note' | 'pan' | 'wire'
  let start = null;

  // The browser's native dblclick doesn't fire reliably here: select() and
  // render() rebuild every .node element on essentially every click, and
  // most browsers require both clicks of a double-click to land on the
  // *same* DOM element to recognise it as one. Tracked by hand instead,
  // keyed on the node's stable id rather than its (constantly replaced)
  // DOM element.
  let lastNodeClick = null; // { id, time }
  const DBLCLICK_MS = 400;

  canvas.addEventListener("mousedown", (ev) => {
    // A name in the "holds" line is a way in, not a handle. Taken before
    // anything else so pressing one never starts dragging the card it sits
    // on — mousedown, not click, because the drag would already have begun
    // by the time a click fired.
    const goEl = ev.target.closest(".holds-go");
    if (goEl) {
      ev.preventDefault();
      ev.stopPropagation();
      enterNode(goEl.dataset.enter, goEl.dataset.pick);
      return;
    }

    /* The change controls sit on the canvas, so a press on one used to fall
       through to the pan branch below — which calls render(), which rebuilds
       the strip and replaces the very element being pressed. The click never
       fired because its target no longer existed by the time it would have.
       Taken here, before anything can redraw. */
    if (ev.target.closest("#name-btn") || ev.target.closest(".change-chip")) {
      ev.stopPropagation();
      return;
    }

    const portEl = ev.target.closest(".port");
    const nodeEl = ev.target.closest(".node");
    const r = canvas.getBoundingClientRect();
    const wx = toWorldX(ev.clientX - r.left);
    const wy = toWorldY(ev.clientY - r.top);

    if (portEl) {
      ev.preventDefault();
      const n = node(portEl.dataset.port);
      mode = "wire";
      start = { from: n.id };
      dragTemp = { x1: n.x + NODE_W, y1: n.y + (heights[n.id] || 80) / 2, x2: wx, y2: wy, dir: 1 };
      renderWires();
      return;
    }

    // A sticky is dragged by its body. Clicking into the text or the × must not
    // start a drag, or you could never place the caret.
    const noteEl = ev.target.closest(".sticky");
    if (noteEl && !ev.target.closest(".sticky-text") && !ev.target.closest(".sticky-x")) {
      const n = (S.notes || []).find((x) => x.id === noteEl.dataset.id);
      if (n) {
        ev.preventDefault();
        mode = "note";
        start = { id: n.id, dx: wx - n.x, dy: wy - n.y };
        checkpoint();                          // one entry for the whole drag
        noteEl.classList.add("dragging");
        return;
      }
    }

    if (nodeEl && nodeEl.dataset.proposed === "true") {
      const p = ghostAt.get(nodeEl.dataset.id);
      if (!p) return;
      ev.preventDefault();
      mode = "ghost";
      start = { id: nodeEl.dataset.id, dx: wx - p.x, dy: wy - p.y };
      nodeEl.classList.add("dragging");
      return;
    }

    if (nodeEl) {
      const n = node(nodeEl.dataset.id);
      const now = Date.now();
      if (lastNodeClick && lastNodeClick.id === n.id && now - lastNodeClick.time < DBLCLICK_MS) {
        lastNodeClick = null;
        enterNode(n.id);
        return;
      }
      lastNodeClick = { id: n.id, time: now };
      select("node", n.id, { panel: false });
      mode = "node";
      start = { id: n.id, dx: wx - n.x, dy: wy - n.y,
                ox: ev.clientX, oy: ev.clientY, moved: false };
      checkpoint();                            // one entry for the whole drag
      // select() re-renders, so tag the freshly created element, not the one just clicked.
      const fresh = world.querySelector('.node[data-id="' + n.id + '"]');
      if (fresh) fresh.classList.add("dragging");
      return;
    }

    if (ev.target.closest(".wire-hit")) return;

    S.sel = null;
    mode = "pan";
    start = { x: ev.clientX - pan.x, y: ev.clientY - pan.y };
    canvas.classList.add("panning");
    render();
  });

  window.addEventListener("mousemove", (ev) => {
    if (!mode) return;
    const r = canvas.getBoundingClientRect();
    const wx = toWorldX(ev.clientX - r.left);
    const wy = toWorldY(ev.clientY - r.top);

    if (mode === "node") {
      const n = node(start.id);
      if (!n) return;
      if (!start.moved &&
          Math.abs(ev.clientX - start.ox) + Math.abs(ev.clientY - start.oy) > 4) {
        start.moved = true;
      }
      applyMove({ t: "moveNode", id: n.id, x: wx - start.dx, y: wy - start.dy }, { transient: true });
      const el = world.querySelector('.node[data-id="' + n.id + '"]');
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
      renderWires();
    } else if (mode === "ghost") {
      const p = { x: wx - start.dx, y: wy - start.dy };
      movedGhosts.set(start.id, p);
      ghostAt.set(start.id, p);
      const el = world.querySelector('.node[data-proposed="true"][data-id="' + start.id + '"]');
      if (el) { el.style.left = p.x + "px"; el.style.top = p.y + "px"; }
      renderWires();
    } else if (mode === "note") {
      const n = (S.notes || []).find((x) => x.id === start.id);
      if (!n) return;
      applyMove({ t: "moveNote", id: n.id, x: wx - start.dx, y: wy - start.dy }, { transient: true });
      const el = world.querySelector('.sticky[data-id="' + n.id + '"]');
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
    } else if (mode === "pan") {
      // Screen space on both sides, so this stays zoom-free: dragging the
      // paper moves it a pixel per pixel whatever the scale.
      pan.x = ev.clientX - start.x;
      pan.y = ev.clientY - start.y;
      applyCamera();
    } else if (mode === "wire") {
      dragTemp.x2 = wx; dragTemp.y2 = wy;
      dragTemp.dir = wx >= dragTemp.x1 ? 1 : -1;
      renderWires();
    }
  });

  window.addEventListener("mouseup", (ev) => {
    if (mode === "wire") {
      const over = ev.target.closest(".node");
      if (over && over.dataset.id !== start.from) connect(start.from, over.dataset.id, "");
      dragTemp = null;
      mode = null; start = null;
      render();
      return;
    }
    if (mode === "node") {
      const el = world.querySelector(".node.dragging");
      if (el) el.classList.remove("dragging");
      if (start && !start.moved) { inspectorOpen = true; render(); }
      else renderChecks();
    }
    if (mode === "ghost") {
      const el = world.querySelector('.node[data-proposed="true"].dragging');
      if (el) el.classList.remove("dragging");
    }
    if (mode === "note") {
      const el = world.querySelector(".sticky.dragging");
      if (el) el.classList.remove("dragging");
      persist();                               // the drag itself was transient
    }
    canvas.classList.remove("panning");
    mode = null; start = null;
  });

  window.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
      const t = ev.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;    // let the field handle its own undo
      ev.preventDefault();
      undo();
      return;
    }
    /* The two ways back, on the bindings people already have in their hands
       from every other canvas: Cmd/Ctrl+0 to 100%, Shift+1 to fit. There is
       a third in the masthead, because a way out that you have to remember
       is not a way out for the person who most needs one. */
    const typing = ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA";
    if (!typing && (ev.metaKey || ev.ctrlKey) && ev.code === "Digit0") {
      ev.preventDefault();
      // Zoom about the middle of the canvas, not the origin — the sheet
      // stays where you were looking instead of jumping to a corner.
      zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1);
      return;
    }
    // ev.code, not ev.key: shifted "1" is "!" on a US layout and something
    // else again on most others, so keying off the character makes the
    // binding a function of the user's keyboard. The physical key is the
    // thing actually being pressed.
    if (!typing && ev.shiftKey && ev.code === "Digit1") {
      ev.preventDefault();
      fitLevel(true);
      return;
    }

    if (ev.key !== "Backspace" && ev.key !== "Delete") return;
    const t = ev.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
    if (!S.sel) return;
    ev.preventDefault();
    applyMove(S.sel.type === "node"
      ? { t: "removeNode", id: S.sel.id }
      : { t: "disconnect", id: S.sel.id });
    S.sel = null;
    render();
  });

  document.getElementById("zoom").addEventListener("click", () => fitLevel(true));


  /* The change has to be on the sheet when you arrive, not behind a button you
     have to remember — a control you must recall is recall, and the overview
     is the one thing that has to simply be there. An empty sheet has nothing
     to compare, so it waits. */
  function maybeSync() {
    // With no way to see the answer, syncing is a git read nobody asked for.
    if (!CHANGE_VIEW) return;
    if (!ready || syncBusy || !S.nodes.length) return;
    if (Date.now() - lastSyncAt < SYNC_GAP_MS) return;
    runSync(true);
  }

  // Coming back to the tab is the moment you're asking "what happened while I
  // was gone" — visibilitychange rather than focus, which also fires for
  // clicks landing in an already-visible window.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeSync();
  });

  // What each of the four buttons above actually does — filled into a
  // static line below the row rather than a floating tooltip, since the row
  // wraps to two lines in this narrow panel and a bubble positioned under
  // the hovered button routinely landed on top of the other row instead.
  const actTip = document.getElementById("act-tip");
  [].slice.call(document.querySelectorAll(".checkpanel-acts .act-btn")).forEach((btn) => {
    const show = () => { actTip.textContent = btn.dataset.tip || ""; };
    const hide = () => { actTip.textContent = ""; };
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("mouseleave", hide);
    btn.addEventListener("focus", show);
    btn.addEventListener("blur", hide);
  });

  document.getElementById("export-btn").addEventListener("click", async () => {
    const btn = document.getElementById("export-btn");
    const original = btn.textContent;

    // No manual "which folder" field anywhere — if anything's unanchored,
    // ask AI to propose one before building the spec. Skipped entirely (no
    // network call) once every block already has a folder, so the common
    // case stays exactly as fast as a plain export.
    const missingAnchor = S.nodes.some((n) => !n.anchor || !n.anchor.dir);
    if (missingAnchor) {
      btn.disabled = true; btn.textContent = "Working out where things belong…";
      try {
        const res = await fetch("/api/structure", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodes: S.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind, intent: n.intent, anchor: n.anchor })),
          }),
        });
        const payload = await res.json();
        if (payload.anchors && payload.anchors.length) {
          undoStack.push(snapshot());
          payload.anchors.forEach((a) => applyMove({ t: "setAnchor", id: a.id, dir: a.dir }, { transient: true }));
          render();
        }
        if (payload.dropped && payload.dropped.length) console.warn("plangolin: structure dropped", payload.dropped);
      } catch (e) {
        // Never a dead end — no key configured, or the request failed for
        // some other reason. Proceed to export anyway; buildSpec() just
        // marks whatever's still unanchored as "not yet determined."
      }
      btn.disabled = false;
    }

    const spec = buildSpec(S);
    try {
      await navigator.clipboard.writeText(spec);
      btn.textContent = "Copied!";
    } catch (e) {
      // Clipboard blocked (insecure context, permissions, older browser) —
      // fall back to a download so the export is never a dead end.
      const blob = new Blob([spec], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "BUILD.md"; a.click();
      URL.revokeObjectURL(url);
      btn.textContent = "Downloaded";
    }

    // Also save it as a real file in the project, so an AI agent that
    // already has filesystem access here (e.g. a coding agent working in
    // this repo) can just read it directly — no copy-paste required. A
    // failure here is a bonus lost, not a dead end: the clipboard already
    // has the content either way.
    try {
      await fetch("/api/export-file", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: spec }),
      });
      if (btn.textContent === "Copied!") btn.textContent = "Copied + saved!";
    } catch (e) { /* clipboard/download already succeeded above */ }

    setTimeout(() => { btn.textContent = original; }, 2000);
  });

  /* Resizing changes how much room the drawing has, and while a review is open
     it changes it a lot — the panel is a fixed width, so a narrower window
     gives the sheet proportionally less. Refit rather than leave the reader
     with a view computed for a window they no longer have. Only during a
     review: outside one the camera is theirs and moving it would be rude. */
  window.addEventListener("resize", () => {
    drawOverlay();
    positionHint();
    if (plan && planOpen()) fitAfterSettling();
  });
  checksEl.addEventListener("scroll", () => { drawOverlay(); });

  /* A sheet arriving all at once is laid out against the origin, not against
     the camera.

     freeSpot() answers a different question — "where is there room on screen
     right now" — which is right for a block you add by hand and wrong for a
     whole system landing at once. It reads -pan.x, so a node's position
     depended on where the sheet happened to be scrolled when the scan
     finished, the same system could come out laid out differently on two
     runs, and anything past the first screenful spilled below the fold with
     nothing pointing at it. It also made "put the content in view"
     unanswerable, because the content had no position independent of the
     view.

     The shape follows the edges, not the order the blocks happened to
     arrive. Each level lays out from its own origin: levels are drawn one at
     a time, so they cost nothing by overlapping in world space, and every
     view then centres the same way. */
  const LAYOUT_COL = 250, LAYOUT_ROW = 138, LAYOUT_PER_ROW = 4;
  // Past this many columns a chain is wrapped into a new band underneath.
  // One row a mile wide is technically the truth and useless to look at:
  // fit would shrink it until nothing could be read.
  const LAYOUT_MAX_COLS = 5;

  /* Where the blocks go, from what uses what.

     Column is depth: a block sits to the right of everything it uses, so the
     things nothing depends on start at the left and the flow reads the way
     the wires are already drawn. That is the whole reason to prefer this to
     a grid — the picture carries the dependency structure instead of the
     order the scan happened to emit.

     Cycles are broken before layering, not after. Left in, a single edge
     closing a loop drags its whole cycle to the far right — a worker that
     writes back to Orders pushed Orders past the database, the cache and the
     queue it feeds, so three lines that should have read left to right came
     out pointing backwards. The loop-closing edge is still drawn; it just
     gets no say in what sits where.

     Then longest-path layering, relaxed until it settles and bounded by the
     node count, and one barycentre sweep — each block pulled towards the
     average row of what feeds it. That sweep is the cheap half of Sugiyama's
     method and takes out most of the line crossings for a fraction of the
     work. */
  function layeredPositions(ids, edges) {
    const here = new Set(ids);
    const all = edges.filter((e) => here.has(e.from) && here.has(e.to) && e.from !== e.to);

    /* Nothing to follow, so nothing to lay out along: a level whose blocks
       do not reference each other — common enough inside a container — would
       otherwise come out as one tall column, since every block lands in
       layer 0. A grid is the honest shape for a set with no order to it. */
    if (!all.length) {
      return new Map(ids.map((id, i) => [id, {
        x: (i % LAYOUT_PER_ROW) * LAYOUT_COL,
        y: Math.floor(i / LAYOUT_PER_ROW) * LAYOUT_ROW,
      }]));
    }

    /* Depth first, dropping any edge that reaches a block already on the
       stack: that edge is what closes the loop. Started from the blocks
       nothing feeds, so the direction the system actually flows in is the
       one that survives, and an arbitrary entry point does not decide it. */
    const out = new Map(ids.map((id) => [id, []]));
    all.forEach((e) => out.get(e.from).push(e));
    const fed = new Set(all.map((e) => e.to));
    const state = new Map();                    // 1 = on the stack, 2 = finished
    const loops = new Set();
    const walk = (id) => {
      state.set(id, 1);
      out.get(id).forEach((e) => {
        const s = state.get(e.to);
        if (s === 1) loops.add(e);
        else if (s === undefined) walk(e.to);
      });
      state.set(id, 2);
    };
    ids.filter((id) => !fed.has(id)).forEach((id) => { if (!state.has(id)) walk(id); });
    ids.forEach((id) => { if (!state.has(id)) walk(id); });
    const links = all.filter((e) => !loops.has(e));

    const col = new Map(ids.map((id) => [id, 0]));
    for (let pass = 0; pass < ids.length; pass++) {
      let moved = false;
      links.forEach((e) => {
        const want = col.get(e.from) + 1;
        if (col.get(e.to) < want) { col.set(e.to, want); moved = true; }
      });
      if (!moved) break;
    }

    const last = ids.reduce((m, id) => Math.max(m, col.get(id)), 0);
    const columns = [];
    for (let c = 0; c <= last; c++) columns.push(ids.filter((id) => col.get(id) === c));

    const feeders = new Map(ids.map((id) => [id, []]));
    links.forEach((e) => feeders.get(e.to).push(e.from));

    // Filled left to right. Layering guarantees a block's feeders sit in
    // strictly earlier columns, so their rows are always known by the time
    // they are needed.
    const row = new Map();
    const bary = (id) => {
      const ps = feeders.get(id).filter((p) => row.has(p));
      // Nothing feeds it, so nothing pulls it: it keeps its place rather
      // than being sorted to an arbitrary one.
      if (!ps.length) return Number.MAX_SAFE_INTEGER;
      return ps.reduce((s, p) => s + row.get(p), 0) / ps.length;
    };
    columns.forEach((column, c) => {
      if (c > 0) column.sort((a, b) => bary(a) - bary(b));
      column.forEach((id, i) => row.set(id, i));
    });

    const pos = new Map();
    let bandTop = 0;
    for (let start = 0; start < columns.length; start += LAYOUT_MAX_COLS) {
      const band = columns.slice(start, start + LAYOUT_MAX_COLS);
      const tallest = band.reduce((m, c) => Math.max(m, c.length), 0);
      band.forEach((column, i) => {
        // Short columns sit centred against the tallest one, so a fan in or
        // out reads as symmetric rather than top-aligned.
        const offset = (tallest - column.length) / 2;
        column.forEach((id, r) => {
          pos.set(id, {
            x: i * LAYOUT_COL,
            y: Math.round((bandTop + offset + r) * LAYOUT_ROW),
          });
        });
      });
      bandTop += tallest;
    }
    return pos;
  }

  function placeUnpositioned() {
    const missing = S.nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y));
    if (!missing.length) return;

    const levels = new Set(missing.map((n) => n.parent || ""));

    levels.forEach((key) => {
      const all = S.nodes.filter((n) => (n.parent || "") === key);
      const blank = all.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y));

      /* Only a level that is entirely unplaced gets laid out. Anywhere else
         someone has already arranged these blocks, and rearranging a sheet
         behind their back is the one thing this tool must not do — the
         document is theirs, and position is part of it. */
      if (blank.length === all.length) {
        const pos = layeredPositions(all.map((n) => n.id), S.edges);
        all.forEach((n) => {
          const p = pos.get(n.id);
          if (p) applyMove({ t: "moveNode", id: n.id, x: p.x, y: p.y }, { transient: true });
        });
        return;
      }

      // A few late arrivals on a sheet that already has a shape: park them
      // in a grid below everything, where they are findable and in nobody's
      // way, and leave the arrangement alone.
      const floor = all.reduce(
        (m, n) => (Number.isFinite(n.y) ? Math.max(m, n.y) : m), 0) + LAYOUT_ROW;
      blank.forEach((n, i) => {
        applyMove({
          t: "moveNode", id: n.id,
          x: (i % LAYOUT_PER_ROW) * LAYOUT_COL,
          y: floor + Math.floor(i / LAYOUT_PER_ROW) * LAYOUT_ROW,
        }, { transient: true });
      });
    });
  }

  /* ====================== the wait ======================

     A scan is about fifteen seconds, nearly all of it one model call, and
     fifteen seconds of an empty sheet reads as broken. So the wait says
     what is happening, in the voice of the animal doing it.

     The lines are pangolin verbs against the real work — the scan really is
     snuffling through folders and counting what overlaps. Nothing here
     claims a step is running that isn't; the sub-line carries the honest
     description and the elapsed count.                                  */

  const SAYINGS = [
    "uncurling",
    "snuffling out imports",
    "digging through folders",
    "counting scales",
    "sniffing out dependencies",
    "foraging for modules",
    "sorting the plates",
    "nosing about in src",
    "licking up loose ends",
    "padding through the tree",
    "overlapping the edges",
    "tucking in the tail",
  ];
  // Uneven on purpose. A fixed beat is obviously a timer; an animal that
  // stops for a bit longer at one thing and moves straight off another
  // reads as something working rather than something counting.
  //
  // Long enough to read twice and think about. Slowed three times now —
  // 1.2–2.4s, 2.8–4.6s, 4.2–6.8s — always in the same direction, because a
  // line that changes before you have finished with it is churn, and churn
  // reads as flailing rather than as work. At 5.2–8s a fifteen second scan
  // says two or three things instead of five, and each of them gets read.
  // If it is ever slowed a fourth time, the honest change is fewer sayings
  // rather than a longer hold on the same ones.
  const SAY_MIN = 5200;
  const SAY_MAX = 8000;
  // The word holds still for seconds at a time, so the liveness has to come
  // from somewhere: the dots carry it, at a pace you can actually follow.
  const DOT_MS = 420;

  let splashEl = null;
  let splashRaf = 0;
  let splashTimer = 0;
  // Set while a splash is open, so the caller can hand it a real finding
  // without threading the element through.
  let splashSay = null;

  function splashOpen(sub) {
    splashClose();
    splashEl = document.createElement("div");
    splashEl.className = "splash";
    splashEl.innerHTML =
      '<canvas class="splash-ball" id="splash-ball" aria-hidden="true"></canvas>' +
      '<p class="splash-say" id="splash-say" role="status" aria-live="polite"></p>' +
      '<p class="splash-sub" id="splash-sub"></p>';
    canvas.appendChild(splashEl);

    const ball = splashEl.querySelector("#splash-ball");
    const say = splashEl.querySelector("#splash-say");
    const subEl = splashEl.querySelector("#splash-sub");

    // Shuffled so a second scan doesn't open on the same word.
    const order = SAYINGS.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let n = 0;
    let word = "";
    const next = () => {
      word = order[n % order.length];
      n++;
      // Retrigger the entrance. Removing the class and forcing a reflow is
      // the only way to restart a CSS animation on an element that already
      // has it.
      say.classList.remove("in");
      void say.offsetWidth;
      say.classList.add("in");
      splashTimer = setTimeout(next, SAY_MIN + Math.random() * (SAY_MAX - SAY_MIN));
    };
    next();

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pal = ballPalette();
    const dots = document.createElement("span");
    dots.className = "splash-dots";
    const t0 = Date.now();
    let line = sub;
    // The counts arrive about fifteen milliseconds in; the names take
    // fifteen seconds. Past ten seconds a wait owes more than "still going",
    // so as soon as there is something true to say, it says it.
    splashSay = (text) => { line = text; };
    const tick = () => {
      const ms = Date.now() - t0;
      const secs = Math.floor(ms / 1000);
      subEl.textContent = line + (secs >= 3 ? "  ·  " + secs + "s" : "");
      // Trailing dots, one at a time. Held in a fixed-width span so the word
      // does not shuffle sideways as they come and go.
      say.textContent = word;
      say.appendChild(dots);
      dots.textContent = ".".repeat(still ? 3 : (Math.floor(ms / DOT_MS) % 4));
      // A pangolin rolls at a walking pace, not a fidget. One turn every
      // four seconds, with a small bob so it reads as rolling on the sheet
      // rather than spinning in mid-air.
      const t = still ? 0 : (Date.now() - t0) / 1000;
      const angle = (t / 4) * 6.283;
      ball.style.transform = still ? "" : "translateY(" + (Math.sin(angle * 2) * 1.6).toFixed(2) + "px)";
      drawRolled(ball, 96, angle, pal);
      splashRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function splashClose() {
    if (splashRaf) { cancelAnimationFrame(splashRaf); splashRaf = 0; }
    if (splashTimer) { clearTimeout(splashTimer); splashTimer = 0; }
    if (splashEl) { splashEl.remove(); splashEl = null; }
    splashSay = null;
  }

  /* ===================== first run =====================
     One prompt builds the spine, one block at a time. The replay is paced here
     rather than streamed from the model — same "watch it build" moment, far
     less machinery, and the pacing is ours rather than the model's.

     One-shot: the sentence is kept as the project description and never re-run.
     Growth after this goes through the plan check, one accepted suggestion at a
     time, which can never destroy an hour of your editing.
  */
  const REPLAY_MS = 300;


  /* A repo with no sheet gets scanned, not questioned. The old form asked
     "what are you building?" first and offered the scan as one of three
     buttons — the wrong question to put to someone who has just run this
     inside a project that already exists. There is nothing on that form the
     code cannot answer, so the code answers it.

     Returns the payload so the caller can tell "nothing to scan" from
     "the scan failed" and leave an empty sheet rather than an error. */
  const plural = (n, one) => n + " " + one + (n === 1 ? "" : "s");

  async function autoScan() {
    splashOpen("nose to the ground");

    // The cheap half first — it is milliseconds, and it means the wait can
    // say what was found rather than only that something is happening.
    fetch("/api/adopt/survey", { method: "POST" })
      .then((r) => r.json())
      .then((s) => {
        if (!splashSay || s.error || !s.files) return;
        splashSay(
          "snuffled out " + plural(s.files, "file") +
          "  ·  " + plural(s.links, "trail") + " followed" +
          "  ·  curled into " + plural(s.blocks, "block"),
        );
      })
      .catch(() => {});

    let payload;
    try {
      payload = await (await fetch("/api/adopt", { method: "POST" })).json();
    } catch (e) {
      payload = { error: "The plangolin server stopped responding." };
    }
    splashClose();

    if (payload.error || !payload.moves || !payload.moves.length) return payload;
    ready = true;
    await replay(payload.moves);
    // The sheet only exists as of this line, so this is the first moment
    // there is anything to centre on.
    centreOnLevel();
    offerRetry("scan");
    return payload;
  }

  /* Nothing drawn and nothing to read from. An empty screen is an
     invitation, so it says the one thing that would change it. */
  let idleEl = null;

  function idleStart(title, sub) {
    clearIdle();
    ready = true;
    idleEl = document.createElement("div");
    idleEl.className = "splash splash-idle";
    idleEl.innerHTML =
      '<canvas class="splash-ball" id="idle-ball" aria-hidden="true"></canvas>' +
      '<p class="splash-say">' + esc(title) + "</p>" +
      '<p class="splash-sub">' + esc(sub) + "</p>";
    canvas.appendChild(idleEl);
    drawRolled(idleEl.querySelector("#idle-ball"), 96, 0.42);
  }

  function clearIdle() {
    if (idleEl) { idleEl.remove(); idleEl = null; }
  }

  /* ---------------------- the one safe way back ----------------------

     A sheet you have not touched yet is the only sheet that is free to
     throw away, so that is the only moment this is offered. It disappears
     on your first real edit — see applyMove — which is what keeps it from
     becoming the "Start over" button again: there is never a point where
     it can destroy work, because by then it is gone.

     Design §14 rejected a regenerate button because re-running destroys
     editing. This does not contradict that; it exists only while there is
     no editing to destroy.                                              */
  let retryEl = null;

  function offerRetry(mode, prompt) {
    clearRetry();
    retryEl = document.createElement("div");
    retryEl.className = "retry";
    retryEl.innerHTML =
      "<span>Not what you meant?</span>" +
      '<button class="retry-go" id="retry-go">Scan again</button>';
    canvas.appendChild(retryEl);
    retryEl.querySelector("#retry-go").addEventListener("click", async () => {
      clearRetry();
      // Zoom back to 1 with the pan: the rescan lands a fresh sheet and
      // fits it, and starting that from a stale scale means fitting from
      // somewhere arbitrary.
      S = seed(); pan = { x: 0, y: 0 }; zoom = 1; hoverCheck = null;
      render();                                  // ready is true, so this clears the file too
      const payload = await autoScan();
      if (payload && (payload.error || !payload.moves || !payload.moves.length)) {
        idleStart("Nothing came back", payload.error || "The scan found no code to read this time.");
      }
    });
  }

  function clearRetry() {
    if (retryEl) { retryEl.remove(); retryEl = null; }
  }

  async function replay(moves) {
    for (const move of moves) {
      applyMove(move, { transient: true });
      if (move.t === "addNode") {
        const n = node(move.node.id);
        if (n && !Number.isFinite(n.x)) {
          const spot = freeSpot(lastPlaced);
          n.x = spot.x; n.y = spot.y;
          lastPlaced = n.id;
        }
      }
      render();
      await new Promise((r) => setTimeout(r, REPLAY_MS));
    }
    render();
  }
  let lastPlaced = null;

  function fatal(message) {
    document.getElementById("checks").innerHTML =
      '<div class="checks-clear"><strong>Could not open this sheet.</strong><br><br>' +
      esc(message) + '<br><br>Fix the file and reload. Nothing has been written.</div>';
  }

  async function boot() {
    buildPalette();
    let payload;
    try {
      const res = await fetch("/api/doc");
      payload = await res.json();
    } catch (e) {
      payload = { error: "The plangolin server isn't responding. Is it still running?" };
    }

    if (payload.error) {
      // A file we could not parse is never overwritten — a typo must not
      // turn into data loss. Stay read-only and say so.
      fatal(payload.error);
      /* And still poll. A review does not need the sheet: the panel lists
         proposals and plan steps, both of which come from the review itself,
         and the ghosts that do need a sheet are already guarded. Returning
         here left the one path where `plangolin review` cannot be answered at
         all — ten minutes of a blocked session, spent on a typo in a file the
         review never reads. */
      startPlanPolling();
      return;
    }
    sheetLoaded = true;
    /* The review and the sheet arrive in whichever order the network gives
       them, and the fit needs both. Coming from the other side: pollPlan
       returns early once it has seen a review, so a fit it skipped because the
       sheet had not loaded would never get a second chance — on a reload of an
       already-open review that left the sheet at the fallback scale. */
    if (plan && planOpen()) fitAfterSettling();

    // Before the branch below: an empty sheet still wants naming, and the
    // scan it kicks off is the longest wait in the product.
    showProject(payload.root);
    // Here rather than at parse, and here rather than at the end: both
    // branches below set S on their first line, so the first poll — which
    // cannot answer before this function next yields — reads a loaded sheet,
    // and a review that arrived during the long scan still opens.
    startPlanPolling();

    if (payload.doc.nodes.length) {
      S = fromDoc(payload.doc);
      placeUnpositioned();
      ready = true;                        // safe to write from here on
      render();
      centreOnLevel();
      // Not awaited: the sheet draws now, and the marks land a beat later.
      // Blocking the first paint on a filesystem walk would trade the thing
      // you came for against the thing you didn't ask for.
      maybeSync();
    } else {
      // No sheet on disk means the project has never been read. Read it —
      // there is no question worth asking first.
      S = { nodes: [], edges: [], types: {}, dismissed: [], prompt: "", sel: null };
      render();

      let caps = { canScan: false, canGenerate: false };
      let dirs = { dirs: [] };
      try {
        const [capsRes, dirsRes] = await Promise.all([fetch("/api/capabilities"), fetch("/api/fs/dirs")]);
        caps = await capsRes.json();
        dirs = await dirsRes.json();
      } catch (e) {}

      const hasCode = !!(dirs.dirs && dirs.dirs.length);
      if (!hasCode) {
        /* Not when a review is already in flight — pollPlan clears this a beat
           later anyway, and painting it first reads as an error the plan then
           has to argue with. `plan` is set by the pollPlan() that
           startPlanPolling() fired above, which resolves during the two
           fetches this branch just awaited. */
        if (!plan) {
          idleStart("No code here yet", "plangolin reads a project you already have. Run it from a folder with source in it.");
        }
      } else if (!caps.canScan) {
        // Only reachable if the service itself is unreachable; the scan needs
        // no key of yours.
        idleStart("Can't reach plangolin's service", "Scanning happens there. Check your connection and restart.");
      } else {
        const payload = await autoScan();
        if (payload.error) {
          idleStart("The scan stopped", payload.error);
        } else if (!payload.moves || !payload.moves.length) {
          idleStart("Nothing to draw", "Found no source files to read. plangolin works on a project with code in it.");
        }
      }
    }

    (payload.warnings || []).forEach(function (w) { console.warn("plangolin:", w); });
  }

  // Exposed for tests to drive the document and the rules without the DOM.
  // Declared here so every binding above it is initialised.
  window.plangolin = {
    applyMove: applyMove, undo: undo, doc: () => docOf(S), MOVES: MOVES,
    RULES: RULES, planCheck: planCheck, traitsOf: traitsOf, categoryOf: categoryOf,
    setDoc: (d) => restore(Object.assign({ nodes: [], edges: [], types: {}, dismissed: [], prompt: "" }, d)),
    drawFavicon: drawFavicon,
    // Test hook: the changes as the strip currently understands them.
    changes: () => changeGroups.map((g, i) => (changeNames.get(i) || "(unnamed)") + " [" + g.n + "]"),
  };

  // The mark reads its colours from the tokens, so it has to be repainted when
  // the theme changes. Watching the attribute keeps this independent of whoever
  // flips it.
  document.getElementById("inspector-close").addEventListener("click", () => {
    S.sel = null;
    render();
  });
  document.getElementById("hunk-close").addEventListener("click", closeHunks);

  /* ---------------------- the bulb, the panel, the post-it ---------------- */

  /* The bulb's element is gone from the markup — the question mark now holds
     that corner. Its wiring below is kept whole and simply has nothing to bind
     to, so turning CHANGE_VIEW back on is a markup change rather than an
     archaeology exercise. Every use is guarded rather than deleted. */
  const bulbBtn = document.getElementById("bulb");
  const panelEl = document.getElementById("checkpanel");

  const checksOpen = () => shell.dataset.checks === "open";

  /* One door at a time. Two flyouts from the same rail, both landing on the
     same stretch of canvas, is a mess — and the two answer different
     questions, so wanting both at once is not a real want. */
  function setChangesOpen(open) {
    if (!CHANGE_VIEW) return;
    // Guarded on being open: these two close each other, and unguarded that
    // is a loop rather than a rule.
    if (open) { closePicker(); if (checksOpen()) setChecksOpen(false); loadBaselines(); }
    shell.dataset.changes = open ? "open" : "closed";
    renderChangeBar();
    const panel = document.getElementById("changepanel");
    const door = document.getElementById("change-door");
    panel.setAttribute("aria-hidden", String(!open));
    door.setAttribute("aria-expanded", String(open));
  }
  const changesOpen = () => shell.dataset.changes === "open";

  function setChecksOpen(open) {
    if (!CHANGE_VIEW) return;
    if (open) { closePicker(); if (changesOpen()) setChangesOpen(false); }
    shell.dataset.checks = open ? "open" : "closed";
    panelEl.setAttribute("aria-hidden", String(!open));
    if (bulbBtn) bulbBtn.setAttribute("aria-expanded", String(open));
    drawBulb(lastBulbSev);
    drawAsk();
    if (open) drawOverlay();
  }
  if (bulbBtn) {
    bulbBtn.addEventListener("click", () => setChecksOpen(!checksOpen()));
    bulbBtn.addEventListener("mouseenter", () => drawBulb(lastBulbSev));
    bulbBtn.addEventListener("mouseleave", () => drawBulb(lastBulbSev));
  }
  document.getElementById("checks-close").addEventListener("click", () => setChecksOpen(false));

  document.getElementById("add-fab").addEventListener("click", (ev) => {
    ev.stopPropagation();
    togglePicker();
  });
  document.getElementById("add-note").addEventListener("click", () => {
    addNote();
    closePicker();
  });

  // Click-away. mousedown rather than click, so it goes on the same beat as
  // the pan or drag that the click is starting, not one event later.
  document.addEventListener("mousedown", (ev) => {
    const adder = document.getElementById("adder");
    if (adder && !adder.contains(ev.target)) closePicker();
  });

  /* Escape means "out of the innermost thing I am in", and the things you can
     be in are nested: a menu inside a panel, a selection on the sheet, a level
     inside the sheet. So it works outwards one layer per press rather than
     doing everything at once — pressing it with a menu open should close the
     menu and nothing else, not also drop your selection and throw you up a
     level you never asked to leave.

     Going up the levels is the last rung deliberately. It is the only one
     that moves the sheet under you, so it must never be what happens while
     something smaller was still open. */
  window.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;

    // Not while typing. The inspector's fields blur themselves on Escape and
    // do not stop the event, so without this one press would leave the field
    // and leave the level — two things at once, from a key pressed to undo
    // one of them.
    const t = ev.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || ev.target.isContentEditable) return;

    if (pickerOpen()) return closePicker();
    if (hunkView) return closeHunks();
    if (checksOpen()) return setChecksOpen(false);
    if (changesOpen()) return setChangesOpen(false);

    // A selected block opens the inspector, so the selection is a thing you
    // are inside of too, and it comes off before the level does.
    if (S.sel) { S.sel = null; render(); return; }

    if (!viewRoot) return;                        // already at the top
    const here = node(viewRoot);
    goToView(here && here.parent ? here.parent : null);
  });

  /* All three read their colours from the tokens. There is one palette now, so
     the only thing that repaints them is being drawn in the first place —
     nothing the OS does can change what they should look like. */
  drawBrandMark(); drawFavicon(); drawBulb(lastBulbSev); drawAsk();

  boot();
})();
