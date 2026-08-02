// The floor: finds references without knowing any language's syntax.
//
// We already know every file in the project, so instead of parsing imports
// we look for other files' names in the text. Nearly every language puts a
// module's name in its import line — "alias App.Workspace", "use
// crate::workspace", "require_relative 'sync'" — so matching against real
// filenames finds edges in a language nobody wrote a reader for.
//
// It guesses, and the guess is recorded as kind "name" so sync.js never
// reports a divergence against a line this produced.

import { STOPLIST, familyOf } from "./stoplist.js";

const MIN_NAME = 4;
const WORD = /[A-Za-z_][A-Za-z0-9_-]*/g;

export function genericLinks(fromPath, text, index) {
  const fromFamily = familyOf(fromPath);
  const links = [];
  const seen = new Set();

  // Tokenise once and look each token up, rather than searching the text
  // once per candidate file — the latter is quadratic in repo size.
  const words = new Set();
  WORD.lastIndex = 0;
  for (let m; (m = WORD.exec(text)) !== null; ) words.add(m[0].toLowerCase());

  for (const word of words) {
    if (word.length < MIN_NAME || STOPLIST.has(word)) continue;
    const targets = index.byName.get(word);
    if (!targets) continue;

    for (const target of targets) {
      if (target === fromPath || seen.has(target)) continue;
      const toFamily = familyOf(target);
      if (fromFamily && toFamily && fromFamily !== toFamily) continue;
      seen.add(target);
      links.push({ target, kind: "name" });
    }
  }
  return links.sort((a, b) => a.target.localeCompare(b.target));
}
