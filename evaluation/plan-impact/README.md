# Plan-impact evaluation gate

This directory holds a fixed, sanitized corpus for comparing plan-impact placement against fully named components and provisional semantic groups. Expected results are semantic predicates—step ownership, impact category, target, evidence, and structural-operation identities—not exact model prose.

## Metrics

The evaluator runs responses through the production `validateImpacts`,
provisional-id remapping, and one constrained placement retry before scoring.
A successful placement contains only visible `system` and `component`
decisions:

- **Client coverage:** plan steps represented by the final visible placement.
  The gate requires 100% for cases expected to place successfully.
- **Raw coverage:** steps represented by the final validated model placement.
- **Retry rate:** semantic runs whose incomplete first response required the
  single constrained repair call.
- **Terminal placement failure rate:** semantic runs still incomplete after
  that repair. A successful repair increments retry rate without incrementing
  terminal failures.
- **False structural operations:** kept additions, removals, responsibility changes, connections, or disconnections not allowed by the case predicates.
- **False no-architecture conclusions:** a case labeled as requiring structural change that returns no kept structural operation.
- **Invalid operations and dropped proposals:** production validator diagnostics.
- **Category, target, and combined accuracy:** per-step agreement with the allowed impact levels and targets.
- **Repeat agreement:** equality of semantic placement signatures across identical runs. Titles and explanations are intentionally excluded.
- **Failure handling:** malformed, timeout, quota, refusal, and network scenarios are deterministic client-harness checks, not model-quality prompts or empty-success outcomes.

The live matrix is the Cartesian product of named/provisional context and
high/medium effort. Every case is repeated (twice by default) with the same
input. Live execution remains disabled unless `PLANGOLIN_EVAL_LIVE=1` is set.
Output contains only aggregate coverage, retry, terminal-failure, accuracy,
agreement, and failure metrics plus sanitized case IDs; prompts, plan content,
and model responses are neither printed nor persisted.

## Cold-path gate

The named/high variant is the baseline for the provisional/high variant. A valid run must contain no unexpected semantic-call failures, and every simulated failure must match its expected class. Provisional concurrent matching may default on only when representative live-model evidence then shows all of the following:

1. final visible client coverage is 100%;
2. false structural operations do not exceed the named baseline;
3. false no-architecture conclusions do not exceed the named baseline;
4. combined target/category accuracy is no more than 0.05 below the named baseline; and
5. repeated provisional results have 100% semantic agreement.

The runner supports two effort-attestation modes. An evaluation-aware service can acknowledge the requested effort and `evaluation.evidence: "live-model"` per response. An ordinary service whose effort is fixed at process/deployment startup can instead use distinct high- and medium-effort URLs; the runner routes by effort and accepts only successful responses containing the ordinary service's nonempty `provider` and `model` fields. Fixture responses, invalid-reference simulations, and local failure simulations exercise the harness but do not contribute live-evidence checks.

Cases with `expected.failureClass`, or with an allowlisted failure in
`execution.scenario`, never call either model endpoint. The runner locally
executes only the fixed allowlist `malformed`, `timeout`, `quota`, `refusal`,
and `network`, taking the actual class from `execution.scenario` and comparing
it with the expected class. Deliberately invalid terminal cases marked
`fixtureOnly` also stay local: they contribute a terminal-placement check but
no model call or retry-rate denominator. Failure checks and signatures are
separate from semantic scores, so local cases cannot inflate model coverage,
placement accuracy, repeat agreement, or live-evidence counts. Every other
case runs against the configured model service and makes one model call when
the initial placement is complete or exactly two when constrained repair is
required.

## Reproduction

Offline corpus validation and unit scoring make no network calls:

```sh
node scripts/evaluate-plan-impact.js
node --test test/plan-impact-evaluation.test.js
```

Live evaluation is deliberately opt-in. For ordinary checked-in `/v1/impact` services, start two isolated instances from the same service revision and model configuration: set the service's deployment-level effort to `high` for one and `medium` for the other. Then run:

```sh
PLANGOLIN_EVAL_LIVE=1 \
PLANGOLIN_EVAL_HIGH_URL=http://127.0.0.1:8787 \
PLANGOLIN_EVAL_MEDIUM_URL=http://127.0.0.1:8788 \
node scripts/evaluate-plan-impact.js
```

Both URLs are mandatory, must use HTTP(S), and must not contain credentials, a query, or a fragment. The runner constructs each endpoint with `new URL("/v1/impact", base)` and compares those canonical endpoint identities, so different base paths, default ports, fragments, or queries cannot label the same endpoint as both efforts. Host each effort instance on a distinct origin. This mode sends the ordinary service contract only: `installId` and `prompt`. Selecting the endpoint is the operator's explicit attestation of its process-level effort. The service response must include `provider` and `model` strings with at least one non-whitespace character, confirming the ordinary live-model response path.

If one evaluation-aware service supports safe per-request effort selection, use `PLANGOLIN_EVAL_SERVICE_URL` instead. That service must echo the applied effort plus `evaluation.evidence: "live-model"`; the runner rejects missing acknowledgment. In both modes, set `PLANGOLIN_EVAL_REPEATS` to a positive integer to change the repeat count. The runner never mutates process-global effort settings. Do not treat one ordinary hosted deployment used for both effort labels, or direct fixtures, as live gate evidence.

## Current decision

**Cold provisional concurrency remains OFF (`COLD_IMPACT_CONCURRENCY = false`).** On 2026-08-14, `PLANGOLIN_EVAL_LIVE` was not enabled, so no network call was made and no representative live corpus evidence was collected. The gate is therefore **not evaluated**, not passed. Prepared and warm reviews retain their one-post-plan-call paths, while unprepared cold reviews remain serial.
