# Plan-impact evaluation gate

This directory holds a fixed, sanitized corpus for comparing plan-impact placement against fully named components and provisional semantic groups. Expected results are semantic predicates—step ownership, impact category, target, evidence, and structural-operation identities—not exact model prose.

## Metrics

The evaluator runs responses through the production `validateImpacts` and provisional-id remapping code before scoring:

- **Client coverage:** plan steps represented after the client's generated-unresolved repair. The gate requires 100%.
- **Raw coverage:** steps placed without generated-unresolved fallback.
- **False structural operations:** kept additions, removals, responsibility changes, connections, or disconnections not allowed by the case predicates.
- **False no-architecture conclusions:** a case labeled as requiring structural change that returns no kept structural operation.
- **Invalid operations and dropped proposals:** production validator diagnostics.
- **Category, target, and combined accuracy:** per-step agreement with the allowed impact levels and targets.
- **Repeat agreement:** equality of semantic placement signatures across identical runs. Titles and explanations are intentionally excluded.
- **Failure handling:** malformed, timeout, quota, refusal, and network scenarios are checked as explicit failures, not empty-success outcomes.

The live matrix is the Cartesian product of named/provisional context and high/medium effort. Every case is repeated (twice by default) with the same input. Output contains only aggregate metrics and sanitized case IDs; prompts and model responses are neither printed nor persisted.

## Cold-path gate

The named/high variant is the baseline for the provisional/high variant. A valid run must contain no unexpected semantic-call failures, and every simulated failure must match its expected class. Provisional concurrent matching may default on only when representative live-model evidence then shows all of the following:

1. repaired client coverage is 100%;
2. false structural operations do not exceed the named baseline;
3. false no-architecture conclusions do not exceed the named baseline;
4. combined target/category accuracy is no more than 0.05 below the named baseline; and
5. repeated provisional results have 100% semantic agreement.

The runner also requires each gate-eligible response to acknowledge both the requested effort and `evaluation.evidence: "live-model"`. Fixture responses, invalid-reference simulations, and transport-failure simulations exercise the harness but cannot satisfy the live-evidence requirement.

## Reproduction

Offline corpus validation and unit scoring make no network calls:

```sh
node scripts/evaluate-plan-impact.js
node --test test/plan-impact-evaluation.test.js
```

Live evaluation is deliberately opt-in and requires an evaluation-aware service:

```sh
PLANGOLIN_EVAL_LIVE=1 \
PLANGOLIN_EVAL_SERVICE_URL=http://127.0.0.1:8787 \
node scripts/evaluate-plan-impact.js
```

Set `PLANGOLIN_EVAL_REPEATS` to a positive integer to change the repeat count. The service must honor the per-request `evaluation.effort` value and echo the applied value plus `evaluation.evidence: "live-model"`; the runner rejects a missing effort acknowledgment. This avoids mutating process-wide effort configuration while concurrent variants run.

If the service supports effort only through deployment environment variables, run isolated high- and medium-effort local service instances behind an evaluation-only adapter that forwards each request to the correct instance and supplies the acknowledgment from known instance configuration. Do not treat a hosted deployment that ignores the evaluation fields, or direct fixtures, as live gate evidence.

## Current decision

**Cold provisional concurrency remains OFF (`COLD_IMPACT_CONCURRENCY = false`).** On 2026-08-14, `PLANGOLIN_EVAL_LIVE` was not enabled, so no network call was made and no representative live corpus evidence was collected. The gate is therefore **not evaluated**, not passed. Prepared and warm reviews retain their one-post-plan-call paths, while unprepared cold reviews remain serial.
