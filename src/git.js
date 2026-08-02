// The second seam to the outside world, after workspace.js. Nothing else in
// the codebase may spawn a process — so a future Tauri or browser build
// replaces this one file rather than hunting execFile calls across src/.
//
// Every path this returns is relative to the *workspace* root, not the repo
// root. `--relative` makes git do that conversion itself, so plangolin run
// inside a subdirectory of a monorepo lines up with filegraph.js without any
// prefix arithmetic here — and prefix arithmetic is exactly the kind of thing
// that is silently wrong for a year.
//
// -z rather than plain --name-only because git quotes paths containing
// spaces or non-ASCII by default, and a quoted path never matches a path
// from filegraph.js. NUL separation sidesteps the quoting entirely.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// A repo of any size produces a lot of path text. 32MB is far past anything
// real, and the failure it prevents is a truncated list, which would read as
// "those files didn't change" — the worst possible way to be wrong here.
const MAX_BUFFER = 32 * 1024 * 1024;
const HUMAN_PATCH_LIMIT = 64 * 1024;

async function execGit(args) {
  const { stdout } = await exec("git", args, {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
}

/** Sorted and deduplicated, like every other list that feeds a delta. */
function splitZ(out) {
  return [...new Set(out.split("\0"))].filter(Boolean).sort();
}

function firstUtf8Bytes(text, limit) {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return { text, truncated: false };
  // A byte budget must not turn a path or source character at the boundary
  // into the replacement glyph, which would make the displayed patch lie.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = limit;
  while (end > limit - 4) {
    try {
      return { text: decoder.decode(bytes.subarray(0, end)), truncated: true };
    } catch {
      end--;
    }
  }
  return { text: "", truncated: true };
}

export function makeGit(root, run = execGit) {
  const git = (args) => run(["-C", root, ...args]);

  return {
    async isRepo() {
      try {
        await git(["rev-parse", "--git-dir"]);
        return true;
      } catch {
        return false;
      }
    },

    /** Paths that differ between `from` and `to`. A null `to` means the
        working tree, so uncommitted edits are included. */
    async changedFiles(from, to = null) {
      const args = ["diff", "--name-only", "--relative", "-z", from];
      if (to) args.push(to);
      return splitZ(await git(args));
    },

    /** What actually changed in one file, as a unified diff.
     *
     *  The first N characters of a file are almost never the change. app.css
     *  opens with an embedded base64 font, so a head-of-file excerpt asked
     *  the model to name a change it could not see and got back "Atkinson
     *  Hyperlegible interface font" for a commit about diff rendering. Most
     *  source files open with imports and a licence header, which is the same
     *  failure in a quieter form.
     *
     *  The compact model excerpt keeps only one context line; the opt-in
     *  human view needs three so a hunk is readable without opening an editor.
     *  An untracked file has nothing to diff against, so /dev/null stands in
     *  and the whole file reads as added — which is true. */
    async patch(from, file, options = 1200) {
      const human = options && typeof options === "object" && options.human === true;
      const context = human ? "-U3" : "-U1";
      const args = ["diff", "--no-color", context];
      if (from) args.push(from);
      if (human && options.to) args.push(options.to);
      const addedFile = () => git(["diff", "--no-color", context, "--no-index", "/dev/null", file]).catch(() => "");
      let out = await git([...args, "--", file]).catch(addedFile);
      // git exits successfully with no output for an untracked file. Only the
      // human view retries that silence: changing compact excerpts could make
      // name-change read whole files where it previously read nothing.
      if (human && !out) out = await addedFile();
      // Drop the ---/+++/index preamble: the caller already knows the path,
      // and four lines of it per file is a quarter of a small budget.
      const body = out.split("\n").filter((l) => !/^(diff |index |--- |\+\+\+ )/.test(l)).join("\n");
      if (!human) return body.slice(0, options);
      const limited = firstUtf8Bytes(body, HUMAN_PATCH_LIMIT);
      return { patch: limited.text, truncated: limited.truncated };
    },

    /** Files git isn't tracking yet. `git diff` never lists these, and an
        agent that writes a new file almost never stages it — so leaving them
        out makes the most common AI change the one change we cannot see. A
        new file inside a block's folder is owned by that block already, which
        means file-added won't catch it either: without this it is silent.

        --exclude-standard so .gitignore is honoured; no --full-name so paths
        come back relative to `root`, matching --relative on diff above. */
    async untracked() {
      return splitZ(await git(["ls-files", "--others", "--exclude-standard", "-z"]));
    },

    async commits(limit = 40) {
      const out = await git(["log", "-n" + limit, "--format=%H%x1f%s%x1f%cr"]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, subject, when] = line.split("\x1f");
          return { hash, subject, when };
        });
    },

    /** Local branches, the one you are on first. Sorted by most recent commit
        after that, because a branch list ordered alphabetically buries the one
        you were just working on. */
    async branches() {
      // %x1f is a `git log` code — `git branch --format` prints it literally,
      // which is the kind of thing a fake runner replaying canned output will
      // happily agree with. A literal separator that cannot appear in a
      // branch name works in both.
      const out = await git([
        "branch", "--sort=-committerdate", "--format=%(HEAD)|%(refname:short)",
      ]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const cut = line.indexOf("|");
          return { name: line.slice(cut + 1).trim(), current: line.slice(0, cut).trim() === "*" };
        })
        .filter((b) => b.name)
        .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
    },

    /* Where this branch left the trunk. `main..HEAD` is the work in flight,
       which is what someone means by "what have I changed" far more often
       than anything measured from a commit. */
    async mergeBase(trunk) {
      try {
        return (await git(["merge-base", "HEAD", trunk])).trim() || null;
      } catch {
        return null;                    // no such branch here
      }
    },

    /** The branch this one tracks, if any — the answer for "what has not
        left this machine yet" when you are working straight on the trunk. */
    async upstream() {
      try {
        return (await git(["rev-parse", "--abbrev-ref", "@{upstream}"])).trim() || null;
      } catch {
        return null;
      }
    },

    async head() {
      return (await git(["rev-parse", "HEAD"])).trim();
    },
  };
}
