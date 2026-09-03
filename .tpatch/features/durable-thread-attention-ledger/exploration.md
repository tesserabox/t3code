# Exploration: durable-thread-attention-ledger

## Existing seams

### Contracts

`packages/contracts/src/orchestration.ts` already defines:

- durable `EventId`, thread ID, event sequence, and `occurredAt` on every
  `OrchestrationEvent`;
- `thread.settled` and `thread.unsettled`;
- `thread.activity-appended`;
- activity turn IDs and unknown payloads;
- optional event metadata request IDs.

Provider runtime ingestion already converts approval and structured user-input
lifecycle events into activity kinds with stable provider event IDs. No
provider adapter change is needed.

### Persistence

Projection repositories use one service interface under
`apps/server/src/persistence/Services/` and one SQL implementation under
`apps/server/src/persistence/Layers/`. Upserts are encoded with `SqlSchema`,
errors are normalized through `toPersistenceSqlError` /
`toPersistenceDecodeError`, and focused repositories use
`SqlitePersistenceMemory` in tests.

The latest migration is 43 and is registered statically in
`apps/server/src/persistence/Migrations.ts`.

### Projection pipeline

`apps/server/src/orchestration/Layers/ProjectionPipeline.ts` gives each
projection:

- a named independent cursor in `projection_state`;
- one transaction per event/projector;
- incremental bootstrap from the last sequence;
- ordered application and replay.

The existing thread-activity projector must remain unchanged because those
rows are visible timeline data.

## Chosen implementation

### Contract additions

Edit:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/orchestration.test.ts`

Add the closed attention-audit kind and compact entry schemas from `spec.md`.
Do not add a thread-shell or RPC field.

### Dedicated projection storage

Add:

- `apps/server/src/persistence/Migrations/044_ProjectionThreadAttentionAudit.ts`
- `apps/server/src/persistence/Migrations/044_ProjectionThreadAttentionAudit.test.ts`
- `apps/server/src/persistence/Services/ProjectionThreadAttentionAudit.ts`
- `apps/server/src/persistence/Layers/ProjectionThreadAttentionAudit.ts`
- `apps/server/src/persistence/Layers/ProjectionThreadAttentionAudit.test.ts`

Edit:

- `apps/server/src/persistence/Migrations.ts`

The repository exposes `upsert`, bounded newest-first `listByThreadId`, and
`deleteByThreadId`. The SQL layer clamps limits to 100 and uses the
thread/sequence index.

### Pure event mapping

Add:

- `apps/server/src/orchestration/ThreadAttentionAudit.ts`
- `apps/server/src/orchestration/ThreadAttentionAudit.test.ts`

The mapper returns one compact entry or `null`:

- direct mapping for settled/unsettled;
- accepted activity-kind mapping using the outer orchestration event ID,
  sequence, and timestamp;
- turn ID from the activity;
- request ID from the activity payload, then event metadata;
- no arbitrary payload copying.

The switch over accepted kinds provides type narrowing without assertions.

### Projection integration

Edit:

- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`

Add:

- `ORCHESTRATION_PROJECTOR_NAMES.threadAttentionAudit`;
- repository service acquisition and live-layer provisioning;
- one projector that clears on `thread.created`, maps accepted events, and
  upserts by event ID;
- focused pipeline assertions for exact rows, ignored routine activity, and
  replay idempotency.

Do not edit:

- in-memory `projector.ts`;
- `ProjectionSnapshotQuery.ts`;
- thread shell schemas;
- client-runtime, web, desktop, mobile, relay, or provider adapters.

## Test plan

1. Contract kind/entry decode and unknown-kind rejection.
2. Migration 43 -> 44 table/index creation.
3. Repository upsert replacement, newest-first ordering, limit clamping, and
   per-thread deletion.
4. Pure mapper coverage for every accepted kind, request-ID fallback, and
   ignored activity.
5. Pipeline bootstrap and replay coverage with no duplicate rows.
6. Existing projection tests prove visible activities and shell snapshots are
   unchanged.
7. Targeted contracts/server typechecks and changed-file lint.

## Expected patch shape

One contract file/test, one migration registration, two migration files, two
repository files plus test, one pure mapper plus test, and the projection
pipeline plus test. No client or provider surface is added.
