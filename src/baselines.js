// What you can compare against, and — for commits — how much each one moved.
//
// The block count is the reason this exists rather than the app just calling
// git. A commit list with no model behind it can only tell you a commit
// happened; this one can say it touched no architecture at all, so the picker
// is already a significance filter before you have chosen anything. Fluri &
// Gall's point in list form: lines changed is a bad proxy, and "1,412 lines,
// nothing moved" is the useful sentence.
//
// Counting is one cheap git call per commit — no file reading, no model — so
// the list is capped rather than lazy. Ten is about what fits before a menu
// stops being scannable anyway.

import { expandAnchor } from "./schema.js";

export const COMMITS_SHOWN = 10;

/** How many blocks a single commit moved, by intersecting its changed files
    with what each block owns. */
function blocksTouched(nodes, files, changed) {
  let n = 0;
  for (const node of nodes) {
    if (expandAnchor(node, files).some((f) => changed.has(f))) n++;
  }
  return n;
}

export async function listBaselines(git, nodes, files) {
  if (!(await git.isRepo())) return { repo: false, commits: [], branches: [] };

  const [commits, branches] = await Promise.all([
    git.commits(COMMITS_SHOWN),
    git.branches(),
  ]);

  const counted = [];
  for (const c of commits) {
    let blocks = null;                 // null, not 0 — "we could not tell"
    try {
      /* What this commit did, not what has happened since it. Diffing the
         working tree against each commit makes every row report roughly the
         same cumulative number, which is true and useless — the point of the
         count is to spot the commit that moved nothing, and that only shows
         up per commit. The row still *selects* a window starting there; the
         number describes the commit itself. */
      blocks = blocksTouched(nodes, files, new Set(await git.changedFiles(c.hash + "^", c.hash)));
    } catch {
      /* The first commit in a repo has no parent, and a commit we cannot
         diff is still worth offering as somewhere to compare from. */
    }
    counted.push({ ...c, blocks });
  }

  return { repo: true, commits: counted, branches };
}
