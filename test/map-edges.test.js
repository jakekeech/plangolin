import { test } from "node:test";
import assert from "node:assert/strict";
import { completeMapEdges } from "../src/map-edges.js";

test("restores code-backed edges when an existing project map has none", () => {
  const nodes = [
    { id: "app", anchor: { paths: ["app/index.tsx", "app/analyse.tsx"] } },
    { id: "api", anchor: { paths: ["server/api.py"] } },
  ];
  const graph = {
    files: ["app/index.tsx", "app/analyse.tsx", "server/api.py"],
    links: [
      { from: "app/index.tsx", to: "server/api.py", kind: "http", names: ["/analyze/video"] },
      { from: "app/analyse.tsx", to: "server/api.py", kind: "http", names: ["/jobs/*"] },
    ],
  };

  assert.deepEqual(completeMapEdges(nodes, [], graph), [{
    id: "scan:app>api",
    from: "app",
    to: "api",
    label: "calls API",
    origin: "scan",
    operations: [
      { name: "/analyze/video", sends: "", returns: "" },
      { name: "/jobs/*", sends: "", returns: "" },
    ],
  }]);
});

test("does not duplicate an edge already present on the map", () => {
  const existing = [{
    id: "app__api", from: "app", to: "api", label: "submits video", origin: "user", operations: [],
  }];
  const graph = {
    files: ["app/index.tsx", "server/api.py"],
    links: [{ from: "app/index.tsx", to: "server/api.py", kind: "http", names: ["/analyze/video"] }],
  };
  const nodes = [
    { id: "app", anchor: { paths: ["app/index.tsx"] } },
    { id: "api", anchor: { paths: ["server/api.py"] } },
  ];

  assert.deepEqual(completeMapEdges(nodes, existing, graph), existing);
});
