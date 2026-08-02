// The edges imports cannot see.
//
// A React app and a Python API in one repository are two systems that talk
// constantly and import nothing from each other. Every link in this project
// came from an import statement, so the most important relationship in a
// full-stack repo — the browser calling the server — was the one edge the
// graph could never draw. On the project that prompted this, five real
// connections were invisible while six less interesting ones were drawn.
//
// This keeps them facts rather than guesses. A route path is a string literal
// on both sides: the caller writes `fetch("/api/hunt")` and the server writes
// `@app.post("/api/hunt")`. Matching those is string comparison, not
// judgement, and the resulting edge means "this file calls a URL that this
// file serves" — which a reader can check in seconds, exactly like an import.
//
// Deliberately conservative. Only string literals starting with "/" are
// considered, so a URL built at runtime is missed rather than guessed at.
// Missing an edge leaves the sheet as it was; inventing one makes every other
// edge less trustworthy.

// Path segments that vary: `${id}` in a template literal, `{id}` in FastAPI
// and Flask, `:id` in Express. All three mean "anything", so all three
// normalise to the same thing and match each other.
const VARIABLE = /\$\{[^}]*\}|\{[^}]*\}|:[A-Za-z_]\w*/g;

/** One canonical form for a route, so both sides of the same endpoint agree.
    Returns "" for anything that is not a usable absolute path. */
export function normalise(raw) {
  let p = String(raw || "").trim();
  if (!p.startsWith("/")) return "";              // relative or computed — skip
  p = p.split("?")[0].split("#")[0];
  p = p.replace(VARIABLE, "*");
  p = p.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return p || "/";
}

// fetch("/x"), axios.post("/x"), axios("/x"), new EventSource("/x"),
// request.get("/x"). The receiver is captured so a route definition using the
// same shape can be told apart — see SERVERS below.
const CALL = /\b(?:fetch|EventSource|WebSocket)\s*\(\s*[`'"]([^`'"]+)[`'"]|\b(?:axios|http|api|client|request)\s*(?:\.\s*(?:get|post|put|patch|delete|head)\s*)?\(\s*[`'"]([^`'"]+)[`'"]/g;

// Python decorators: @app.get("/x"), @router.post("/x"), @app.route("/x").
const PY_ROUTE = /@\s*\w+\s*\.\s*(?:get|post|put|patch|delete|head|route|websocket)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

// JS/Go servers: app.get("/x", handler), router.post(...), r.GET(...),
// mux.HandleFunc("/x", ...). The receiver must look like a server, which is
// what stops `axios.get("/x")` being read as a route definition.
const JS_ROUTE =
  /\b(?:app|router|api|server|r|mux|e|fastify|http)\s*\.\s*(?:get|post|put|patch|delete|head|all|use|route|GET|POST|PUT|PATCH|DELETE|HandleFunc|Handle)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

const collect = (re, text, into) => {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)) !== null; ) {
    const p = normalise(m[1] ?? m[2]);
    // "/" alone is a health check or an index page on nearly every server. It
    // matches far too much to be worth an edge.
    if (p && p !== "/") into.add(p);
  }
};

/** What this file calls, and what it serves. Either may be empty, and most
    files return both empty — this only fires on the handful of files at an
    HTTP boundary. */
export function httpRoutes(text) {
  const calls = new Set();
  const serves = new Set();
  collect(PY_ROUTE, text, serves);
  collect(JS_ROUTE, text, serves);
  collect(CALL, text, calls);
  // A file that both defines a route and calls it is a server calling itself,
  // which is not an edge worth drawing.
  for (const p of serves) calls.delete(p);
  return { calls: [...calls].sort(), serves: [...serves].sort() };
}

const IS_TEST = /(^|\/)(tests?|__tests__|spec)\//i.test.bind(/(^|\/)(tests?|__tests__|spec)\//i);
const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) || /_test\.go$/i.test(f) || IS_TEST(f);

/** Caller -> server links, for every path both sides agree on.
 *
 *  `routesByFile` is a Map of file -> { calls, serves }. A path served by
 *  several files links to all of them: that is genuinely ambiguous, and
 *  showing both is more honest than picking one.
 *
 *  The exception is a test file. A test that registers a route is standing in
 *  for the server, not being it, and drawing the browser as calling into a
 *  test file is worse than drawing nothing — measured on a real monorepo,
 *  where App.tsx appeared to call origin-validation.test.ts. So when a path
 *  has any non-test server, the test ones are dropped; when it has only test
 *  servers, they are kept, since a link to a stand-in still beats silence. */
export function httpLinks(routesByFile) {
  const servers = new Map();
  for (const [file, { serves }] of routesByFile) {
    for (const path of serves) {
      if (!servers.has(path)) servers.set(path, []);
      servers.get(path).push(file);
    }
  }

  for (const [path, files] of servers) {
    const real = files.filter((f) => !isTestFile(f));
    if (real.length && real.length < files.length) servers.set(path, real);
  }

  const links = [];
  for (const [file, { calls }] of routesByFile) {
    for (const path of calls) {
      for (const target of servers.get(path) || []) {
        if (target === file) continue;
        links.push({ from: file, to: target, kind: "http", names: [path] });
      }
    }
  }

  return links.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
    || a.names[0].localeCompare(b.names[0]));
}
