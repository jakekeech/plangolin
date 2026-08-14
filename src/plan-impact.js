// Trust boundary for adaptive plan review. The hosted reply is deliberately
// treated as untrusted: this module validates operations, repairs coverage,
// and is the only place that assigns review-local identities.

import { callTask } from "./llm.js";

const LEVELS = ["system", "component", "support", "unresolved"];
const LEVEL_RANK = new Map([["system", 0], ["component", 1]]);
const OPERATION_NAMES = [
  "additions", "removals", "responsibilities", "connections", "disconnections",
];

const MAX_TITLE = 80;
const MAX_NAME = 60;
const MAX_KIND = 40;
const MAX_INTENT = 200;
const MAX_WHY = 200;
const MAX_LABEL = 40;
const MAX_EVIDENCE = 6;

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const list = (value) => Array.isArray(value) ? value : [];

function counts() {
  return {
    categories: { system: 0, component: 0, support: 0, unresolved: 0 },
    operations: {
      additions: 0, removals: 0, responsibilities: 0, connections: 0, disconnections: 0,
    },
  };
}

function keptCounts() {
  return {
    categories: { system: 0, component: 0 },
    operations: {
      additions: 0, removals: 0, responsibilities: 0, connections: 0, disconnections: 0,
    },
  };
}

function countRaw(rawImpacts) {
  const result = counts();
  for (const raw of rawImpacts) {
    if (!isObject(raw)) continue;
    if (Object.hasOwn(result.categories, raw.level)) result.categories[raw.level]++;
    for (const name of OPERATION_NAMES) result.operations[name] += list(raw[name]).length;
  }
  return result;
}

function countKept(impacts) {
  const result = keptCounts();
  for (const impact of impacts) {
    result.categories[impact.level]++;
    for (const name of OPERATION_NAMES) result.operations[name] += impact[name].length;
  }
  return result;
}

function cleanString(value, limit, diagnostics, field, { required = false, fallback = "" } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text && required) diagnostics.issues.push({ code: `blank_${field}`, field });
  if (text.length > limit) diagnostics.issues.push({ code: "oversized_string", field, limit });
  return text.slice(0, limit) || fallback;
}

function safePath(value) {
  if (typeof value !== "string") return "";
  const path = value.replace(/\\/g, "/").trim();
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "";
  const parts = path.split("/");
  if (parts.some((part) => part === "..")) return "";
  return parts.filter((part) => part && part !== ".").join("/");
}

function nodeOwnsFile(node, path) {
  const paths = list(node?.anchor?.paths).map(safePath).filter(Boolean);
  const dir = safePath(node?.anchor?.dir);
  return paths.includes(path) || Boolean(dir && (path === dir || path.startsWith(`${dir}/`)));
}

function deepestSingleOwner(nodes, files) {
  const safeFiles = [...new Set(list(files).map(safePath).filter(Boolean))];
  if (!safeFiles.length) return "";

  const parents = new Map(nodes.map((node) => [node.id, node.parent || ""]));
  const depth = (id) => {
    const seen = new Set([id]);
    let result = 0;
    for (let parent = parents.get(id); parent && !seen.has(parent); parent = parents.get(parent)) {
      seen.add(parent);
      result++;
    }
    return result;
  };
  const candidates = nodes.filter((node) =>
    typeof node?.id === "string" && safeFiles.every((file) => nodeOwnsFile(node, file)));
  if (!candidates.length) return "";
  const deepest = Math.max(...candidates.map((node) => depth(node.id)));
  const winners = candidates.filter((node) => depth(node.id) === deepest);
  return winners.length === 1 ? winners[0].id : "";
}

function literalInSteps(value, stepNumbers, stepText) {
  const normalize = (text) => text.replace(/\\/g, "/").toLowerCase();
  const wanted = normalize(value);
  return stepNumbers.some((n) => normalize(stepText.get(n) || "").includes(wanted));
}

function validateEvidence(raw, stepNumbers, stepText, diagnostics) {
  const files = [];
  const ownerFiles = [];
  for (const value of list(raw.files)) {
    const path = safePath(value);
    if (!path) {
      diagnostics.issues.push({ code: "unsafe_path", field: "files" });
      continue;
    }
    if (!literalInSteps(path, stepNumbers, stepText)) {
      diagnostics.issues.push({ code: "unsupported_evidence", field: "files" });
      continue;
    }
    if (!ownerFiles.includes(path)) {
      ownerFiles.push(path);
      if (files.length < MAX_EVIDENCE) files.push(path);
    }
  }

  const symbols = [];
  for (const value of list(raw.symbols)) {
    const symbol = typeof value === "string" ? value.trim() : "";
    if (!symbol || !literalInSteps(symbol, stepNumbers, stepText)) {
      diagnostics.issues.push({ code: "unsupported_evidence", field: "symbols" });
      continue;
    }
    if (symbols.length < MAX_EVIDENCE && !symbols.includes(symbol)) symbols.push(symbol);
  }
  return { files, ownerFiles, symbols };
}

function validateSteps(values, validSteps, diagnostics, sourceIndex) {
  const result = [];
  for (const value of list(values)) {
    if (!Number.isInteger(value) || !validSteps.has(value)) {
      const issue = { code: "invalid_step", sourceIndex };
      if (typeof value === "number" && Number.isFinite(value)) issue.step = value;
      else issue.stepType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      diagnostics.issues.push(issue);
      continue;
    }
    if (!result.includes(value)) result.push(value);
  }
  result.sort((a, b) => a - b);
  return result;
}

function validId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
}

function validateAllAdditions(rawImpacts, existingIds, validSteps, stepText, diagnostics) {
  const byImpact = new Map();
  const ids = new Set();

  rawImpacts.forEach((raw, sourceIndex) => {
    const additions = [];
    const citedSteps = [...new Set(list(raw?.steps).filter((step) => validSteps.has(step)))];
    for (const addition of list(raw?.additions)) {
      if (!isObject(addition) || !validId(addition.id) || existingIds.has(addition.id) || ids.has(addition.id)) {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_addition", sourceIndex });
        continue;
      }
      const name = cleanString(addition.name, MAX_NAME, diagnostics, "addition_name", { required: true });
      const intent = cleanString(addition.intent, MAX_INTENT, diagnostics, "addition_intent", { required: true });
      if (!name || !intent) {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_addition", sourceIndex });
        continue;
      }
      const files = [];
      for (const value of list(addition.files)) {
        const path = safePath(value);
        if (!path) diagnostics.issues.push({ code: "unsafe_path", field: "addition.files", sourceIndex });
        else if (!literalInSteps(path, citedSteps, stepText)) {
          diagnostics.issues.push({ code: "unsupported_evidence", field: "addition.files", sourceIndex });
        }
        else if (files.length < MAX_EVIDENCE && !files.includes(path)) files.push(path);
      }
      const rawDir = typeof addition.dir === "string" ? addition.dir.trim() : "";
      const dir = rawDir ? safePath(rawDir) : "";
      if (rawDir && !dir) diagnostics.issues.push({ code: "unsafe_path", field: "addition.dir", sourceIndex });
      ids.add(addition.id);
      additions.push({
        id: addition.id,
        name,
        kind: cleanString(addition.kind, MAX_KIND, diagnostics, "addition_kind"),
        intent,
        dir,
        files,
      });
    }
    byImpact.set(sourceIndex, additions);
  });
  return { ids, byImpact };
}

function validateCandidates(rawImpacts, context) {
  const {
    additions, existingIds, knownIds, existingEdges, validSteps, stepText, diagnostics, nodes,
    rejectedStepIds,
  } = context;

  return rawImpacts.map((rawValue, sourceIndex) => {
    const raw = isObject(rawValue) ? rawValue : {};
    const steps = validateSteps(raw.steps, validSteps, diagnostics, sourceIndex);
    const { ownerFiles, ...evidence } = validateEvidence(raw, steps, stepText, diagnostics);
    const originalLevel = raw.level;
    const targetIsString = typeof raw.targetId === "string";
    const rawTargetId = targetIsString ? raw.targetId : "";
    const ownerId = targetIsString ? deepestSingleOwner(nodes, ownerFiles) : "";
    let level = originalLevel;
    let targetId = rawTargetId;
    let invalidImpact = false;

    if (!LEVELS.includes(originalLevel)) {
      diagnostics.issues.push({ code: "invalid_level", sourceIndex });
      invalidImpact = true;
    } else if (!targetIsString) {
      diagnostics.issues.push({ code: "invalid_target", sourceIndex });
      invalidImpact = true;
    } else if (originalLevel === "system") {
      if (targetId) {
        diagnostics.issues.push({ code: "invalid_target", sourceIndex });
        invalidImpact = true;
      }
    } else if (originalLevel === "component") {
      if (!targetId && ownerId) targetId = ownerId;
      if (!targetId || !knownIds.has(targetId)) {
        diagnostics.issues.push({ code: "invalid_target", sourceIndex });
        invalidImpact = true;
      }
    } else if (originalLevel === "support" && targetId && knownIds.has(targetId)) {
      level = "component";
    } else if (ownerId) {
      level = "component";
      targetId = ownerId;
    } else {
      diagnostics.issues.push({ code: "invalid_placement", sourceIndex });
      invalidImpact = true;
    }

    const size = ["", "small", "substantial"].includes(raw.size) ? raw.size : "";
    if (size !== raw.size) {
      invalidImpact = true;
      diagnostics.issues.push({ code: "invalid_size", sourceIndex });
    }

    const title = cleanString(raw.title, MAX_TITLE, diagnostics, "title", {
      required: true, fallback: "Needs review",
    });
    if (title === "Needs review" && !(typeof raw.title === "string" && raw.title.trim())) invalidImpact = true;
    const why = cleanString(raw.why, MAX_WHY, diagnostics, "why");

    if (OPERATION_NAMES.some((name) => !Array.isArray(raw[name]))) {
      diagnostics.invalidOperations++;
      diagnostics.issues.push({ code: "invalid_operations_shape", sourceIndex });
      invalidImpact = true;
    }

    const operations = {
      additions: additions.byImpact.get(sourceIndex) || [],
      removals: [], responsibilities: [], connections: [], disconnections: [],
    };

    for (const removal of list(raw.removals)) {
      if (isObject(removal) && existingIds.has(removal.id)) operations.removals.push({ id: removal.id });
      else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_removal", sourceIndex });
      }
    }
    for (const responsibility of list(raw.responsibilities)) {
      const intent = cleanString(responsibility?.intent, MAX_INTENT, diagnostics, "responsibility_intent");
      const operationWhy = cleanString(responsibility?.why, MAX_WHY, diagnostics, "responsibility_why");
      if (isObject(responsibility) && existingIds.has(responsibility.id) && intent) {
        operations.responsibilities.push({ id: responsibility.id, intent, why: operationWhy });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_responsibility", sourceIndex });
      }
    }
    for (const connection of list(raw.connections)) {
      const from = connection?.from;
      const to = connection?.to;
      if (isObject(connection) && knownIds.has(from) && knownIds.has(to) && from !== to &&
          !existingEdges.has(`${from}\0${to}`)) {
        operations.connections.push({
          from, to,
          label: cleanString(connection.label, MAX_LABEL, diagnostics, "connection_label"),
        });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_connection", sourceIndex });
      }
    }
    for (const disconnection of list(raw.disconnections)) {
      const from = disconnection?.from;
      const to = disconnection?.to;
      if (isObject(disconnection) && existingEdges.has(`${from}\0${to}`)) {
        operations.disconnections.push({ from, to });
      } else {
        diagnostics.invalidOperations++;
        diagnostics.issues.push({ code: "invalid_disconnection", sourceIndex });
      }
    }

    const rawOperationCount = OPERATION_NAMES.reduce((sum, name) => sum + list(raw[name]).length, 0);
    const validOperationCount = OPERATION_NAMES.reduce((sum, name) => sum + operations[name].length, 0);
    if (level !== "system" && rawOperationCount) {
      diagnostics.invalidOperations += validOperationCount;
      diagnostics.issues.push({ code: "non_system_operations", sourceIndex });
      invalidImpact = true;
    }
    if (level === "system" && !validOperationCount) {
      diagnostics.issues.push({ code: "system_without_operation", sourceIndex });
      invalidImpact = true;
    }

    // A malformed structural claim cannot be repaired by keeping its surviving
    // operations: reject the whole decision, without keeping partial structure.
    if (level === "system" && diagnostics.issues.some((issue) =>
      issue.sourceIndex === sourceIndex && issue.code.startsWith("invalid_") &&
      ["invalid_addition", "invalid_removal", "invalid_responsibility", "invalid_connection", "invalid_disconnection"]
        .includes(issue.code))) invalidImpact = true;

    if (invalidImpact) {
      for (const step of steps) rejectedStepIds.add(step);
      return null;
    }

    return { sourceIndex, level, targetId, title, why, size, steps, ...evidence, ...operations };
  }).filter(Boolean);
}

function revalidateCandidateReferences(candidates, existingIds, diagnostics, rejectedStepIds) {
  let validated = candidates;
  for (;;) {
    const reachableIds = new Set(existingIds);
    for (const candidate of validated) {
      if (candidate.level !== "system") continue;
      for (const addition of candidate.additions) reachableIds.add(addition.id);
    }

    let changed = false;
    validated = validated.map((candidate) => {
      const orphanTarget = candidate.level === "component" && !reachableIds.has(candidate.targetId);
      const orphanConnections = candidate.connections.filter((connection) =>
        !reachableIds.has(connection.from) || !reachableIds.has(connection.to));
      if (!orphanTarget && !orphanConnections.length) return candidate;
      diagnostics.invalidOperations += orphanConnections.length;
      diagnostics.issues.push({ code: "orphan_reference", sourceIndex: candidate.sourceIndex });
      for (const step of candidate.steps) rejectedStepIds.add(step);
      changed = true;
      return null;
    }).filter(Boolean);
    if (!changed) return validated;
  }
}

function resolveStepConflicts(candidates, diagnostics, rejectedStepIds) {
  const owner = new Map();
  for (const candidate of candidates) {
    for (const step of candidate.steps) {
      const incumbent = owner.get(step);
      if (!incumbent || LEVEL_RANK.get(candidate.level) < LEVEL_RANK.get(incumbent.level)) {
        if (incumbent) {
          diagnostics.conflicts++;
          rejectedStepIds.add(step);
        }
        owner.set(step, candidate);
      } else {
        diagnostics.conflicts++;
        rejectedStepIds.add(step);
      }
    }
  }

  const owned = candidates.map((candidate) => ({
    ...candidate,
    steps: candidate.steps.filter((step) => owner.get(step) === candidate),
  }));
  for (const candidate of owned) {
    if (!candidate.steps.length) {
      diagnostics.droppedImpacts++;
      diagnostics.issues.push({ code: "no_owned_steps", sourceIndex: candidate.sourceIndex });
    }
  }
  return owned.filter((candidate) => candidate.steps.length);
}

function stepCoverage(impacts, steps, diagnostics, rejectedStepIds) {
  const remainingClaims = new Map();
  for (const impact of impacts) {
    for (const step of impact.steps) remainingClaims.set(step, (remainingClaims.get(step) || 0) + 1);
  }
  const rejected = [];
  let claimed = 0;
  for (const step of steps) {
    const claims = remainingClaims.get(step.n) || 0;
    if (claims) {
      remainingClaims.set(step.n, claims - 1);
      claimed++;
    } else {
      diagnostics.issues.push({ code: "missing_step", step: step.n });
    }
    if (!claims || rejectedStepIds.has(step.n)) rejected.push(step.n);
  }
  return { rejectedSteps: rejected, claimed };
}

function groupComponentImpacts(impacts) {
  const grouped = new Map();
  const out = [];
  for (const impact of impacts) {
    if (impact.level !== "component" || !impact.targetId) {
      out.push(impact);
      continue;
    }
    const existing = grouped.get(impact.targetId);
    if (!existing) {
      const copy = {
        ...impact,
        steps: [...impact.steps],
        files: [...impact.files],
        symbols: [...impact.symbols],
      };
      grouped.set(impact.targetId, copy);
      out.push(copy);
      continue;
    }
    existing.steps = [...new Set([...existing.steps, ...impact.steps])].sort((a, b) => a - b);
    existing.files = [...new Set([...existing.files, ...impact.files])].slice(0, MAX_EVIDENCE);
    existing.symbols = [...new Set([...existing.symbols, ...impact.symbols])].slice(0, MAX_EVIDENCE);
    if (impact.size === "substantial") existing.size = "substantial";
  }
  return out;
}

function assignTrustedKeys(validated, diagnostics, steps, rejectedStepIds) {
  const impacts = validated.map(({ sourceIndex: _sourceIndex, ...impact }, index) => ({
    key: `impact:${index + 1}`,
    ...impact,
  }));
  const { rejectedSteps, claimed } = stepCoverage(impacts, steps, diagnostics, rejectedStepIds);
  diagnostics.kept = countKept(impacts);
  return {
    impacts,
    rejectedSteps,
    diagnostics,
    coverage: {
      claimed,
      total: steps.length,
      complete: impacts.length > 0 && claimed === steps.length && rejectedSteps.length === 0,
    },
  };
}

function ownedPaths(node) {
  if (Array.isArray(node?.anchor?.paths)) return node.anchor.paths;
  if (typeof node?.anchor?.dir === "string" && node.anchor.dir) return [`${node.anchor.dir.replace(/\/+$/, "")}/`];
  return list(node?.files);
}

function promptItem(node, provisional) {
  const id = provisional ? node.ref || node.id : node.id;
  return [
    `id: ${id}`,
    `name: ${node.name || id}`,
    `kind: ${node.kind || ""}`,
    `intent: ${node.intent || ""}`,
    `parent: ${node.parent || ""}`,
    `owns: ${ownedPaths(node).join(", ") || "(no files yet)"}`,
    provisional && node.rationale ? `rationale: ${node.rationale}` : "",
    provisional && list(node.dependencies).length ? `dependencies: ${node.dependencies.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export function buildImpactPrompt({ nodes = [], edges = [], groups = [] }, steps) {
  const components = nodes.length ? nodes : groups;
  const provisional = !nodes.length && groups.length > 0;
  return [
    "The current project map:",
    "",
    components.length ? components.map((node) => promptItem(node, provisional)).join("\n\n") : "(empty project map)",
    "",
    "Directed edges:",
    edges.length
      ? edges.map((edge) => `${edge.from} -> ${edge.to}${edge.label ? `: ${edge.label}` : ""}`).join("\n")
      : "(none)",
    "",
    "The plan, preserving supplied step numbers:",
    "",
    steps.map((step) => `${step.n}. ${step.text}`).join("\n"),
  ].join("\n");
}

export function validateImpacts(raw, { nodes = [], edges = [], steps = [] }) {
  const rawImpacts = isObject(raw) && Array.isArray(raw.impacts) ? raw.impacts : [];
  const diagnostics = {
    issues: [], invalidOperations: 0, conflicts: 0, droppedImpacts: 0,
    raw: countRaw(rawImpacts), kept: keptCounts(),
  };
  const existingIds = new Set(nodes.map((node) => node.id).filter((id) => typeof id === "string"));
  const validSteps = new Set(steps.map((step) => step.n));
  const stepText = new Map(steps.map((step) => [step.n, String(step.text || "")]));
  const existingEdges = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
  const rejectedStepIds = new Set();

  const additions = validateAllAdditions(rawImpacts, existingIds, validSteps, stepText, diagnostics);
  const knownIds = new Set([...existingIds, ...additions.ids]);
  const candidates = revalidateCandidateReferences(validateCandidates(rawImpacts, {
    additions, existingIds, knownIds, existingEdges, validSteps, stepText, diagnostics, nodes,
    rejectedStepIds,
  }), existingIds, diagnostics, rejectedStepIds);
  const owned = revalidateCandidateReferences(
    resolveStepConflicts(candidates, diagnostics, rejectedStepIds), existingIds, diagnostics,
    rejectedStepIds,
  );
  return assignTrustedKeys(groupComponentImpacts(owned), diagnostics, steps, rejectedStepIds);
}

function mapId(value, idFor) {
  if (idFor instanceof Map) return idFor.get(value) || value;
  if (typeof idFor === "function") return idFor(value) || value;
  if (isObject(idFor)) return idFor[value] || value;
  return value;
}

export function remapImpactTargets(raw, idFor) {
  if (!isObject(raw) || !Array.isArray(raw.impacts)) return raw;
  return {
    ...raw,
    impacts: raw.impacts.map((impact) => {
      if (!isObject(impact)) return impact;
      return {
        ...impact,
        targetId: mapId(impact.targetId, idFor),
        removals: list(impact.removals).map((operation) =>
          isObject(operation) ? { ...operation, id: mapId(operation.id, idFor) } : operation),
        responsibilities: list(impact.responsibilities).map((operation) =>
          isObject(operation) ? { ...operation, id: mapId(operation.id, idFor) } : operation),
        connections: list(impact.connections).map((operation) => isObject(operation) ? {
          ...operation, from: mapId(operation.from, idFor), to: mapId(operation.to, idFor),
        } : operation),
        disconnections: list(impact.disconnections).map((operation) => isObject(operation) ? {
          ...operation, from: mapId(operation.from, idFor), to: mapId(operation.to, idFor),
        } : operation),
      };
    }),
  };
}

export async function planImpact(context, steps, { call = callTask, deferValidation = false } = {}) {
  const prompt = buildImpactPrompt(context, steps);
  const response = await call({ task: "impact", prompt });
  if (!isObject(response) || !isObject(response.parsed) || !Array.isArray(response.parsed.impacts)) {
    const error = new Error("plangolin's impact service returned a malformed response.");
    error.validation = true;
    throw error;
  }
  if (deferValidation) {
    return { raw: response.parsed, provider: response.provider, model: response.model };
  }
  const validated = validateImpacts(response.parsed, { ...context, steps });
  return {
    ...validated,
    provider: response.provider,
    model: response.model,
    outcome: validated.coverage.complete ? "ready" : "partial",
  };
}
