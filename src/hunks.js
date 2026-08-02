import { makeGit } from "./git.js";

export async function readHunks(ws, file, baseline, git = makeGit(ws.root)) {
  // Validation belongs to the workspace even though git receives the relative
  // path; keeping one containment check prevents routes and disk I/O drifting.
  ws.abs(file);

  if (!baseline || !baseline.ref) {
    return {
      patch: "", truncated: false,
      reason: "There is no Git comparison available for this file.",
    };
  }

  let out;
  if (baseline.kind === "commit" && !baseline.rootCommit) {
    out = await git.patch(baseline.ref + "^", file, { human: true, to: baseline.ref });
  } else {
    out = await git.patch(baseline.ref, file, { human: true });
  }

  if (out.patch) return out;
  return { ...out, reason: "There are no text hunks for this file." };
}
