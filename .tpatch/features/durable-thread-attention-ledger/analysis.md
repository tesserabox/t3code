# Analysis: durable-thread-attention-ledger

## Summary

T3 currently represents thread attention as mutable shell state:
settled/unsettled timestamps, snooze state, and booleans for pending approvals
or user input. Web, mobile, sorting, and agent-awareness notifications derive
from that latest state. There is no durable typed history explaining which
server-observed transition opened or resolved attention.

The first Phase 1 slice should add a server-owned audit ledger behind the
existing orchestration boundary. It must preserve all current client behavior
while making attention transitions queryable after restart and safe to consume
later by in-app, desktop, mobile, TWS, hosting, and optional push projections.

## Compatibility

- **Compatible and additive** when the ledger is derived from already-persisted
  orchestration events and current shell fields remain authoritative for
  existing clients.
- **Wire compatibility** requires any new snapshot fields to be optional and
  bounded. Older clients must continue to decode thread shells.
- **Persistence compatibility** depends on an idempotent projection keyed by
  durable event identity. Replaying the projector must not duplicate entries.
- **No provider compatibility change** is required. Provider adapters continue
  to emit the existing approval, user-input, activity, and turn events.
- **No relay or push dependency** is permitted. Local operation must remain
  complete with all optional services absent.

## Current behavior

- `packages/contracts/src/orchestration.ts` exposes current thread attention
  through settled/snoozed timestamps and pending approval/user-input flags.
- `apps/server/src/orchestration/decider.ts` emits settled/unsettled and
  activity/session events.
- `ProjectionPipeline`, `projector`, and `ProjectionSnapshotQuery` materialize
  the current thread shell.
- `packages/client-runtime/src/state/threadSettled.ts` and web/mobile list code
  derive presentation and sorting from the shell.
- Mobile agent-awareness and relay publication are separate projections of
  that same current state, not the canonical source of attention truth.

## Proposed first-slice boundary

1. Define a typed thread-attention audit entry with a stable source identity,
   server-observed timestamp, transition kind, disposition, and references to
   the originating thread/turn/request where available.
2. Persist entries transactionally from the existing projection pipeline.
3. Make writes idempotent under event replay.
4. Add a bounded server query and optional snapshot summary sufficient to prove
   restart-safe history without broadcasting an unbounded ledger.
5. Cover open/resolved actionable interactions and explicit
   settled/unsettled transitions that already exist in orchestration.
6. Leave web, mobile, relay, notification delivery, TWS, and hosting behavior
   unchanged.

## Likely affected areas

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- the persistence repository or migration that owns the chosen ledger storage
- focused contract, projector, projection-pipeline, persistence, and restart
  tests

## Risks and constraints

- Do not derive an unbounded ledger during render or include it in every thread
  shell update.
- Do not use device clocks, relay notification IDs, or prompt-derived text as
  canonical identity.
- Approval and user-input response races must converge through the owning
  environment's existing orchestration event order.
- A current-state backfill cannot invent historical transitions. Existing
  databases may begin with no audit history or one explicitly synthetic
  baseline entry; the choice must be documented and tested.
- Thread deletion and retention behavior must be explicit so audit rows do not
  become unbounded orphan state.
- TWS `needs_attention` and client-observed disconnects are later sources; this
  feature must not collapse them into provider/session truth.

## Recommendation

Proceed with a new independent root feature. Keep the implementation
server-first and additive, prove idempotency and restart behavior, and defer
client presentation and notification sinks to later dependent features.
