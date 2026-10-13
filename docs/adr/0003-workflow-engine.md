# ADR 0003: In-house workflow engine with database-enforced transitions

## Status

Accepted (vertical slice).

## Context

Lifecycle transitions, required evidence, roles, separation of duties and
human approval are business rules that CLAUDE.md requires to live in
deterministic code in `packages/workflow`, not in prompts, route handlers or a
third-party agent framework.

## Decision

- `@arf/workflow` holds a declarative transition table (`TRANSITION_RULES`)
  with, per transition: allowed source states, allowed actor types and roles,
  required evidence kinds, whether a human is required, and whether the actor
  must be independent of the version's authors. It is versioned
  (`policyVersion`).
- `WorkflowEngine.transition` is a pure decision returning a typed result; it
  does not throw for policy rejections. The API service applies an accepted
  transition, the `state_transitions` row and the audit record in one
  transaction, keyed by an idempotent transition key.
- Evidence for `PAPER_APPROVAL_REVIEW` and for committee decisions is computed
  by the server from canonical records (`computeEvidence`), so clients cannot
  choose which evidence counts.
- A database trigger refuses any change to `strategy_versions.state` without a
  matching `state_transitions` row in the same transaction, so a worker or a
  bug cannot bypass the engine.
- Model (AGENT) actors cannot transition strategy versions.

## Alternatives

- **XState or a similar library.** Good modelling tools, but evidence, roles
  and separation of duties would still be custom code around it.
- **Temporal workflows.** Durable execution, but a heavy dependency that would
  own state the specification assigns to ARF-OS.

## Consequences

- Every new transition is a table entry plus tests in `packages/workflow`.
- Policy changes bump the policy version recorded on transitions and decisions.

## Security implications

Role and independence checks run server-side for every transition; the
committee decision path additionally enforces that the decider is not an
author of the version.

## Migration/rollback

Rules are code; a rollback restores the previous table. Historical
transitions keep the policy version they were made under.
