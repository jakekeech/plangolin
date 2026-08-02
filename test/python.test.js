import { test } from "node:test";
import assert from "node:assert/strict";
import { pyLinks } from "../src/imports/python.js";

const idx = (...p) => ({ paths: new Set(p) });

test("resolves a same-package relative import", () => {
  const i = idx("app/schema.py", "app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "from .schema import load", i), [
    { target: "app/schema.py", kind: "import" },
  ]);
});

test("resolves a relative import to a package __init__", () => {
  const i = idx("app/models/__init__.py", "app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "from .models import User", i), [
    { target: "app/models/__init__.py", kind: "import" },
  ]);
});

test("climbs a level for each extra dot", () => {
  const i = idx("app/db.py", "app/api/routes.py");
  assert.deepEqual(pyLinks("app/api/routes.py", "from ..db import conn", i), [
    { target: "app/db.py", kind: "import" },
  ]);
});

test("handles a bare relative import", () => {
  const i = idx("app/util.py", "app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "from . import util", i), [
    { target: "app/util.py", kind: "import" },
  ]);
});

test("resolves an absolute project import", () => {
  const i = idx("app/services/mail.py", "app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "import app.services.mail", i), [
    { target: "app/services/mail.py", kind: "import" },
  ]);
});

test("resolves from-import of a dotted module", () => {
  const i = idx("app/services/mail.py", "app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "from app.services.mail import send", i), [
    { target: "app/services/mail.py", kind: "import" },
  ]);
});

test("ignores stdlib and third-party imports", () => {
  const i = idx("app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "import os\nfrom django.db import models", i), []);
});

test("never links a file to itself", () => {
  const i = idx("app/views.py");
  assert.deepEqual(pyLinks("app/views.py", "from .views import x", i), []);
});

// The layout every FastAPI/Flask project ships: the app lives in a
// subdirectory and is run from inside it, so `from models import Job` in
// backend/main.py means backend/models.py. Resolving absolute imports only
// from the repo root missed every one of these — a real 9-file backend
// produced a single block with no edges at all.
test("resolves a flat sibling import from the file's own directory", () => {
  const i = idx("backend/models.py", "backend/main.py");
  assert.deepEqual(pyLinks("backend/main.py", "from models import Job", i), [
    { target: "backend/models.py", kind: "import" },
  ]);
});

test("resolves a bare `import sibling` from the file's own directory", () => {
  const i = idx("backend/scorer.py", "backend/main.py");
  assert.deepEqual(pyLinks("backend/main.py", "import scorer", i), [
    { target: "backend/scorer.py", kind: "import" },
  ]);
});

test("prefers the project root over the file's own directory", () => {
  const i = idx("models.py", "backend/models.py", "backend/main.py");
  assert.deepEqual(pyLinks("backend/main.py", "from models import Job", i), [
    { target: "models.py", kind: "import" },
  ]);
});

test("finds a sibling package __init__ from the file's own directory", () => {
  const i = idx("backend/store/__init__.py", "backend/main.py");
  assert.deepEqual(pyLinks("backend/main.py", "from store import db", i), [
    { target: "backend/store/__init__.py", kind: "import" },
  ]);
});
