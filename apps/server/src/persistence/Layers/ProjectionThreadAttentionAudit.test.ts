import { ApprovalRequestId, EventId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionThreadAttentionAuditRepository } from "../Services/ProjectionThreadAttentionAudit.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionThreadAttentionAuditRepositoryLive } from "./ProjectionThreadAttentionAudit.ts";

const layer = it.layer(
  ProjectionThreadAttentionAuditRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadAttentionAuditRepository", (it) => {
  it.effect("upserts idempotently and bounds newest-first reads", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadAttentionAuditRepository;
      const threadId = ThreadId.make("thread-attention-audit");

      yield* Effect.forEach(
        Array.from({ length: 105 }, (_, index) => index + 1),
        (sequence) =>
          repository.upsert({
            eventId: EventId.make(`event-${String(sequence).padStart(3, "0")}`),
            threadId,
            turnId: sequence === 105 ? TurnId.make("turn-latest") : null,
            requestId: null,
            kind: sequence % 2 === 0 ? "thread.settled" : "thread.unsettled",
            sequence,
            occurredAt: "2026-01-01T00:00:00.000Z",
          }),
        { concurrency: 1 },
      );

      const bounded = yield* repository.listByThreadId({ threadId, limit: 1_000 });
      assert.strictEqual(bounded.length, 100);
      assert.strictEqual(bounded[0]?.sequence, 105);
      assert.strictEqual(bounded.at(-1)?.sequence, 6);

      yield* repository.upsert({
        eventId: EventId.make("event-105"),
        threadId,
        turnId: TurnId.make("turn-latest"),
        requestId: ApprovalRequestId.make("request-latest"),
        kind: "approval.resolved",
        sequence: 105,
        occurredAt: "2026-01-02T00:00:00.000Z",
      });

      const latest = yield* repository.listByThreadId({ threadId, limit: 1 });
      assert.deepEqual(latest, [
        {
          eventId: EventId.make("event-105"),
          threadId,
          turnId: TurnId.make("turn-latest"),
          requestId: ApprovalRequestId.make("request-latest"),
          kind: "approval.resolved",
          sequence: 105,
          occurredAt: "2026-01-02T00:00:00.000Z",
        },
      ]);
    }),
  );

  it.effect("deletes only the selected thread ledger", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadAttentionAuditRepository;
      const firstThreadId = ThreadId.make("thread-attention-delete-1");
      const secondThreadId = ThreadId.make("thread-attention-delete-2");

      for (const [eventId, threadId] of [
        [EventId.make("event-delete-1"), firstThreadId],
        [EventId.make("event-delete-2"), secondThreadId],
      ] as const) {
        yield* repository.upsert({
          eventId,
          threadId,
          turnId: null,
          requestId: null,
          kind: "thread.settled",
          sequence: 1,
          occurredAt: "2026-01-01T00:00:00.000Z",
        });
      }

      yield* repository.deleteByThreadId({ threadId: firstThreadId });

      assert.deepEqual(
        yield* repository.listByThreadId({ threadId: firstThreadId, limit: 10 }),
        [],
      );
      assert.strictEqual(
        (yield* repository.listByThreadId({ threadId: secondThreadId, limit: 10 })).length,
        1,
      );
    }),
  );
});
