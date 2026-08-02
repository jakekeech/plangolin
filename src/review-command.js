// `plangolin review <file>` — the CLI half of the skill.
//
// Claude runs this as a Bash call and reads what it prints, so STDOUT IS THE
// CONTRACT: the brief and nothing else. Every progress line goes to stderr,
// where the person watching the terminal sees it and the model does not have
// to read past it to find the answer.
//
// It owns its server rather than attaching to a running one. The command has a
// beginning and an end, and a review that outlived the command — or a command
// that depended on a server somebody started for another reason — would need
// discovery, liveness checks and a story about two reviews at once. One
// process, one review, one lifetime.

import { spawn } from "node:child_process";
import { loadEnv } from "./env.js";
import { nodeWorkspace } from "./workspace.js";
import { createServer } from "./server.js";
import { createPlanStore } from "./plan-store.js";

const TEN_MINUTES = 10 * 60 * 1000;

const note = (line) => process.stderr.write(line + "\n");

export function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => note(`plangolin: couldn't open a browser — open ${url} yourself`))
    .unref();
}

export async function runReview(root, planText, { open = openBrowser, timeout = TEN_MINUTES } = {}) {
  const plan = String(planText || "").trim();
  if (!plan) {
    note("plangolin: that plan file is empty — nothing to review.");
    return { code: 1, brief: "" };
  }

  loadEnv(root);
  const ws = nodeWorkspace(root);
  const plans = createPlanStore();
  const server = createServer(ws, plans);

  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const url = `http://localhost:${server.address().port}`;

  const { id } = plans.open({ plan });
  note("");
  note(`  plangolin   ${url}`);
  note("  Reading this plan against your sheet…");
  note("");
  open(url);

  // Kicked off, not awaited: the browser polls for the delta and shows what it
  // has meanwhile, so the wait below is the user's, not the model's.
  plans.fill(ws);

  const out = await plans.wait(id, timeout);
  await new Promise((r) => server.close(r));

  if (out.status === "resolved" && out.brief) {
    note("  Approved.");
    return { code: 0, brief: out.brief };
  }

  /* Never a dead end, and never a silent one. Both of these are printed on
     stdout because they are the answer to the question Claude asked, and
     Claude has to be told that no scope was agreed rather than left to infer
     it from an empty string. */
  return {
    code: 0,
    brief: out.status === "skipped"
      ? "The user skipped the plangolin review. Proceed with the plan as written.\n"
      : "The plan was not reviewed in time. Proceed with the plan as written.\n",
  };
}
