// Turns Python import statements into real project file paths.
//
// Two shapes matter and they resolve differently. A relative import
// ("from .x import y") counts leading dots to decide how far up the package
// tree to start. An absolute one ("import app.services.mail") has no such
// marker, and Python resolves it against sys.path — which in practice means
// the repo root OR whichever directory the app is run from.
//
// This used to try the repo root and nothing else. That silently broke the
// single most common Python layout there is: the app in a subdirectory,
// started from inside it, importing its siblings flat.
//
//     backend/main.py:  from models import Job     ->  backend/models.py
//
// Every FastAPI and Flask project laid out that way produced zero internal
// links, and so collapsed into one featureless block. A real 9-file backend
// scanned to a single node with no edges at all.
//
// So absolute imports now search the root first, then the importing file's
// own directory, then each directory between. First hit wins. Root stays
// first so the repo-rooted layout keeps resolving the way it did.

import path from "node:path";

const RELATIVE = /^[ \t]*from[ \t]+(\.+)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(.+)$/gm;
const FROM_ABS = /^[ \t]*from[ \t]+([A-Za-z_][\w.]*)[ \t]+import[ \t]+/gm;
const IMPORT   = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)/gm;

/** A dotted module resolves either to a module file or to a package
    directory holding __init__.py. Both are real targets. */
function candidates(dir, dotted) {
  const rel = dotted ? dotted.split(".").filter(Boolean) : [];
  const base = path.posix.join(dir, ...rel);
  return [base + ".py", path.posix.join(base, "__init__.py")];
}

function pick(cands, files, fromPath) {
  for (const c of cands) {
    const norm = path.posix.normalize(c);
    if (norm.startsWith("..")) continue;
    if (files.has(norm) && norm !== fromPath) return norm;
  }
  return null;
}

export function pyLinks(fromPath, text, index) {
  const files = index.paths;
  const links = [];
  const seen = new Set();

  const add = (target) => {
    if (!target || seen.has(target)) return;
    seen.add(target);
    links.push({ target, kind: "import" });
  };

  // One dot means "this package" — the file's own directory. Each extra dot
  // climbs one more level.
  RELATIVE.lastIndex = 0;
  for (let m; (m = RELATIVE.exec(text)) !== null; ) {
    const up = m[1].length - 1;
    let dir = path.posix.dirname(fromPath);
    for (let i = 0; i < up; i++) dir = path.posix.dirname(dir);
    if (dir === "." || dir === "/") dir = "";

    if (m[2]) {
      add(pick(candidates(dir, m[2]), files, fromPath));
    } else {
      // "from . import a, b" — each name is its own module.
      for (const raw of m[3].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_]\w*$/.test(name)) add(pick(candidates(dir, name), files, fromPath));
      }
    }
  }

  // Root first, then the file's own directory, then each one above it. A
  // module that exists in more than one of these resolves to the outermost,
  // which is the conservative reading — it is the one place every entry point
  // can see, whatever directory the app is started from.
  const bases = [""];
  for (let dir = path.posix.dirname(fromPath); dir && dir !== "." && dir !== "/"; dir = path.posix.dirname(dir)) {
    if (!bases.includes(dir)) bases.push(dir);
  }

  for (const pattern of [FROM_ABS, IMPORT]) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)) !== null; ) {
      for (const base of bases) {
        const hit = pick(candidates(base, m[1]), files, fromPath);
        if (hit) { add(hit); break; }
      }
    }
  }

  return links;
}
