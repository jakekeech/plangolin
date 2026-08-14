const MAX_COUNT = 1_000_000;
const ACTIVE_STATUSES = new Set(["working", "ready", "partial", "error"]);
const PLACEMENT_ERROR = "Plangolin could not place every change on this system map.";
const list = (value) => Array.isArray(value) ? value : [];

const boundedCount = (value) => Number.isFinite(value)
  ? Math.min(MAX_COUNT, Math.max(0, Math.floor(value)))
  : 0;

const plural = (count, singular, many = singular + "s") =>
  count + " " + (count === 1 ? singular : many);

const sentenceList = (values) => {
  const present = values.filter(Boolean);
  if (present.length < 2) return present[0] || "";
  if (present.length === 2) return present.join(" and ");
  return present.slice(0, -1).join(", ") + ", and " + present.at(-1);
};

const operationNames = (values, noun) => {
  const names = values.filter(Boolean);
  const counts = new Map();
  names.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
  if ([...counts.values()].every((count) => count === 1)) return sentenceList(names);
  const labeled = [...counts].map(([name, count]) => name + (count > 1 ? " ×" + count : ""));
  return plural(names.length, noun) + " (" + sentenceList(labeled) + ")";
};

export function completeVisibleReview(review) {
  if (!review || review.status !== "ready") return false;
  const steps = list(review.steps);
  const impacts = list(review.impacts);
  if (!steps.length || !impacts.length) return false;
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
  return [...claims.values()].every((count) => count === 1);
}

export function planProgressCopy(review) {
  const counts = review && review.counts || {};
  const files = boundedCount(counts.files);
  const components = boundedCount(counts.components);
  const steps = boundedCount(counts.steps);
  switch (review && review.phase) {
    case "mapping_project":
      return "Mapping your project — " + plural(files, "file") + " found";
    case "grouping_components":
      return "Grouping those files into components";
    case "naming_components":
      return "Naming " + plural(components, "component");
    case "naming_and_matching":
      return "Naming " + plural(components, "component") + " and matching " +
        plural(steps, "plan step");
    case "loading_system_map":
      return "Loading your system map";
    case "matching_plan":
      return "Matching " + plural(steps, "plan step") + " to your system map";
    case "arranging_review":
      return "Arranging the review";
    default:
      return "Reviewing your plan";
  }
}

export function planSummary(review, projection, nodes) {
  if (review && !completeVisibleReview(review)) return PLACEMENT_ERROR;

  const impacts = list(review && review.impacts);
  const projectedNodes = list(projection && projection.nodes);
  const byId = new Map([
    ...list(nodes),
    ...projectedNodes,
  ].map((node) => [node.id, node]));
  const sourceNames = new Map(projectedNodes
    .filter((node) => node.planType === "addition" && node.sourceId)
    .map((node) => [node.sourceId, node.name]));
  const nameOf = (id) => sourceNames.get(id) || byId.get(id)?.name || id;
  const stepCount = boundedCount(list(review && review.steps).length || review?.counts?.steps);
  const reviewed = plural(stepCount, "plan step") + " reviewed.";

  const additions = projectedNodes
    .filter((node) => node.planType === "addition")
    .map((node) => node.name);
  const removals = list(projection && projection.annotations && projection.annotations.removals)
    .map((operation) => nameOf(operation.targetId));
  const connections = list(projection && projection.edges)
    .filter((edge) => edge.planType === "connection")
    .map((edge) => nameOf(edge.from) + " to " + nameOf(edge.to));
  const disconnections = list(projection && projection.annotations && projection.annotations.disconnections)
    .map((operation) => nameOf(operation.from) + " from " + nameOf(operation.to));
  const responsibilities = list(projection && projection.annotations && projection.annotations.responsibilities)
    .map((operation) => nameOf(operation.targetId));
  const structural = [
    additions.length ? "Adds " + operationNames(additions, "component") + "." : "",
    removals.length ? "Removes " + operationNames(removals, "component") + "." : "",
    connections.length ? (connections.length === 1 ? "Connects " : "Adds ") +
      operationNames(connections, "connection") + "." : "",
    disconnections.length ? (disconnections.length === 1 ? "Disconnects " : "Removes ") +
      operationNames(disconnections, "connection") + "." : "",
    responsibilities.length ? "Updates responsibilities for " +
      operationNames(responsibilities, "component") + "." : "",
  ].filter(Boolean);

  const affected = [...new Set(impacts
    .filter((entry) => entry.level === "component" && entry.targetId)
    .map((entry) => nameOf(entry.targetId)))];

  if (structural.length) {
    return [...structural, reviewed, affected.length
      ? "Work also affects " + sentenceList(affected) + "."
      : ""].filter(Boolean).join(" ");
  }
  if (affected.length) {
    return [reviewed, "Work affects " + sentenceList(affected) + ".",
      "The system shape stays the same."].join(" ");
  }
  return [reviewed, "Review the proposed work before approving."].join(" ");
}

export function planPollDelay(review) {
  return review && ACTIVE_STATUSES.has(review.status) ? 500 : 2000;
}

export function planControlState(review) {
  const status = review && review.status || "";
  const reviewable = completeVisibleReview(review);
  const retryable = status === "error" || status === "partial" ||
    (status === "ready" && !reviewable);
  return {
    keep: reviewable,
    cut: reviewable,
    approve: reviewable,
    retry: retryable,
    skip: retryable,
    navigation: reviewable,
    warning: "",
  };
}

export function planRenderState(review, projection, nodes) {
  const controls = planControlState(review);
  if (!review) return { progress: "", summary: "", announcement: "", controls };
  if (review.status === "working" || review.status === "thinking") {
    const progress = planProgressCopy(review);
    return { progress, summary: "", announcement: progress, controls };
  }
  const summary = planSummary(review, projection, nodes);
  return { progress: "", summary, announcement: summary, controls };
}

export function reconcilePlanCutKeys(previousReview, nextReview, cutKeys) {
  if (!previousReview || !nextReview || previousReview.id !== nextReview.id) return new Set();
  const current = new Set(cutKeys instanceof Set ? cutKeys : []);
  if (!completeVisibleReview(nextReview)) return current;
  const currentKeys = new Set(list(nextReview.impacts).map((impact) => impact.key).filter(Boolean));
  return new Set([...current].filter((key) => currentKeys.has(key)));
}

export function createPlanPollScheduler(options) {
  const poll = options.poll;
  const currentReview = options.review;
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  let timer = null;
  let running = false;
  let stopped = true;

  async function pollPlanLoop() {
    if (stopped || running) return;
    timer = null;
    running = true;
    try {
      await poll();
    } catch {
      // A local server can restart while the browser remains open. The next
      // self-scheduled read is the recovery path.
    } finally {
      running = false;
      if (!stopped) timer = schedule(pollPlanLoop, planPollDelay(currentReview()));
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void pollPlanLoop();
    },
    stop() {
      stopped = true;
      if (timer != null) cancel(timer);
      timer = null;
    },
  };
}

export function createPlanRetryController(options) {
  const currentReview = options.review;
  const publish = options.publish;
  const request = options.fetch;
  let retrying = false;

  return async function retryPlan() {
    const failed = currentReview();
    if (retrying || !failed || !planControlState(failed).retry) return false;
    retrying = true;
    const optimistic = {
      ...failed,
      status: "working",
      phase: "loading_system_map",
      elapsedMs: 0,
      note: "",
      revision: boundedCount(failed.revision) + 1,
    };
    publish(optimistic);
    try {
      const response = await request("/api/plan/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: failed.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok === false) throw new Error("retry refused");
      return true;
    } catch {
      if (currentReview() === optimistic) {
        publish({
          ...failed,
          note: "Retry didn't reach Plangolin. Check that the command is still waiting, then try again.",
        });
      }
      return false;
    } finally {
      retrying = false;
    }
  };
}
