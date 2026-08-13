import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, httpRoutes, httpLinks } from "../src/imports/http.js";
import { callTask } from "../src/llm.js";

test("normalises the three ways a route says 'anything'", () => {
  assert.equal(normalise("/api/jobs/${id}"), "/api/jobs/*");   // template literal
  assert.equal(normalise("/api/jobs/{id}"), "/api/jobs/*");    // FastAPI, Flask
  assert.equal(normalise("/api/jobs/:id"), "/api/jobs/*");     // Express
});

test("drops the query string, so a call matches the route it hits", () => {
  assert.equal(normalise("/api/jobs?hunt_id=${id}"), "/api/jobs");
});

test("refuses anything that is not an absolute path", () => {
  assert.equal(normalise("api/jobs"), "");
  assert.equal(normalise(""), "");
  assert.equal(normalise("https://example.com/x"), "");
});

test("reads a browser calling out", () => {
  const r = httpRoutes(`const res = await fetch('/api/hunt', { method: 'POST' });`);
  assert.deepEqual(r.calls, ["/api/hunt"]);
  assert.deepEqual(r.serves, []);
});

test("reads a FastAPI route", () => {
  const r = httpRoutes(`@app.post("/api/hunt")\nasync def start_hunt():\n    pass`);
  assert.deepEqual(r.serves, ["/api/hunt"]);
  assert.deepEqual(r.calls, []);
});

test("reads an Express route", () => {
  const r = httpRoutes(`app.get("/api/jobs/:id", (req, res) => res.json({}));`);
  assert.deepEqual(r.serves, ["/api/jobs/*"]);
});

// `axios.get("/x")` and `app.get("/x")` look identical apart from the
// receiver. Reading the first as a route definition would draw every caller
// as a server.
test("an axios call is a call, not a route", () => {
  const r = httpRoutes(`axios.get("/api/profile")`);
  assert.deepEqual(r.calls, ["/api/profile"]);
  assert.deepEqual(r.serves, []);
});

test("a file that serves a path and also calls it is not linked to itself", () => {
  const r = httpRoutes(`@app.get("/api/x")\ndef h(): pass\nfetch("/api/x")`);
  assert.deepEqual(r.serves, ["/api/x"]);
  assert.deepEqual(r.calls, []);
});

// "/" is a health check or an index page on nearly every server.
test("ignores the root path", () => {
  assert.deepEqual(httpRoutes(`@app.get("/")\ndef home(): pass`).serves, []);
});

test("links a caller to the file that serves the path", () => {
  const links = httpLinks(new Map([
    ["web/App.jsx", { calls: ["/api/hunt"], serves: [] }],
    ["api/main.py", { calls: [], serves: ["/api/hunt"] }],
  ]));
  assert.deepEqual(links, [
    { from: "web/App.jsx", to: "api/main.py", kind: "http", names: ["/api/hunt"] },
  ]);
});

test("draws nothing when no server offers the path", () => {
  const links = httpLinks(new Map([["web/App.jsx", { calls: ["/api/gone"], serves: [] }]]));
  assert.deepEqual(links, []);
});

// A test registering a route is standing in for the server, not being it.
test("prefers the real server over a test that registers the same route", () => {
  const links = httpLinks(new Map([
    ["web/App.tsx", { calls: ["/api/active"], serves: [] }],
    ["api/routes.ts", { calls: [], serves: ["/api/active"] }],
    ["api/tests/origin.test.ts", { calls: [], serves: ["/api/active"] }],
  ]));
  assert.deepEqual(links.map((l) => l.to), ["api/routes.ts"]);
});

test("keeps a test server when it is the only one", () => {
  const links = httpLinks(new Map([
    ["web/App.tsx", { calls: ["/api/active"], serves: [] }],
    ["api/origin.test.ts", { calls: [], serves: ["/api/active"] }],
  ]));
  assert.deepEqual(links.map((l) => l.to), ["api/origin.test.ts"]);
});

test("an unsupported impact endpoint is a service-version error without plan fallback", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    callTask({ task: "impact", prompt: "review" }),
    (error) => {
      assert.equal(error.userFacing, true);
      assert.equal(error.serviceVersion, true);
      assert.equal(
        error.message,
        "This Plangolin service does not support impact review yet. Retry after it updates, or skip this review.",
      );
      return true;
    },
  );
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/v1\/impact$/);
  assert.ok(urls.every((url) => !url.endsWith("/v1/plan")));
});
