import { test } from "node:test";
import assert from "node:assert/strict";
import * as adoption from "../src/adopt.js";

const {
  adopt,
  discoverProject,
  fallbackName,
  groupDeps,
  movesFromDiscovery,
  nameProject,
  provisionalImpactContext,
  rollUpEdges,
} = adoption;

const GROUPS = [
  { id: "g1", files: ["src/cli.js", "src/boot.js"], children: [] },
  { id: "g2", files: ["src/llm.js"], children: [] },
];

test("rolls file links up into group dependencies", () => {
  const links = [
    { from: "src/boot.js", to: "src/llm.js", kind: "import" },
    { from: "src/cli.js", to: "src/boot.js", kind: "import" },
  ];
  assert.deepEqual(groupDeps(GROUPS, links).get("g1"), ["g2"]);
  assert.deepEqual(groupDeps(GROUPS, links).get("g2"), []);
});

test("rolls many file links into one edge per pair", () => {
  const links = [
    { from: "src/boot.js", to: "src/llm.js", kind: "import" },
    { from: "src/cli.js", to: "src/llm.js", kind: "import" },
  ];
  const edges = rollUpEdges(GROUPS, links);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { from: "g1", to: "g2", kinds: ["import"], names: [] });
});

test("ignores links that stay inside one group", () => {
  const links = [{ from: "src/cli.js", to: "src/boot.js", kind: "import" }];
  assert.deepEqual(rollUpEdges(GROUPS, links), []);
});

test("records that an edge is only backed by name matching", () => {
  const links = [{ from: "src/boot.js", to: "src/llm.js", kind: "name" }];
  assert.deepEqual(rollUpEdges(GROUPS, links)[0].kinds, ["name"]);
});

test("a child's links are drawn from the child, not its parent", () => {
  const nested = [
    { id: "g1", files: [], children: [{ id: "g1.1", files: ["src/boot.js"], children: [] }] },
    { id: "g2", files: ["src/llm.js"], children: [] },
  ];
  const links = [{ from: "src/boot.js", to: "src/llm.js", kind: "import" }];
  assert.deepEqual(rollUpEdges(nested, links).map((e) => [e.from, e.to]), [["g1.1", "g2"]]);
});

test("fallbackName is used when the model gives nothing", () => {
  assert.equal(fallbackName(["src/llm.js", "src/env.js"]), "Llm");
  assert.equal(fallbackName([]), "Group");
});

const GRAPH = {
  files: ["api/server.js", "data/store.js"],
  links: [{
    from: "api/server.js", to: "data/store.js", kind: "import", names: ["query"],
  }],
  capped: false,
};

const SEMANTIC_GROUPS = [
  { why: "serves HTTP requests", files: ["api/server.js"] },
  { why: "persists records", files: ["data/store.js"] },
];

function stubGrouping(t, groups = SEMANTIC_GROUPS) {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      parsed: { groups }, provider: "test", model: "group-model",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return urls;
}

function excerptWorkspace() {
  const reads = new Map();
  return {
    reads,
    async list() { throw new Error("an injected graph must not scan the workspace"); },
    async read(file) {
      reads.set(file, (reads.get(file) || 0) + 1);
      return `contents of ${file}`;
    },
  };
}

const DESCRIBED = {
  blocks: [
    {
      groupId: "g1", id: "api", name: "API", kind: "HTTP",
      intent: "Serves requests.", details: "Receives API traffic.",
    },
    {
      groupId: "g2", id: "store", name: "Store", kind: "Persistence",
      intent: "Stores records.", details: "Owns durable data.",
    },
  ],
  labels: new Map([["g1 g2", "queries"]]),
  dropped: ["one harmless naming warning"],
  provider: "test",
  model: "name-model",
};

const EXPECTED_MOVES = [
  {
    t: "addNode",
    node: {
      id: "api", name: "API", kind: "HTTP", intent: "Serves requests.",
      details: "Receives API traffic.", anchor: { paths: ["api/server.js"] },
    },
  },
  {
    t: "addNode",
    node: {
      id: "store", name: "Store", kind: "Persistence", intent: "Stores records.",
      details: "Owns durable data.", anchor: { paths: ["data/store.js"] },
    },
  },
  {
    t: "connect", from: "api", to: "store", label: "queries", origin: "scan",
    operations: [{ name: "query", sends: "", returns: "" }],
  },
];

test("exports the reusable adoption stages", () => {
  assert.equal(typeof discoverProject, "function");
  assert.equal(typeof nameProject, "function");
  assert.equal(typeof movesFromDiscovery, "function");
  assert.equal(typeof provisionalImpactContext, "function");
  assert.equal(typeof adopt, "function");
});

test("discovery reuses an injected graph and computes reusable artifacts once", async (t) => {
  const urls = stubGrouping(t);
  const ws = excerptWorkspace();
  const progress = [];

  const discovery = await discoverProject(ws, {
    graph: GRAPH,
    onProgress(event) { progress.push(event); },
  });

  assert.equal(urls.length, 1, "semantic grouping runs once");
  assert.match(urls[0], /\/v1\/group$/);
  assert.equal(ws.reads.get("api/server.js"), 1, "each excerpt is read once");
  assert.equal(ws.reads.get("data/store.js"), 1, "each excerpt is read once");
  assert.deepEqual(discovery.graph, GRAPH);
  assert.deepEqual(discovery.groups, [
    { id: "g1", why: "serves HTTP requests", files: ["api/server.js"], children: [] },
    { id: "g2", why: "persists records", files: ["data/store.js"], children: [] },
  ]);
  assert.deepEqual(discovery.flatGroups, [
    {
      id: "g1", parent: null, files: ["api/server.js"],
      allFiles: ["api/server.js"], children: [], rationale: "serves HTTP requests",
    },
    {
      id: "g2", parent: null, files: ["data/store.js"],
      allFiles: ["data/store.js"], children: [], rationale: "persists records",
    },
  ]);
  assert.ok(discovery.dependencies instanceof Map);
  assert.deepEqual([...discovery.dependencies], [["g1", ["g2"]], ["g2", []]]);
  assert.ok(discovery.excerpts instanceof Map);
  assert.deepEqual([...discovery.excerpts.keys()], GRAPH.files);
  assert.deepEqual(discovery.dropped, []);
  assert.deepEqual(progress, [
    { phase: "mapping_project", counts: { files: 2, links: 1 } },
    { phase: "grouping_components", counts: { components: 2 } },
  ]);
  assert.ok(progress.every(({ counts }) => Object.values(counts).every(Number.isFinite)));
});

test("discovery builds the file graph only once when one is not supplied", async (t) => {
  stubGrouping(t, [{ why: "the program", files: ["a.js", "b.js"] }]);
  let rootListings = 0;
  const reads = new Map([
    ["a.js", "export const a = 1;"],
    ["b.js", "import { a } from './a.js';\nexport const b = a;"],
  ]);
  const ws = {
    async list(dir) {
      assert.equal(dir, "");
      rootListings += 1;
      return [{ name: "a.js", dir: false }, { name: "b.js", dir: false }];
    },
    async read(file) { return reads.get(file) ?? null; },
  };

  const discovery = await discoverProject(ws);

  assert.equal(rootListings, 2, "one graph pass lists source files and alias configs once each");
  assert.deepEqual(discovery.graph.files, ["a.js", "b.js"]);
  assert.equal(discovery.flatGroups.length, 1);
});

test("discovery folds implementation groups and calculates their final dependencies", async (t) => {
  const graph = {
    files: ["src/hub.js", "src/reader.js", "src/writer.js"],
    links: [
      { from: "src/hub.js", to: "src/reader.js", kind: "import", names: ["read"] },
      { from: "src/hub.js", to: "src/writer.js", kind: "import", names: ["write"] },
    ],
    capped: false,
  };
  stubGrouping(t, [
    { why: "coordinates work", files: ["src/hub.js"] },
    { why: "reads records", files: ["src/reader.js"] },
    { why: "writes records", files: ["src/writer.js"] },
  ]);
  const ws = {
    async list() { throw new Error("the injected graph must be reused"); },
    async read(file) { return `contents of ${file}`; },
  };

  const discovery = await discoverProject(ws, { graph });

  assert.deepEqual(discovery.groups.map((group) => group.id), ["g1"]);
  assert.deepEqual(discovery.groups[0].children.map((group) => group.id), ["g1.1", "g1.2"]);
  assert.deepEqual(discovery.flatGroups.map(({ id, parent }) => ({ id, parent })), [
    { id: "g1", parent: null },
    { id: "g1.1", parent: "g1" },
    { id: "g1.2", parent: "g1" },
  ]);
  assert.deepEqual([...discovery.dependencies], [
    ["g1", ["g1.1", "g1.2"]],
    ["g1.1", []],
    ["g1.2", []],
  ]);
});

test("naming failure keeps fallback metadata instead of failing adoption", async () => {
  const progress = [];
  const discovery = {
    graph: GRAPH,
    groups: [
      { id: "g1", why: "serves HTTP requests", files: ["api/server.js"], children: [] },
      { id: "g2", why: "persists records", files: ["data/store.js"], children: [] },
    ],
    flatGroups: [{ id: "g1" }, { id: "g2" }],
    dependencies: new Map(), excerpts: new Map(), dropped: [],
  };

  const described = await nameProject(discovery, {
    describe: async () => { throw new Error("provider unavailable"); },
    onProgress(event) { progress.push(event); },
  });

  assert.deepEqual(described, {
    blocks: [], labels: new Map(),
    dropped: ["naming failed, using file names instead: provider unavailable"],
    provider: null, model: null,
  });
  assert.deepEqual(progress, [
    { phase: "naming_and_matching", counts: { components: 2 } },
  ]);
});

test("move generation preserves fallbacks and returns the group id mapping", () => {
  const discovery = {
    graph: GRAPH,
    groups: [
      { id: "g1", files: ["api/server.js"], children: [] },
      { id: "g2", files: ["data/store.js"], children: [] },
    ],
    flatGroups: [
      {
        id: "g1", parent: null, files: ["api/server.js"],
        allFiles: ["api/server.js"], children: [], rationale: "",
      },
      {
        id: "g2", parent: null, files: ["data/store.js"],
        allFiles: ["data/store.js"], children: [], rationale: "",
      },
    ],
  };
  const described = {
    blocks: [DESCRIBED.blocks[0]], labels: new Map(), dropped: [],
    provider: "test", model: "name-model",
  };

  const { moves, idFor } = movesFromDiscovery(discovery, described);

  assert.deepEqual([...idFor], [["g1", "api"], ["g2", "store"]]);
  assert.deepEqual(moves[1], {
    t: "addNode",
    node: {
      id: "store", name: "Store", kind: "", intent: "", details: "",
      anchor: { paths: ["data/store.js"] },
    },
  });
  assert.deepEqual(moves[2], {
    t: "connect", from: "api", to: "store", label: "imports", origin: "scan",
    operations: [{ name: "query", sends: "", returns: "" }],
  });
});

test("provisional context uses group refs with ownership evidence, not final ids", () => {
  const discovery = {
    graph: GRAPH,
    groups: [
      {
        id: "g1", files: [], children: [
          { id: "g1.1", why: "serves HTTP requests", files: ["api/server.js"], children: [] },
        ],
      },
      { id: "g2", why: "persists records", files: ["data/store.js"], children: [] },
    ],
    flatGroups: [
      {
        id: "g1", parent: null, files: [], allFiles: ["api/server.js"],
        children: [], rationale: "",
      },
      {
        id: "g1.1", parent: "g1", files: ["api/server.js"],
        allFiles: ["api/server.js"], children: [], rationale: "serves HTTP requests",
      },
      {
        id: "g2", parent: null, files: ["data/store.js"],
        allFiles: ["data/store.js"], children: [], rationale: "persists records",
      },
    ],
    dependencies: new Map([["g1", []], ["g1.1", ["g2"]], ["g2", []]]),
  };

  const context = provisionalImpactContext(discovery);

  assert.deepEqual(context, {
    nodes: [],
    edges: [{ from: "g1.1", to: "g2" }],
    groups: [
      { ref: "g1", parent: null, files: [], rationale: "", dependencies: [] },
      {
        ref: "g1.1", parent: "g1", files: ["api/server.js"],
        rationale: "serves HTTP requests", dependencies: ["g2"],
      },
      {
        ref: "g2", parent: null, files: ["data/store.js"],
        rationale: "persists records", dependencies: [],
      },
    ],
  });
  assert.ok(context.groups.every((group) => !Object.hasOwn(group, "id")));
  const refs = context.groups.flatMap((group) => [
    group.ref, group.parent, ...group.dependencies,
  ]).filter(Boolean);
  refs.push(...context.edges.flatMap((edge) => [edge.from, edge.to]));
  assert.ok(!refs.includes("api"));
  assert.ok(!refs.includes("store"));
});

test("adopt composes discovery and naming into the legacy move result", async (t) => {
  stubGrouping(t);
  const ws = excerptWorkspace();
  let descriptions = 0;
  const describe = async (groups, dependencies, excerpts) => {
    descriptions += 1;
    assert.equal(groups.length, 2);
    assert.deepEqual([...dependencies], [["g1", ["g2"]], ["g2", []]]);
    assert.deepEqual([...excerpts.keys()], GRAPH.files);
    return DESCRIBED;
  };

  const result = await adopt(ws, { graph: GRAPH, describe });

  assert.equal(descriptions, 1);
  assert.deepEqual(result, {
    moves: EXPECTED_MOVES,
    dropped: ["one harmless naming warning"],
    provider: "test",
    model: "name-model",
  });
});

test("adopt ignores synchronous and rejected progress observer failures", async (t) => {
  stubGrouping(t);
  const phases = [];
  const result = await adopt(excerptWorkspace(), {
    graph: GRAPH,
    describe: async () => DESCRIBED,
    onProgress(event) {
      phases.push(event.phase);
      if (event.phase === "grouping_components") {
        return Promise.reject(new Error("private progress sink rejection"));
      }
      throw new Error("private progress sink throw");
    },
  });

  assert.deepEqual(phases, [
    "mapping_project", "grouping_components", "naming_and_matching",
  ]);
  assert.deepEqual(result, {
    moves: EXPECTED_MOVES,
    dropped: ["one harmless naming warning"],
    provider: "test",
    model: "name-model",
  });
  assert.doesNotMatch(result.dropped.join(" "), /private progress sink/);
});

test("empty discovery ignores a rejected grouping progress observer", async () => {
  const phases = [];
  const discovery = await discoverProject({
    async list() { throw new Error("the injected graph must be reused"); },
    async read() { return null; },
  }, {
    graph: { files: [], links: [], capped: false },
    onProgress(event) {
      phases.push(event.phase);
      if (event.phase === "grouping_components") {
        return Promise.reject(new Error("private empty-project progress rejection"));
      }
    },
  });

  assert.deepEqual(phases, ["mapping_project", "grouping_components"]);
  assert.deepEqual(discovery.dropped, ["no source files found"]);
  assert.deepEqual(discovery.groups, []);
  assert.deepEqual(discovery.flatGroups, []);
});

test("nameProject ignores a rejected progress observer without changing naming metadata", async () => {
  let descriptions = 0;
  const discovery = {
    graph: GRAPH,
    groups: [
      { id: "g1", why: "serves HTTP requests", files: ["api/server.js"], children: [] },
      { id: "g2", why: "persists records", files: ["data/store.js"], children: [] },
    ],
    flatGroups: [{ id: "g1" }, { id: "g2" }],
    dependencies: new Map([["g1", ["g2"]], ["g2", []]]),
    excerpts: new Map(),
    dropped: [],
  };

  const described = await nameProject(discovery, {
    describe: async () => { descriptions += 1; return DESCRIBED; },
    onProgress: async () => { throw new Error("private naming progress rejection"); },
  });

  assert.equal(descriptions, 1);
  assert.deepEqual(described, DESCRIBED);
  assert.doesNotMatch(described.dropped.join(" "), /private naming progress/);
});

test("adopt preserves the empty-project result without calling naming", async () => {
  let descriptions = 0;
  const result = await adopt({
    async list() { throw new Error("the injected graph must be reused"); },
    async read() { return null; },
  }, {
    graph: { files: [], links: [], capped: false },
    describe: async () => { descriptions += 1; return DESCRIBED; },
  });

  assert.equal(descriptions, 0);
  assert.deepEqual(result, {
    moves: [], dropped: ["no source files found"], provider: null, model: null,
  });
});
