// Which changed blocks belong to the same change.
//
// A large AI change is usually several changes wearing one commit. Barnett et
// al. found 42% of Microsoft changesets held multiple independent partitions,
// and a controlled experiment later showed reviewers given the decomposed
// version reported a third as many false positives and three times as many
// improvements. Splitting is the single most validated thing you can do to a
// changeset, and nothing ships it.
//
// The rule here is the graph's version of theirs: blocks that changed *and*
// refer to each other were almost certainly changed for one reason. Blocks
// that changed with nothing between them are separate work that happens to
// share a commit.
//
// Deliberately only counting lines where BOTH ends moved. Joining through an
// unchanged block would drag every change in the project into one group the
// moment they all touch some shared hub — which is exactly the failure that
// makes decomposition worthless, and every real system has such a hub.
//
// Naming a group is a separate, paid step. This part is free, deterministic,
// and useful on its own: "six blocks, in two unrelated changes" already tells
// you the thing the commit message didn't.

/** Connected components over the changed blocks alone.
 *
 *  @param {string[]} changed  block ids that moved
 *  @param {{from:string,to:string}[]} edges  block-to-block links
 *  @returns {{blocks:string[], n:number}[]}  sorted, so two runs agree
 */
export function groupChanges(changed, edges) {
  const moved = new Set(changed);
  if (!moved.size) return [];

  const near = new Map([...moved].map((id) => [id, []]));
  for (const { from, to } of edges || []) {
    if (!moved.has(from) || !moved.has(to) || from === to) continue;
    near.get(from).push(to);
    near.get(to).push(from);
  }

  const seen = new Set();
  const groups = [];
  // Sorted walk, sorted output: the same change must never come back as two
  // differently-ordered answers, or the strip reshuffles on every sync.
  for (const start of [...moved].sort()) {
    if (seen.has(start)) continue;
    const blocks = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift();
      blocks.push(id);
      for (const next of near.get(id)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    blocks.sort();
    groups.push({ blocks, n: blocks.length });
  }

  groups.sort((a, b) => b.n - a.n || a.blocks[0].localeCompare(b.blocks[0]));
  return groups;
}
