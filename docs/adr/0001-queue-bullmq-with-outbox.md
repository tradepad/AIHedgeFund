# ADR 0001: BullMQ on Redis with a transactional outbox

## Status

Accepted (vertical slice).

## Context

Uploads, parsing, normalisation, equity, metrics, parity and agent runs are
asynchronous. CLAUDE.md requires idempotent jobs, persisted status (not logs)
for anything user-visible, and reliable event emission after a transaction
commits. The specification names Redis and BullMQ.

## Decision

- Domain events are written to `outbox_events` in the same transaction as the
  state change they describe. The relay in the API process claims pending rows
  with `FOR UPDATE SKIP LOCKED`, publishes them and marks them dispatched.
- Publishing routes each event type to BullMQ jobs. The BullMQ job id is
  derived from the event id and job name, so a re-publish after a crash is
  absorbed by BullMQ.
- Events emitted by jobs use deterministic ids (UUIDv8 from a name such as
  `trades.normalised|<runId>`), so a retried job produces the same outbox row
  and the unique key absorbs it.
- Every job runs inside `tracked()`, which records `job_runs` (status,
  attempts, last error code) keyed deterministically. Errors that a retry
  cannot fix are `TerminalJobError` → BullMQ `UnrecoverableError` →
  `FAILED_TERMINAL`.
- Workers never change lifecycle state. The orchestrator (in the API process)
  consumes `agent_run.completed` and applies task transitions through
  `@arf/workflow`.

## Alternatives

- **Publish directly to BullMQ from request handlers.** Loses events when the
  process dies between commit and publish, and publishes events for rolled-back
  transactions.
- **Temporal or another workflow service.** Strong durability, but a large new
  dependency and it would own state the specification puts in ARF-OS.
- **PostgreSQL-only queue (for example pg-boss).** Viable and removes Redis,
  but the specification and the planned SSE fan-out assume Redis, and BullMQ's
  retry and backoff semantics are well understood.

## Consequences

- At-least-once delivery everywhere; handlers must be idempotent (they check
  current status and use unique constraints).
- Two stores (PostgreSQL and Redis) must be available; Redis loss delays work
  but loses no events because the outbox is authoritative.
- The relay polls when idle; latency is bounded by its interval (500 ms by default).

## Security implications

Job payloads carry ids, not evidence content or secrets. Workers re-validate
payloads with Zod and re-load aggregates scoped by organisation id.

## Migration/rollback

The outbox is the integration point: replacing BullMQ means replacing the
relay's publisher and the worker entry points, not the services. Rolling back
a release leaves undispatched rows, which the next relay dispatches.
