const list = (value) => Array.isArray(value) ? value : [];

export function escapePlanHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}

export function planEvidenceHtml(evidence) {
  const row = (label, values, render) => values.length
    ? '<div class="plan-evidence-row"><span class="plan-files-label">' + label + "</span>" +
      values.map(render).join("") + "</div>"
    : "";
  return row("Plan steps", list(evidence && evidence.stepTexts), (step) =>
    "<p><b>" + escapePlanHtml(step && step.number) + ".</b> " +
      escapePlanHtml(step && step.text) + "</p>") +
    row("Files", list(evidence && evidence.files), (file) =>
      "<p><code>" + escapePlanHtml(file) + "</code></p>") +
    row("Symbols", list(evidence && evidence.symbols), (symbol) =>
      "<p><code>" + escapePlanHtml(symbol) + "</code></p>");
}

export function reviewRenderStamp(review) {
  return review
    ? JSON.stringify([String(review.id || ""), String(review.status || ""), review.revision ?? null])
    : "";
}

export function applyReviewRevision(previousStamp, review, rebuild) {
  const stamp = reviewRenderStamp(review);
  if (stamp === previousStamp) return { changed: false, stamp };
  let previous = null;
  try {
    const parsed = JSON.parse(previousStamp);
    if (Array.isArray(parsed) && parsed.length === 3) previous = parsed;
  } catch {
    previous = null;
  }
  if (previous && review &&
      previous[0] === String(review.id || "") &&
      previous[1] === String(review.status || "")) {
    const previousRevision = previous[2];
    const nextRevision = review.revision ?? null;
    const strictlyHigher = typeof previousRevision === "number" &&
      typeof nextRevision === "number" && nextRevision > previousRevision;
    const introducesRevision = previousRevision == null && typeof nextRevision === "number";
    if (!strictlyHigher && !introducesRevision) {
      return { changed: false, stamp: previousStamp };
    }
  }
  const value = rebuild(review);
  return { changed: true, stamp, value };
}

export function normalizePlanNavigation(options) {
  const persisted = new Map(list(options && options.persistedNodes)
    .map((node) => [node.id, node]));
  const previousNodes = new Map(list(options && options.previousProjection && options.previousProjection.nodes)
    .map((node) => [node.id, node]));
  const nextNodes = new Map(list(options && options.projection && options.projection.nodes)
    .map((node) => [node.id, node]));
  const hasNextChildren = (id) => list(options && options.persistedNodes).some((node) => node.parent === id) ||
    list(options && options.projection && options.projection.nodes).some((node) => node.parent === id);

  let viewRoot = options && options.viewRoot || null;
  const priorRoot = previousNodes.get(viewRoot);
  const nextRoot = nextNodes.get(viewRoot);
  const temporaryRootInvalid = !!viewRoot && !persisted.has(viewRoot) &&
    (!nextRoot || !hasNextChildren(viewRoot));

  if (priorRoot && temporaryRootInvalid) {
    let parent = priorRoot.parent || null;
    const seen = new Set();
    viewRoot = null;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (persisted.has(parent)) {
        viewRoot = parent;
        break;
      }
      const priorParent = previousNodes.get(parent);
      parent = priorParent && priorParent.parent || null;
    }
  } else if (temporaryRootInvalid) {
    viewRoot = null;
  }

  let selectedId = options && options.selectedId || null;
  if (selectedId && !persisted.has(selectedId) && !nextNodes.has(selectedId)) selectedId = null;

  return { viewRoot, selectedId };
}

export function projectedEdgeEndpoints(edge, viewRoot, persistedNodes, projection) {
  const nodes = new Map([
    ...list(persistedNodes),
    ...list(projection && projection.nodes),
  ].map((node) => [node.id, node]));
  const visible = (id) => {
    const seen = new Set();
    let current = nodes.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = current.parent || null;
      if (parent === (viewRoot || null)) return current.id;
      current = parent ? nodes.get(parent) : null;
    }
    return null;
  };
  const from = visible(edge && edge.from);
  const to = visible(edge && edge.to);
  return from && to && from !== to ? { from, to } : null;
}

export function applyTemporaryNodeAccessibility(element, node, state) {
  const enterable = !!(state && state.enterable);
  const selected = !!(state && state.selected);
  const type = node && (node.cardKind || node.kind) || "Plan item";
  const name = node && node.name || "Untitled";
  element.dataset.planAction = "true";
  element.dataset.planId = String(node && node.id || "");
  element.dataset.enterable = String(enterable);
  if (node && node.impactKey) element.dataset.impactKey = String(node.impactKey);
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", type + ": " + name + ". Press Enter to " +
    (enterable ? "open." : "select this plan change."));
  if (selected) element.setAttribute("aria-current", "true");
  else element.removeAttribute("aria-current");
}

export function handleTemporaryActivation(event, element, state, callbacks) {
  const id = element && element.dataset && element.dataset.planId || "";
  const impactKey = element && element.dataset && element.dataset.impactKey || "";
  const enterable = element && element.dataset && element.dataset.enterable === "true";
  const lastClick = state && state.lastClick || null;

  if (event && event.type === "keydown") {
    if (event.key !== "Enter") return { handled: false, action: "", lastClick };
    event.preventDefault();
    callbacks.focus?.(impactKey, id);
    if (enterable) {
      callbacks.enter(id);
      return { handled: true, action: "enter", lastClick: null };
    }
    if (impactKey) {
      callbacks.select(impactKey, id);
      return { handled: true, action: "select", lastClick: null };
    }
    return { handled: false, action: "", lastClick };
  }

  if (event && event.type === "mousedown") {
    element?.focus?.({ preventScroll: true });
    callbacks.focus?.(impactKey, id);
    return { handled: true, action: "focus", lastClick };
  }

  if (event && event.type === "click") {
    const now = Number.isFinite(state && state.now) ? state.now : Date.now();
    if (!event.detail) {
      element?.focus?.({ preventScroll: true });
      callbacks.focus?.(impactKey, id);
      if (enterable) {
        callbacks.enter(id);
        return { handled: true, action: "enter", lastClick: null };
      }
    }
    if (enterable && lastClick && lastClick.id === id && now - lastClick.time < 400) {
      event.preventDefault();
      callbacks.enter(id);
      return { handled: true, action: "enter", lastClick: null };
    }
    if (enterable && !impactKey) {
      callbacks.enter(id);
      return { handled: true, action: "enter", lastClick: null };
    }
    if (impactKey) callbacks.select(impactKey, id);
    return {
      handled: !!impactKey,
      action: impactKey ? "select" : "",
      lastClick: { id, time: now },
    };
  }

  return { handled: false, action: "", lastClick };
}

export function capturePlanFocus(element) {
  const control = element?.closest?.("[data-plan-toggle]");
  if (control) {
    return {
      kind: "control",
      ownerId: String(control.dataset?.planOwnerId || ""),
      impactKey: String(control.dataset?.impactKey || ""),
      control: String(control.dataset?.planToggle || ""),
    };
  }
  const action = element?.closest?.("[data-plan-action]");
  if (action) return { kind: "action", id: String(action.dataset?.planId || "") };
  return null;
}

export function restorePlanFocus(root, token) {
  if (!root || !token) return false;
  const replacement = [...root.querySelectorAll("[data-plan-action], [data-plan-toggle]")]
    .find((element) => {
      if (!element.dataset) return false;
      if (token.kind === "action") {
        return !!element.dataset.planAction && element.dataset.planId === token.id;
      }
      if (token.kind === "control") {
        return element.dataset.planToggle === token.control &&
          element.dataset.planOwnerId === token.ownerId &&
          element.dataset.impactKey === token.impactKey;
      }
      return false;
    });
  if (!replacement || typeof replacement.focus !== "function") return false;
  replacement.focus({ preventScroll: true });
  return true;
}

export function restoreTemporaryFocus(root, id) {
  return restorePlanFocus(root, id ? { kind: "action", id } : null);
}

export function navigatePlanState(state, targetId) {
  return { ...state, viewRoot: targetId || null };
}

export function selectTemporaryPlanState(state, planSelectedId) {
  return {
    ...state,
    persistedSelection: null,
    planSelectedId: planSelectedId || null,
    inspectorOpen: false,
    hunkView: null,
  };
}

export function handlePlanDeleteBoundary(event, state) {
  if (!event || (event.key !== "Delete" && event.key !== "Backspace")) {
    return { handled: false, state };
  }

  const target = event.target;
  const tagName = String(target?.tagName || "").toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName) || target?.isContentEditable) {
    return { handled: false, state };
  }

  const targetsPlanAction = Boolean(target?.closest?.("[data-plan-action]"));
  if (!targetsPlanAction && !state?.planSelectedId) {
    return { handled: false, state };
  }

  event.preventDefault?.();
  return {
    handled: true,
    state: selectTemporaryPlanState(state || {}, state?.planSelectedId),
  };
}

export function persistentGraphActionAllowed(action, persistedNodes, projection) {
  const persisted = new Set(list(persistedNodes).map((node) => node.id));
  const temporary = new Set(list(projection && projection.nodes).map((node) => node.id));
  const viewRoot = action && action.viewRoot || null;
  if (viewRoot && (!persisted.has(viewRoot) || temporary.has(viewRoot))) return false;
  return list(action && action.ids).every((id) => persisted.has(id) && !temporary.has(id));
}

export function buildPersistedSavePayload(document, projection) {
  const temporaryNodes = new Set(list(projection && projection.nodes).map((node) => node.id));
  const temporaryEdges = new Set(list(projection && projection.edges).map((edge) => edge.id));
  const layout = Object.fromEntries(Object.entries(document && document.layout || {})
    .filter(([id]) => !temporaryNodes.has(id)));
  return {
    ...document,
    nodes: list(document && document.nodes)
      .filter((node) => !node.planType && !temporaryNodes.has(node.id)),
    edges: list(document && document.edges).filter((edge) =>
      !edge.planType && !temporaryEdges.has(edge.id) &&
      !temporaryNodes.has(edge.from) && !temporaryNodes.has(edge.to)),
    notes: list(document && document.notes)
      .filter((note) => !temporaryNodes.has(note.id)),
    layout,
  };
}

export function buildPlanResolvePayload(review, cutKeys, nodes, projection) {
  const cut = cutKeys instanceof Set ? cutKeys : new Set();
  const temporary = new Set(list(projection && projection.nodes).map((node) => node.id));
  return {
    id: review && review.id,
    accepted: list(review && review.impacts)
      .map((impact) => impact.key)
      .filter((key) => key && !cut.has(key)),
    nodes: list(nodes)
      .filter((node) => !node.planType && !temporary.has(node.id))
      .map((node) => ({ id: node.id, name: node.name, intent: node.intent })),
  };
}
