// The accepted brief is deterministic: it translates validated impacts and
// the user's impact-key decisions into instructions for the implementation
// worker. It deliberately makes no further judgement about scope.

import { trim } from "./describe.js";

const CITE_CHARS = 80;

const list = (value) => Array.isArray(value) ? value : [];

const completeInputs = (steps, impacts, unmappedSteps) => {
  if (!steps.length) return false;
  if (impacts.some((impact) => !impact ||
    (impact.level !== "system" && impact.level !== "component"))) return false;
  const claims = new Map();
  for (const step of steps) {
    if (!step || claims.has(step.n)) return false;
    claims.set(step.n, 0);
  }
  for (const impact of impacts) {
    for (const stepNumber of list(impact.steps)) {
      if (!claims.has(stepNumber) || claims.get(stepNumber) !== 0) return false;
      claims.set(stepNumber, 1);
    }
  }
  for (const stepNumber of unmappedSteps) {
    if (!claims.has(stepNumber) || claims.get(stepNumber) !== 0) return false;
    claims.set(stepNumber, 1);
  }
  return [...claims.values()].every((count) => count === 1);
};

export function buildBrief({
  nodes = [], steps = [], impacts, unmappedSteps = [], reach = [], accepted, truncated = false,
}) {
  if (!Array.isArray(impacts)) throw new TypeError("impacts must be an array");
  if (!(accepted instanceof Set)) throw new TypeError("accepted must be a Set");
  if (!completeInputs(list(steps), impacts, list(unmappedSteps))) {
    throw new TypeError("buildBrief requires a complete visible review");
  }

  const names = new Map(list(nodes).map((node) => [node.id, node.name || node.id]));
  for (const impact of impacts) {
    for (const addition of list(impact.additions)) names.set(addition.id, addition.name || addition.id);
  }
  const nameOf = (id) => names.get(id) || id;
  const stepText = new Map(list(steps).map((step) => [step.n, step.text]));
  const citations = (impact) => list(impact.steps).map((step) => {
    const text = trim(stepText.get(step) || "", CITE_CHARS);
    return text ? `from the plan: "${text}"` : `from plan step ${step}`;
  });
  const describe = (impact) => impact.why ? `${impact.title} — ${impact.why}` : impact.title;
  const out = ["## Reviewed in plangolin", ""];
  const kept = impacts.filter((impact) => accepted.has(impact.key));
  const cut = impacts.filter((impact) => !accepted.has(impact.key));
  const pushCitations = (impact, indent = "    ") => {
    for (const line of citations(impact)) out.push(`${indent}${line}`);
  };

  const builds = kept.filter((impact) => list(impact.additions).length || list(impact.connections).length);
  if (builds.length) {
    out.push("BUILD");
    for (const impact of builds) {
      for (const addition of list(impact.additions)) {
        out.push(`  ${addition.name || addition.id} — ${addition.intent || ""}`.trimEnd());
        if (addition.dir) out.push(`    lives in: ${addition.dir}`);
        if (list(addition.files).length) {
          out.push("    files:");
          for (const file of addition.files) out.push(`      ${file}`);
        }
      }
      for (const connection of list(impact.connections)) {
        out.push(`  ${nameOf(connection.from)} ──▶ ${nameOf(connection.to)} (${connection.label || "connects"})`);
      }
      pushCitations(impact);
      out.push("");
    }
  }

  const removals = kept.filter((impact) => list(impact.removals).length || list(impact.disconnections).length);
  if (removals.length) {
    out.push("REMOVE");
    for (const impact of removals) {
      for (const removal of list(impact.removals)) out.push(`  Remove ${nameOf(removal.id)}.`);
      for (const disconnection of list(impact.disconnections)) {
        out.push(`  Disconnect ${nameOf(disconnection.from)} ──▶ ${nameOf(disconnection.to)}.`);
      }
      pushCitations(impact);
      out.push("");
    }
  }

  const responsibilities = kept.filter((impact) => list(impact.responsibilities).length);
  if (responsibilities.length) {
    out.push("UPDATE RESPONSIBILITY");
    for (const impact of responsibilities) {
      for (const responsibility of list(impact.responsibilities)) {
        const why = responsibility.why ? ` ${responsibility.why}` : "";
        out.push(`  ${nameOf(responsibility.id)} — ${responsibility.intent}${why}`);
        for (const user of list(reach).filter((entry) => entry.via === responsibility.id)) {
          out.push(`    Used by ${nameOf(user.id)} (${user.label})`);
        }
      }
      pushCitations(impact);
      out.push("");
    }
  }

  const grouped = (level) => {
    const groups = new Map();
    for (const impact of kept.filter((entry) => entry.level === level)) {
      const target = impact.targetId ? nameOf(impact.targetId) : "System";
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(impact);
    }
    return groups;
  };

  const internal = grouped("component");
  if (internal.size) {
    out.push("INTERNAL WORK");
    for (const [target, group] of internal) {
      out.push(`  ${target}`);
      for (const impact of group) {
        out.push(`    ${describe(impact)}`);
        pushCitations(impact, "      ");
      }
    }
    out.push("");
  }

  if (cut.length) {
    out.push("OUT OF SCOPE", "  The user removed these. Do not build them.");
    for (const impact of cut) {
      out.push(`  ✗ ${describe(impact)}`);
      pushCitations(impact, "    ");
    }
    out.push("");
  }

  if (list(unmappedSteps).length) {
    out.push(
      "NOT REPRESENTED ON MAP",
      "  These plan steps were not accepted or rejected in Plangolin. Review them directly.",
    );
    for (const step of list(unmappedSteps)) {
      const text = trim(stepText.get(step) || "", CITE_CHARS);
      out.push(`  ? ${text || `Plan step ${step}`}`);
    }
    out.push("");
  }

  const involved = new Set();
  for (const impact of kept) {
    if (impact.level === "system" && impact.targetId) involved.add(impact.targetId);
    if (impact.level === "component" && impact.targetId) involved.add(impact.targetId);
    for (const addition of list(impact.additions)) involved.add(addition.id);
    for (const removal of list(impact.removals)) involved.add(removal.id);
    for (const responsibility of list(impact.responsibilities)) involved.add(responsibility.id);
    for (const connection of list(impact.connections)) {
      involved.add(connection.from);
      involved.add(connection.to);
    }
    for (const disconnection of list(impact.disconnections)) {
      involved.add(disconnection.from);
      involved.add(disconnection.to);
    }
  }
  const untouched = list(nodes).filter((node) => !involved.has(node.id)).map((node) => node.name || node.id);
  if (untouched.length) out.push("DO NOT TOUCH", `  ${untouched.join(", ")}`, "");

  if (truncated && list(steps).length) {
    out.push(`Only the first ${steps.length} steps of this plan were reviewed in plangolin. ` +
      "Nothing above rules on what comes after them.");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
