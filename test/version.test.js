import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* Three files carry the version and all three are read by someone different:
   package.json by `npm install -g github:...`, plugin.json by an installed
   plugin deciding whether it is current, marketplace.json by `/plugin update`
   deciding whether to offer one. Nothing makes them agree, and twice now they
   have not — code shipped under a number that said it had not changed, so
   every installed copy stayed on the old one and the fix reached nobody.

   A mismatch is invisible in every other test: the code is correct, only the
   claim about which code it is is wrong. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

test("the three version strings agree", () => {
  const pkg = read("package.json").version;
  const plugin = read(".claude-plugin/plugin.json").version;
  const market = read(".claude-plugin/marketplace.json").plugins[0].version;

  assert.equal(
    plugin, pkg,
    `.claude-plugin/plugin.json says ${plugin}, package.json says ${pkg}`,
  );
  assert.equal(
    market, pkg,
    `.claude-plugin/marketplace.json says ${market}, package.json says ${pkg}`,
  );
});

test("the adaptive impact review release is 0.4.0", () => {
  assert.equal(read("package.json").version, "0.4.0");
});

test("the version is a plain three-part number", () => {
  // `/plugin update` compares these, so a suffix or a stray "v" is a version
  // that never looks newer than the one already installed.
  const v = read("package.json").version;
  assert.match(v, /^\d+\.\d+\.\d+$/, `version is ${JSON.stringify(v)}`);
});
