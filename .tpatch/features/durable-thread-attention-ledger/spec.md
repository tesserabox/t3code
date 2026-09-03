# Specification: durable-thread-attention-ledger

## Goal

Add the first durable, server-owned attention audit projection without
changing current thread presentation or notification behavior.

The ledger records existing orchestration transitions. It is not yet the
full attention-item lifecycle, a client inbox, or a notification delivery
system.

## Accepted transition kinds

The first slice records exactly:

- `approval.requested`
- `approval.resolved`
- `provider.approval.respond.failed`
- `user-input.requested`
- `user-input.resolved`
- `provider.user-input.respond.failed`
- `thread.settled`
- `thread.unsettled`

Other activity, provider, Git, TWS, completion, failure, disconnect, hosting,
and notification transitions are out of scope.

## Contract

Add a closed `OrchestrationThreadAttentionAuditKind` schema and
`OrchestrationThreadAttentionAuditEntry` schema with:

- `eventId`: the durable orchestration event ID and idempotency key;
- `threadId`;
- nullable `turnId`;
- nullable `requestId`;
- one accepted transition `kind`;
- durable orchestration `sequence`;
- server-owned `occurredAt`.

Do not store prompt text, questions, answers, tool arguments, command output,
file paths, approval detail, or arbitrary activity payloads in this first
audit row.

## Persistence

Create migration 44 with a dedicated
`projection_thread_attention_audit` table:

- `event_id TEXT PRIMARY KEY`
- `thread_id TEXT NOT NULL`
- `turn_id TEXT`
- `request_id TEXT`
- `kind TEXT NOT NULL`
- `sequence INTEGER NOT NULL`
- `occurred_at TEXT NOT NULL`

Create an index supporting bounded newest-first reads by thread and sequence.

Use a dedicated table rather than `projection_thread_activities`. Activity
rows are visible timeline data; inserting hidden settle/unsettle audit rows
there could change the chat after restart.

## Projection behavior

Add one projection-pipeline projector with its own cursor.

- `thread.created` clears prior audit rows for that thread so a rebuilt or
  reused thread ID begins from a deterministic projection state.
- `thread.settled` and `thread.unsettled` map directly from their orchestration
  event.
- Accepted `thread.activity-appended` kinds map from the outer orchestration
  event while preserving the activity turn ID and extracting a request ID from
  the activity payload, then event metadata.
- Every other event is ignored.
- Replaying the same event upserts by `eventId` and creates no duplicate.
- Thread revert does not erase audit history.

## Query behavior

Add a server persistence repository with:

- `upsert(entry)`
- `listByThreadId({ threadId, limit })`
- `deleteByThreadId({ threadId })`

`listByThreadId`:

- clamps callers to a maximum of 100 rows;
- returns newest first by `sequence`, then `eventId`;
- performs filtering and limiting in SQLite;
- never scans or serializes unrelated thread rows.

No new RPC or thread-shell field is added in this slice.

## Compatibility and performance

- Existing databases migrate additively.
- Existing web, desktop, mobile, relay, push, TWS, provider, and shell
  contracts remain unchanged.
- The projection cursor makes bootstrap incremental.
- The ledger contains one compact row per accepted orchestration event.
- No polling, timer, render-time derivation, or full-history shell payload is
  introduced.

## Acceptance criteria

1. Contract decoding accepts every listed kind and rejects unlisted kinds.
2. Migration 44 creates the table and thread/sequence index.
3. Repository upsert is idempotent by orchestration `eventId`.
4. Repository reads are newest-first and enforce the 100-row maximum.
5. Projection maps settled/unsettled, approval lifecycle, and user-input
   lifecycle events with the expected IDs and server sequence/timestamp.
6. Projection replay creates no duplicates.
7. Non-attention activities create no audit row.
8. Thread creation resets only that thread's projected audit rows.
9. Existing thread activities and client snapshots are byte-for-byte
   unaffected by the new audit projection.
10. Focused contract, migration, repository, and projection-pipeline tests
    pass with server/contracts typechecks and changed-file lint.

## Deferred work

- open/resolved `AttentionItem` lifecycle and source-key revisions;
- turn completion/failure, Git/TWS/hosting/disconnect sources;
- global acknowledgment and per-device seen receipts;
- shell summaries, RPCs, client attention queues, badges, and deep links;
- desktop/mobile notification sinks and APNs/FCM delivery ledgers;
- retention/export policy beyond existing local database lifecycle.
