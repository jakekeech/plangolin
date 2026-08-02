// Two guards for the generic reader, both learned from graphify's scars.
//
// A file called utils.py is mentioned by half the repo, so without a
// stoplist it becomes a hub that everything falsely connects to and the
// clustering collapses around it. And a .py file containing the word
// "mailer" must not link to mailer.go — label matching fires across
// language families in a monorepo and produces edges that cannot exist.

export const STOPLIST = new Set([
  "index", "main", "app", "util", "utils", "helper", "helpers",
  "config", "settings", "types", "type", "test", "tests", "spec",
  "lib", "core", "common", "base", "data", "model", "models",
  "client", "server", "service", "services", "handler", "handlers",
  "api", "routes", "router", "setup", "init", "constants", "errors",
]);

/** Extensions sharing a runtime can legitimately reference each other;
    anything else cannot. "" means unknown, which matches permissively —
    an unrecognised language is exactly where the generic reader earns its
    place, so it must not be gated behind a family table we did not write. */
const FAMILY = {
  python: [".py", ".pyw", ".pyi"],
  js: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte"],
  go: [".go"],
  rust: [".rs"],
  jvm: [".java", ".kt", ".kts", ".scala", ".groovy"],
  c: [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hxx"],
  ruby: [".rb", ".rake"],
  php: [".php"],
  csharp: [".cs"],
  swift: [".swift"],
};

const BY_EXT = new Map();
for (const [family, exts] of Object.entries(FAMILY)) {
  for (const ext of exts) BY_EXT.set(ext, family);
}

export function familyOf(p) {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : BY_EXT.get(p.slice(i).toLowerCase()) || "";
}
