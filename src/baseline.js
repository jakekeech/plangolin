// What state of the sheet you are looking at.
//
// The graph always draws the code as it is now. What this chooses is what the
// marks are measured against — three answers, in the order someone actually
// wants them:
//
//   branch       the work in flight. On a feature branch that is everything
//                since it left the trunk; on the trunk itself it is what has
//                not been pushed. Either way: "what has happened here that
//                is not yet everyone's".
//   uncommitted  the working tree alone.
//   commit       what ONE commit did. Not what has happened since it —
//                picking a commit anywhere else in software means that
//                commit's own change, and the count beside it in the list
//                says the same, so anything else makes the list a liar.
//
// Every failure is a fallback, never an error. A project with no git, a
// deleted branch, a rebased ref: the sheet has to keep working, and the
// answer says which comparison actually ran so nothing downstream claims to
// be showing something it is not.

export const DEFAULT_BASELINE = { kind: "branch" };

// What a branch is measured against, first one that exists. No config: a repo
// that calls its trunk something else falls back to its upstream, which is
// the same question asked a different way.
const TRUNKS = ["main", "master", "trunk", "develop"];

/** Everything that differs between `ref` and what is on disk right now.
 *
 *  The union with untracked files is the whole reason this helper exists.
 *  `git diff` reports modifications to files git already knows about, and an
 *  agent's most common act is creating a file it never stages. Such a file
 *  lands inside a block's folder, so the block already owns it and file-added
 *  stays quiet too — meaning without this union the single most common AI
 *  change produces no mark anywhere on the sheet. */
async function againstWorkingTree(git, ref) {
  const [changed, added] = await Promise.all([git.changedFiles(ref), git.untracked()]);
  return new Set([...changed, ...added]);
}

/** Where the current branch's work begins, and what to call it. */
async function branchPoint(git) {
  for (const trunk of TRUNKS) {
    const base = await git.mergeBase(trunk);
    // A merge-base equal to HEAD means we are *on* the trunk (or behind it),
    // so there is no branch work to show and the question becomes "what have
    // I not pushed" instead.
    if (base && base !== (await git.head())) return { ref: base, against: trunk };
  }
  const up = await git.upstream();
  if (up) {
    const base = await git.mergeBase(up);
    if (base) return { ref: base, against: up };
  }
  return null;
}

export async function resolveBaseline(git, spec = DEFAULT_BASELINE) {
  if (!(await git.isRepo())) return null;

  const kind = (spec && spec.kind) || DEFAULT_BASELINE.kind;

  if (kind === "uncommitted") {
    return { kind, ref: "HEAD", files: await againstWorkingTree(git, "HEAD") };
  }

  if (kind === "branch") {
    const point = await branchPoint(git);
    if (point) {
      return {
        kind, ref: point.ref, against: point.against,
        files: await againstWorkingTree(git, point.ref),
      };
    }
    // On the trunk, up to date, nothing pushed anywhere: uncommitted work is
    // all there is, and saying so beats an empty answer.
    return {
      kind: "uncommitted", ref: "HEAD", fellBack: true,
      files: await againstWorkingTree(git, "HEAD"),
    };
  }

  /* One commit's own change. `hash^..hash`, so the marks match the count the
     picker showed beside it — the two disagreeing is worse than either being
     wrong, because the list is what you chose from. The first commit in a
     repo has no parent and falls back to being compared with nothing. */
  if (kind === "commit") {
    if (!spec || !spec.ref) return null;
    try {
      return {
        kind, ref: spec.ref,
        files: new Set(await git.changedFiles(spec.ref + "^", spec.ref)),
      };
    } catch {
      return {
        kind, ref: spec.ref, rootCommit: true,
        files: new Set(await git.changedFiles(spec.ref)),
      };
    }
  }

  return null;
}
