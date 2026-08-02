import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule, goLinks } from "../src/imports/go.js";

test("reads the module name from go.mod", () => {
  assert.equal(parseModule("module github.com/me/app\n\ngo 1.22\n"), "github.com/me/app");
  assert.equal(parseModule("go 1.22\n"), null);
});

test("resolves a single import to every file in the package directory", () => {
  const index = {
    paths: new Set(["internal/db/conn.go", "internal/db/query.go", "main.go"]),
    goModule: "github.com/me/app",
  };
  const text = `import "github.com/me/app/internal/db"`;
  assert.deepEqual(goLinks("main.go", text, index), [
    { target: "internal/db/conn.go", kind: "import" },
    { target: "internal/db/query.go", kind: "import" },
  ]);
});

test("resolves a grouped import block", () => {
  const index = {
    paths: new Set(["internal/db/conn.go", "internal/api/http.go", "main.go"]),
    goModule: "github.com/me/app",
  };
  const text = `import (\n\t"fmt"\n\t"github.com/me/app/internal/db"\n\t"github.com/me/app/internal/api"\n)`;
  assert.deepEqual(goLinks("main.go", text, index).map((l) => l.target).sort(), [
    "internal/api/http.go", "internal/db/conn.go",
  ]);
});

test("ignores stdlib and external packages", () => {
  const index = { paths: new Set(["main.go"]), goModule: "github.com/me/app" };
  assert.deepEqual(goLinks("main.go", `import (\n"fmt"\n"github.com/other/lib"\n)`, index), []);
});

test("returns nothing when go.mod is absent", () => {
  const index = { paths: new Set(["internal/db/conn.go", "main.go"]), goModule: null };
  assert.deepEqual(goLinks("main.go", `import "anything/internal/db"`, index), []);
});

test("never links a file to itself", () => {
  const index = { paths: new Set(["internal/db/conn.go"]), goModule: "m" };
  assert.deepEqual(goLinks("internal/db/conn.go", `import "m/internal/db"`, index), []);
});
