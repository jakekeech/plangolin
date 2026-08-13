// The accepted brief is deterministic: it translates validated impacts and
// the user's impact-key decisions into instructions for the implementation
// worker. It deliberately makes no further judgement about scope.

import { trim } from "./describe.js";

const CITE_CHARS = 80;

const list = (value) => Array.isArray(value) ? value : [];

// Transitional compatibility for the pre-Task-7 store. New callers must use
// buildBrief() and trusted impact keys; Task 7 removes this adapter once the
// producer has switched from delta categories to impacts.
export function buildLegacyDeltaBrief({ nodes, steps, delta, reach = [], accepted, truncated = false }) {
  const names = new Map((nodes || []).map((node) => [node.id, node.name || node.id]));
  const d = {
    additions: delta.additions || [], touches: delta.touches || [],
    connections: delta.connections || [], unplaced: delta.unplaced || [],
  };
  const key = (kind, a, b) => kind === "edge" ? `edge:${a}>${b}` : `${kind}:${a}`;
  const ok = (kind, a, b) => accepted.has(key(kind, a, b));
  for (const addition of d.additions) names.set(addition.id, addition.name || addition.id);
  const nameOf = (id) => names.get(id) || id;
  const stepText = new Map((steps || []).map((step) => [step.n, step.text]));
  const cite = (numbers) => numbers.map((number) => {
    const text = trim(stepText.get(number) || "", CITE_CHARS);
    return text ? `from the plan: "${text}"` : `from plan step ${number}`;
  });
  const out = ["## Reviewed in plangolin", ""];

  const build = d.additions.filter((addition) => ok("add", addition.id));
  const refused = new Set(d.additions.filter((addition) => !ok("add", addition.id)).map((addition) => addition.id));
  const edges = d.connections.filter((connection) =>
    ok("edge", connection.from, connection.to) && !refused.has(connection.from) && !refused.has(connection.to));
  if (build.length || edges.length) {
    out.push("BUILD");
    for (const addition of build) {
      out.push(`  ${addition.name} — ${addition.intent}`);
      if (addition.dir) out.push(`    lives in: ${addition.dir}`);
      if (addition.files && addition.files.length) {
        out.push("    files:");
        for (const file of addition.files) out.push(`      ${file}`);
      }
      for (const edge of edges.filter((connection) => connection.from === addition.id || connection.to === addition.id)) {
        out.push(`    ${nameOf(edge.from)} ──▶ ${nameOf(edge.to)} (${edge.label})`);
      }
      for (const line of cite(addition.steps || [])) out.push(`    ${line}`);
      out.push("");
    }
    const loose = edges.filter((edge) => !build.some((addition) => addition.id === edge.from || addition.id === edge.to));
    for (const edge of loose) {
      out.push(`  ${nameOf(edge.from)} ──▶ ${nameOf(edge.to)} (${edge.label})`);
      for (const line of cite(edge.steps || [])) out.push(`    ${line}`);
      out.push("");
    }
  }

  const update = d.touches.filter((touch) => ok("touch", touch.id));
  if (update.length) {
    out.push("UPDATE");
    for (const touch of update) {
      out.push(`  ${nameOf(touch.id)} — ${touch.why}`);
      for (const user of reach.filter((entry) => entry.via === touch.id)) {
        out.push(`    Used by ${nameOf(user.id)} (${user.label})`);
      }
      for (const line of cite(touch.steps || [])) out.push(`    ${line}`);
    }
    out.push("");
  }

  const cut = [
    ...d.additions.filter((addition) => !ok("add", addition.id)).map((addition) => `${addition.name} — ${addition.intent}`),
    ...d.touches.filter((touch) => !ok("touch", touch.id)).map((touch) => `${nameOf(touch.id)} — ${touch.why}`),
    ...d.connections.filter((connection) => !edges.includes(connection))
      .map((connection) => `${nameOf(connection.from)} ──▶ ${nameOf(connection.to)} (${connection.label})`),
  ];
  if (cut.length) {
    out.push("OUT OF SCOPE — the user removed these. Do not build them.");
    for (const line of cut) out.push(`  ✗ ${line}`);
    out.push("");
  }

  const involved = new Set([
    ...build.map((addition) => addition.id), ...update.map((touch) => touch.id),
    ...edges.flatMap((connection) => [connection.from, connection.to]),
  ]);
  const untouched = (nodes || []).filter((node) => !involved.has(node.id)).map((node) => node.name || node.id);
  if (untouched.length) out.push("DO NOT TOUCH", `  ${untouched.join(", ")}`, "");

  const kept = new Set(d.unplaced.flatMap((unplaced) => unplaced.steps)).size;
  if (kept) {
    out.push(kept === 1
      ? "1 plan step changes nothing about the shape of the system — build it as written."
      : `${kept} plan steps change nothing about the shape of the system — build them as written.`);
  }

  if (!build.length && !edges.length && !update.length) {
    out.push("", "The user reviewed this plan and approved no change to the shape of the system. " +
      "Build it as written, and add no blocks or connections beyond what is already there.");
  }

  if (truncated && (steps || []).length) {
    out.push("", `Only the first ${steps.length} steps of this plan were reviewed in plangolin. ` +
      "Nothing above rules on what comes after them.");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function buildBrief({ nodes = [], steps = [], impacts, reach = [], accepted, truncated = false }) {
  if (!Array.isArray(impacts)) throw new TypeError("impacts must be an array");
  if (!(accepted instanceof Set)) throw new TypeError("accepted must be a Set");

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

  const grouped = (level, projectFallback = false) => {
    const groups = new Map();
    for (const impact of kept.filter((entry) => entry.level === level)) {
      const target = impact.targetId ? nameOf(impact.targetId) : projectFallback ? "Project Support" : "Needs placement";
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

  const supporting = grouped("support", true);
  if (supporting.size) {
    out.push("SUPPORTING WORK");
    for (const [target, group] of supporting) {
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

  const unresolved = kept.filter((impact) => impact.level === "unresolved");
  if (unresolved.length) {
    out.push("NEEDS REVIEW", "  Confirm the intended component before inferring missing scope.");
    for (const impact of unresolved) {
      out.push(`  ${describe(impact)}`);
      pushCitations(impact, "    ");
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
