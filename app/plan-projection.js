/* A review is drawn beside the persisted graph, never folded into it. This
   module deliberately knows nothing about the DOM or document save path so the
   browser and Node tests consume the same immutable projection. */

const list = (value) => Array.isArray(value) ? value : [];
const namespacePart = (value) => encodeURIComponent(String(value || ""));
const parentOf = (node) => node && node.parent ? node.parent : null;

function impactBase(reviewId, impactKey) {
  return "plan:" + namespacePart(reviewId) + ":" + namespacePart(impactKey);
}

function operationId(base, operation, index, key) {
  return base + ":" + operation + ":" + index + (key ? ":" + namespacePart(key) : "");
}

function cardFor(reviewId, impact, parent, cardKind, display = {}) {
  const title = display.title || impact.title;
  const why = display.why || impact.why;
  return {
    id: impactBase(reviewId, impact.key) + ":card",
    planType: "card",
    cardKind,
    parent,
    impactKey: impact.key,
    level: impact.level,
    name: title,
    title,
    intent: why,
    why,
    size: impact.size,
    steps: [...list(impact.steps)],
    files: [...list(impact.files)],
    symbols: [...list(impact.symbols)],
  };
}

const emptyProjection = () => ({
  reviewId: "",
  nodes: [],
  edges: [],
  annotations: { removals: [], responsibilities: [], disconnections: [] },
});

export function reviewMapEdges(edges, review) {
  const saved = list(edges);
  const present = new Set(saved.map((edge) => edge.from + "\0" + edge.to));
  const repaired = list(review && review.mapEdges)
    .filter((edge) => edge && !present.has(edge.from + "\0" + edge.to))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label || "",
      operations: list(edge.operations).map((operation) => ({ ...operation })),
      reviewContext: true,
    }));
  return [...saved, ...repaired];
}

export function reviewDecisionImpacts(review) {
  return list(review && review.impacts)
    .filter((impact) => impact && (impact.level === "system" || impact.level === "component"));
}

export function planProjectionVisible(review) {
  return ["ready", "partial", "error"].includes(review && review.status || "");
}

/* A failed analysis keeps the persisted map visible without inventing graph
   nodes. A working retry keeps the previous projection to avoid flicker. */
export function projectionForReview(review, nodes, edges, previousProjection) {
  const status = review && review.status || "";
  if (planProjectionVisible(review)) {
    return buildPlanProjection(review, nodes, edges);
  }
  const previous = previousProjection || emptyProjection();
  if (status === "working" && previous.reviewId === review.id) return previous;
  return emptyProjection();
}

export function buildPlanProjection(review, nodes, edges) {
  const reviewId = review && review.id ? review.id : "review";
  const impacts = list(review && review.impacts);
  const persistedEdges = list(edges);
  const temporaryNodes = [];
  const temporaryEdges = [];
  const annotations = { removals: [], responsibilities: [], disconnections: [] };
  const proposedBySource = new Map();

  // All proposed identities exist before targets and endpoints are resolved.
  // Validation permits an impact to target an addition declared later.
  for (const impact of impacts) {
    const base = impactBase(reviewId, impact.key);
    list(impact.additions).forEach((addition, index) => {
      const temporary = {
        id: base + ":addition:" + namespacePart(addition.id),
        sourceId: addition.id,
        planType: "addition",
        parent: null,
        impactKey: impact.key,
        level: impact.level,
        name: addition.name,
        kind: addition.kind,
        intent: addition.intent,
        dir: addition.dir,
        files: [...list(addition.files)],
        steps: [...list(impact.steps)],
        why: impact.why,
        operationIndex: index,
      };
      proposedBySource.set(addition.id, temporary.id);
      temporaryNodes.push(temporary);
    });
  }

  const projectedEndpoint = (id) => proposedBySource.get(id) || id;

  for (const impact of impacts) {
    const base = impactBase(reviewId, impact.key);

    list(impact.connections).forEach((connection, index) => {
      temporaryEdges.push({
        id: operationId(base, "connection", index, connection.from + ">" + connection.to),
        planType: "connection",
        impactKey: impact.key,
        from: projectedEndpoint(connection.from),
        to: projectedEndpoint(connection.to),
        sourceFrom: connection.from,
        sourceTo: connection.to,
        label: connection.label,
      });
    });

    list(impact.removals).forEach((removal, index) => {
      annotations.removals.push({
        id: operationId(base, "removal", index, removal.id),
        planType: "removal",
        impactKey: impact.key,
        targetId: removal.id,
      });
    });

    list(impact.responsibilities).forEach((responsibility, index) => {
      annotations.responsibilities.push({
        id: operationId(base, "responsibility", index, responsibility.id),
        planType: "responsibility",
        impactKey: impact.key,
        targetId: responsibility.id,
        intent: responsibility.intent,
        why: responsibility.why,
      });
    });

    list(impact.disconnections).forEach((disconnection, index) => {
      const edge = persistedEdges.find((candidate) =>
        candidate.from === disconnection.from && candidate.to === disconnection.to);
      annotations.disconnections.push({
        id: operationId(base, "disconnection", index, disconnection.from + ">" + disconnection.to),
        planType: "disconnection",
        impactKey: impact.key,
        edgeId: edge ? edge.id : "",
        from: disconnection.from,
        to: disconnection.to,
      });
    });

    if (impact.level === "component" && impact.targetId) {
      temporaryNodes.push(cardFor(
        reviewId, impact, projectedEndpoint(impact.targetId), "internal change",
      ));
    }
  }

  return {
    reviewId,
    nodes: temporaryNodes,
    edges: temporaryEdges,
    annotations,
  };
}

export function temporaryChildren(projection, parentId) {
  const wanted = parentId || null;
  return list(projection && projection.nodes).filter((node) => parentOf(node) === wanted);
}

export function recursiveImpactCounts(projection, nodes) {
  const parents = new Map();
  list(nodes).forEach((node) => parents.set(node.id, parentOf(node)));
  list(projection && projection.nodes).forEach((node) => parents.set(node.id, parentOf(node)));

  const keysByNode = new Map();
  const mark = (startId, impactKey) => {
    if (!startId || !impactKey) return;
    const seen = new Set();
    let id = startId;
    while (id && !seen.has(id)) {
      seen.add(id);
      if (!keysByNode.has(id)) keysByNode.set(id, new Set());
      keysByNode.get(id).add(impactKey);
      id = parents.get(id) || null;
    }
  };

  for (const node of list(projection && projection.nodes)) {
    if (!node.impactKey) continue;
    mark(node.planType === "card" ? node.parent : node.id, node.impactKey);
  }
  for (const edge of list(projection && projection.edges)) {
    mark(edge.from, edge.impactKey);
    mark(edge.to, edge.impactKey);
  }
  for (const annotation of list(projection && projection.annotations && projection.annotations.removals)) {
    mark(annotation.targetId, annotation.impactKey);
  }
  for (const annotation of list(projection && projection.annotations && projection.annotations.responsibilities)) {
    mark(annotation.targetId, annotation.impactKey);
  }
  for (const annotation of list(projection && projection.annotations && projection.annotations.disconnections)) {
    mark(annotation.from, annotation.impactKey);
    mark(annotation.to, annotation.impactKey);
  }

  return new Map([...keysByNode].map(([id, keys]) => [id, keys.size]));
}

export function planViewNodes(viewRoot, persistedNodes, projection) {
  const wanted = viewRoot || null;
  const persisted = list(persistedNodes).filter((node) => parentOf(node) === wanted);
  return [...persisted, ...temporaryChildren(projection, wanted)];
}

export function setImpactDecision(cutKeys, impactKey, cut) {
  const next = new Set(cutKeys instanceof Set ? cutKeys : []);
  if (cut) next.add(impactKey);
  else next.delete(impactKey);
  return next;
}

export function acceptedImpactKeys(review, cutKeys) {
  const cut = cutKeys instanceof Set ? cutKeys : new Set();
  return list(review && review.impacts)
    .map((impact) => impact.key)
    .filter((key) => key && !cut.has(key));
}
