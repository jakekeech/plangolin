const MAX_COUNT = 1_000_000;
const ACTIVE_STATUSES = new Set(["working", "ready", "partial", "error"]);
const list = (value) => Array.isArray(value) ? value : [];

const boundedCount = (value) => Number.isFinite(value)
  ? Math.min(MAX_COUNT, Math.max(0, Math.floor(value)))
  : 0;

const plural = (count, singular, many = singular + "s") =>
  count + " " + (count === 1 ? singular : many);

const sentenceList = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length < 2) return unique[0] || "";
  if (unique.length === 2) return unique.join(" and ");
  return unique.slice(0, -1).join(", ") + ", and " + unique.at(-1);
};

const cleanNote = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);

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
  if (review && review.status === "error") {
    const note = cleanNote(review.note)
      .replace(/^This plan is longer than plangolin reads — only the first \d+ steps were reviewed\.\s*/i, "") ||
      "Plangolin couldn't complete the impact review. Retry or skip this review.";
    return "Review stopped safely. " + note;
  }

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
    additions.length ? "Adds " + sentenceList(additions) + "." : "",
    removals.length ? "Removes " + sentenceList(removals) + "." : "",
    connections.length ? "Connects " + sentenceList(connections) + "." : "",
    disconnections.length ? "Disconnects " + sentenceList(disconnections) + "." : "",
    responsibilities.length ? "Updates responsibilities for " + sentenceList(responsibilities) + "." : "",
  ].filter(Boolean);

  const affected = impacts
    .filter((entry) => (entry.level === "component" || entry.level === "support") && entry.targetId)
    .map((entry) => nameOf(entry.targetId));
  const unresolvedSteps = [...new Set(impacts
    .filter((entry) => entry.level === "unresolved")
    .flatMap((entry) => list(entry.steps)))];
  const needsReview = review && review.status === "partial"
    ? unresolvedSteps.length
      ? "Needs Review: " + plural(unresolvedSteps.length, "plan step") + " still " +
        (unresolvedSteps.length === 1 ? "needs" : "need") + " a component."
      : "Needs Review: some plan changes still need a closer look."
    : "";

  if (structural.length) {
    return [...structural, reviewed, affected.length
      ? "Work also affects " + sentenceList(affected) + "."
      : "", needsReview].filter(Boolean).join(" ");
  }
  if (affected.length) {
    return [reviewed, "Work affects " + sentenceList(affected) + ".", needsReview ||
      "The system shape stays the same."].filter(Boolean).join(" ");
  }
  return [reviewed, needsReview || "Review the proposed work before approving."].join(" ");
}

export function planPollDelay(review) {
  return review && ACTIVE_STATUSES.has(review.status) ? 500 : 2000;
}

export function planControlState(review) {
  const status = review && review.status || "";
  const reviewable = status === "ready" || status === "partial";
  return {
    keep: reviewable,
    cut: reviewable,
    approve: reviewable,
    retry: status === "error",
    skip: status === "error",
    navigation: reviewable,
    warning: status === "partial"
      ? "Needs Review — check unresolved plan steps before approving."
      : "",
  };
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
    if (retrying || !failed || failed.status !== "error") return false;
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
