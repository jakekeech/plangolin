// The one seam between the app and the disk. Nothing else in the codebase may
// touch `fs` — so swapping Node for Tauri later is a new file, not a redesign.
import { promises as fs } from "node:fs";
import path from "node:path";

export function nodeWorkspace(root) {
  // Every existing caller only ever passed a fixed constant (SYSTEM_PATH,
  // LAYOUT_PATH), so containment never mattered before. It matters now: this
  // is the first feature to feed AI-generated (and potentially hand-edited)
  // path text into this boundary.
  const abs = (p) => {
    const full = path.resolve(root, p);
    if (full !== root && !full.startsWith(root + path.sep)) {
      const err = new Error(`path escapes the project folder: ${p}`);
      err.escaped = true;
      throw err;
    }
    return full;
  };

  return {
    root,

    async read(p) {
      try {
        return await fs.readFile(abs(p), "utf8");
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async write(p, content) {
      const full = abs(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      // Write beside, then rename. A crash mid-write must not leave a truncated
      // system.json — losing the design to a power cut is not acceptable.
      const tmp = full + ".tmp";
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, full);
    },

    async exists(p) {
      try {
        await fs.access(abs(p));
        return true;
      } catch (err) {
        if (err.escaped) throw err;
        return false;
      }
    },

    // Immediate children only — not a glob engine. Recursion, excludes, and
    // caps are policy that belongs one layer up (mirrors the schema.js vs
    // workspace.js split elsewhere: this file is pure I/O, callers decide
    // what to do with it).
    async list(p) {
      try {
        const entries = await fs.readdir(abs(p), { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }));
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
