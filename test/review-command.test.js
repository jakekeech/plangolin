import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReview } from "../src/review-command.js";
import { createPlanStore } from "../src/plan-store.js";
import { createServer } from "../src/server.js";

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plangolin-review-"));
  await fs.mkdir(path.join(root, "plangolin"), { recursive: true });
  await fs.writeFile(path.join(root, "plangolin", "system.json"), JSON.stringify({
    version: 1, nodes: [{ id: "server", name: "Server", intent: "Serves the app." }],
    edges: [], notes: [], types: {}, dismissed: [],
  }));
  return root;
}

function reviewableStore() {
  return createPlanStore({
    impact: async (_context, steps) => ({
      impacts: [{
        key: "impact:1", level: "support", targetId: "", title: "Build the plan",
        why: "Carries out the requested work.", size: "small", steps: steps.map((step) => step.n),
        files: [], symbols: [], additions: [], removals: [], responsibilities: [],
        connections: [], disconnections: [],
      }],
      diagnostics: { invalidOperations: 0, issues: [] },
      coverage: { claimed: steps.length, total: steps.length },
      provider: "test", model: "test", outcome: "ready",
    }),
  });
}

/** Drives the browser's half: waits for the review to be ready, then resolves
    it through the same route the app uses. */
function approveVia(urlHolder, accepted) {
  return async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (!urlHolder.url) continue;
      const { review } = await fetch(urlHolder.url + "/api/plan").then((r) => r.json()).catch(() => ({}));
      if (!review || (review.status !== "ready" && review.status !== "partial")) continue;
      await fetch(urlHolder.url + "/api/plan/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: review.id, accepted, nodes: [{ id: "server", name: "Server" }] }),
      });
      return;
    }
  };
}

test("approving prints a brief and exits 0", async () => {
  const root = await project();
  const holder = {};
  const open = (url) => { holder.url = url; approveVia(holder, [])(); };
  const { code, brief } = await runReview(root, "1. Add a limiter\n2. Wire it up\n", {
    open, timeout: 2_000, plans: reviewableStore(), port: 0,
  });
  assert.equal(code, 0);
  assert.match(brief, /Reviewed in plangolin/);
});

test("the browser exposes live progress while the command names the system map", async () => {
  const browser = createServer({ root: "/tmp/plangolin-static" });
  await new Promise((r) => browser.listen(0, "127.0.0.1", r));
  const root = await project();
  const holder = {};
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (text) => { writes.push(String(text)); return true; };
  try {
    const html = await fetch(`http://127.0.0.1:${browser.address().port}/`).then((r) => r.text());
    const loading = html.match(/<div class="plan-loading" id="plan-loading" hidden>([\s\S]*?)<\/div>/);
    assert.ok(loading, "served app includes its plan-loading element");
    assert.match(html, /id="plan-status" role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(loading[1], /id="plan-progress"/);
    assert.doesNotMatch(loading[1], /role="status"|aria-live/);
    assert.doesNotMatch(loading[1], /Preparing the plan against your system map/);
    assert.doesNotMatch(loading[1], /sheet/i);

    const open = (url) => { holder.url = url; approveVia(holder, [])(); };
    await runReview(root, "1. Add a limiter\n", {
      open, timeout: 2_000, plans: reviewableStore(), port: 0,
    });
  } finally {
    process.stderr.write = originalWrite;
    await new Promise((r) => browser.close(r));
  }
  assert.match(writes.join(""), /Preparing the plan against your system map\./);
});

// A forgotten browser tab must not strand the session. Proceeding as written
// is the same outcome the user would have had without plangolin at all.
test("no decision inside the window still returns, saying so", async () => {
  const root = await project();
  let openedUrl = "";
  const { code, brief } = await runReview(root, "1. Add a limiter\n", {
    open: (url) => { openedUrl = url; }, timeout: 300, port: 0,
  });
  assert.equal(code, 0);
  assert.match(brief, /not reviewed|as written/i);
  assert.ok(Number(new URL(openedUrl).port) > 0);
  assert.notEqual(new URL(openedUrl).port, "4300");
});

test("skipping returns without a brief", async () => {
  const root = await project();
  const holder = {};
  const open = (url) => {
    holder.url = url;
    (async () => {
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const { review } = await fetch(url + "/api/plan").then((r) => r.json()).catch(() => ({}));
        if (!review) continue;
        await fetch(url + "/api/plan/resolve", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: review.id, skipped: true }),
        });
        return;
      }
    })();
  };
  const { code, brief } = await runReview(root, "1. Add a limiter\n", { open, timeout: 20000, port: 0 });
  assert.equal(code, 0);
  assert.match(brief, /skipped|as written/i);
});

test("an empty plan is refused before anything is started", async () => {
  const root = await project();
  const { code } = await runReview(root, "   \n", { open: () => { throw new Error("must not open"); }, timeout: 500 });
  assert.equal(code, 1);
});

// The server must not be left listening when the command is done, or a second
// /plangolin in the same session finds the port taken and the old review live.
test("the server is closed on the way out", async () => {
  const root = await project();
  const holder = {};
  const open = (url) => { holder.url = url; approveVia(holder, [])(); };
  await runReview(root, "1. Add a limiter\n", {
    open, timeout: 2_000, plans: reviewableStore(), port: 0,
  });
  await assert.rejects(fetch(holder.url + "/api/plan"));
});
