import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, save } from "./schema.js";
import { generate, pickProvider } from "./generate.js";
import { proposeStructure, listDirs } from "./structure.js";
import { runSync } from "./sync.js";
import { makeGit } from "./git.js";
import { listBaselines } from "./baselines.js";
import { nameChanges } from "./name-change.js";
import { buildFileGraph } from "./filegraph.js";
import { adopt, survey } from "./adopt.js";
import { createPlanStore } from "./plan-store.js";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/* `plans` is passed in by the command that owns the review, so the process
   holding the plan and the process serving the sheet are the same object
   rather than two copies agreeing by luck. It defaults to a fresh store so
   `plangolin` on its own — no review in sight — behaves exactly as before. */
export function createServer(ws, plans = createPlanStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/api/doc" && req.method === "GET") {
        try {
          const { doc, warnings, fresh } = await load(ws);
          return json(res, 200, { doc, warnings, fresh, root: ws.root });
        } catch (err) {
          // readOnly means we could not parse the file. Report it and refuse to
          // load, rather than handing back an empty doc that autosave would
          // then write straight over the top of.
          return json(res, err.readOnly ? 409 : 500, { error: err.message, readOnly: !!err.readOnly });
        }
      }

      // The key lives here and never reaches the browser.
      if (url.pathname === "/api/generate" && req.method === "POST") {
        const { prompt } = await readBody(req);
        if (!prompt || !prompt.trim()) return json(res, 400, { error: "Say what you want to build." });
        try {
          const result = await generate(prompt.trim());
          if (result.dropped.length) console.warn("plangolin: dropped", result.dropped);
          return json(res, 200, result);
        } catch (err) {
          return json(res, err.noKey ? 503 : 502, { error: err.message, noKey: !!err.noKey });
        }
      }

      /* Two different questions, and they used to be answered as one.
         Scanning a project goes through the service, which holds the key, so
         it needs nothing here — reporting a local key as the gate meant a
         perfectly scannable repo was turned away with "No API key" for a key
         it was never going to use. Only describing an app from scratch calls
         a provider directly. */
      if (url.pathname === "/api/capabilities" && req.method === "GET") {
        return json(res, 200, { canScan: true, canGenerate: !!pickProvider() });
      }



      if (url.pathname === "/api/doc" && req.method === "PUT") {
        const doc = await readBody(req);
        await save(ws, doc);
        return json(res, 200, { ok: true });
      }

      // Proposes a real folder for any block that doesn't have one yet —
      // replaces a manual "type the folder path" field, which breaks for a
      // from-scratch project with no code at all. Called by the export flow,
      // only when some block actually lacks an anchor.
      if (url.pathname === "/api/structure" && req.method === "POST") {
        const doc = await readBody(req);
        try {
          const result = await proposeStructure(ws, doc);
          if (result.dropped.length) console.warn("plangolin: structure dropped", result.dropped);
          return json(res, 200, result);
        } catch (err) {
          return json(res, err.noKey ? 503 : 502, { error: err.message, noKey: !!err.noKey });
        }
      }

      // Writes the exported build spec to a real file, alongside
      // system.json/layout.json, so an AI agent already working in this repo
      // can read it directly — no copy-paste required.
      if (url.pathname === "/api/export-file" && req.method === "POST") {
        const { content } = await readBody(req);
        await ws.write("plangolin/BUILD.md", String(content || ""));
        return json(res, 200, { ok: true });
      }

      // The deterministic half of a scan, on its own. No model, no key, no
      // network — about fifteen milliseconds — so the wait can show what was
      // actually found while the naming call is still out.
      if (url.pathname === "/api/adopt/survey" && req.method === "POST") {
        await readBody(req);
        try {
          return json(res, 200, await survey(ws));
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // Read-only. No AI, no key — just "what real folders exist here."
      if (url.pathname === "/api/fs/dirs" && req.method === "GET") {
        return json(res, 200, { dirs: await listDirs(ws) });
      }

      // Read-only — recomputes every reference in the project and reports
      // where the sheet disagrees. Never writes to the sheet.
      if (url.pathname === "/api/sync" && req.method === "POST") {
        const body = await readBody(req);
        try {
          // The body is the doc, as it always was. `baseline` rides alongside
          // as a sibling key — computeDelta only ever reads nodes and edges,
          // so an extra key costs nothing and avoids reshaping the contract.
          return json(res, 200, await runSync(ws, body, body.baseline));
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // What you can compare against. Free — one cheap git call per commit
      // listed, no file reading and no model — which is what lets each row
      // carry how many blocks that commit actually moved.
      if (url.pathname === "/api/baselines" && req.method === "POST") {
        const body = await readBody(req);
        try {
          const graph = await buildFileGraph(ws);
          const out = await listBaselines(makeGit(ws.root), (body && body.nodes) || [], graph.files);
          return json(res, 200, out);
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      // The one model call the diff view makes, and the only one it will
      // ever want. Everything else on the sheet is derived and free; this
      // buys the sentence arithmetic cannot produce — what the change was
      // for. Excerpts are read here rather than sent up: the browser has the
      // block ids and the file paths, and no reason to be holding the code.
      if (url.pathname === "/api/name-change" && req.method === "POST") {
        const body = await readBody(req);
        try {
          const changes = (body && body.changes) || [];
          const nodes = (body && body.nodes) || [];
          const filesByBlock = new Map(Object.entries((body && body.files) || {}));
          // The diff, not the file. What a change was FOR is in the lines
          // that moved; the top of a file is imports, licence headers and —
          // in one real case here — an embedded base64 font, which is what
          // the model dutifully named the change after.
          const git = makeGit(ws.root);
          const ref = (body && body.ref) || "HEAD";
          const excerpts = new Map();
          for (const files of filesByBlock.values()) {
            for (const f of files.slice(0, 4)) {
              if (excerpts.has(f)) continue;
              const patch = await git.patch(ref, f).catch(() => "");
              if (patch.trim()) excerpts.set(f, patch);
            }
          }
          const out = await nameChanges(changes, nodes, filesByBlock, excerpts);
          if (out.dropped.length) console.warn("plangolin: explain dropped", out.dropped);
          // Say when nothing survived. A button that answers with silence
          // reads as broken, and the reason here is worth knowing: the model
          // wanted one title for work that has no single title.
          return json(res, 200, {
            changes: out.changes,
            ...(out.changes.length ? {} : { note: out.dropped.some((d) => d.includes("cover"))
              ? "These changes don't share a single purpose — they're separate pieces of work."
              : "Couldn't summarise these changes." }),
          });
        } catch (err) {
          return json(res, err.noKey ? 503 : 502, { error: err.message, noKey: !!err.noKey });
        }
      }



      // On-demand only, from onboarding's "Scan my code" — reads the real
      // project tree and returns moves for a whole graph in one shot. No
      // request body: like /api/fs/dirs, it operates on ws directly.
      if (url.pathname === "/api/adopt" && req.method === "POST") {
        await readBody(req);
        try {
          /* A review that opened on an unscanned project is already scanning,
             and the browser must draw that scan rather than a second one of
             its own: the brief names blocks by id, and two runs of the model
             pipeline do not agree about ids. Waiting on the one in flight
             costs nothing — it is the same fifteen seconds either way — and it
             is what makes the sheet on screen the sheet the brief describes.
             With no review live there is nothing to take, and this is the
             plain scan it always was. */
          const result = await (plans.takeScan() || adopt(ws));
          if (result.dropped.length) console.warn("plangolin: adopt dropped", result.dropped);
          return json(res, 200, result);
        } catch (err) {
          return json(res, err.noKey ? 503 : 502, { error: err.message, noKey: !!err.noKey });
        }
      }

      if (url.pathname === "/api/plan" && req.method === "GET") {
        return json(res, 200, { review: plans.forBrowser() });
      }

      if (url.pathname === "/api/plan/resolve" && req.method === "POST") {
        const { id, accepted, skipped, nodes } = await readBody(req);
        return json(res, 200, { ok: plans.resolve(id, { accepted, skipped, nodes }) });
      }

      // Held open, then answered "pending" so the caller asks again. Twenty-five
      // seconds is under every default idle timeout worth worrying about.
      if (url.pathname === "/api/plan/result" && req.method === "GET") {
        return json(res, 200, await plans.wait(url.searchParams.get("id"), 25000));
      }

      // static app
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.resolve(APP_DIR, rel);
      if (!file.startsWith(APP_DIR)) return json(res, 403, { error: "no" });

      const body = await fs.readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store",          // this file changes constantly while building
      });
      res.end(body);
    } catch (err) {
      if (err.code === "ENOENT") return json(res, 404, { error: "not found" });
      json(res, 500, { error: err.message });
    }
  });
}
