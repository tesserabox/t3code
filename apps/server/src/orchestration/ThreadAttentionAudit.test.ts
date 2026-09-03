import {
  ApprovalRequestId,
  EventId,
  OrchestrationEvent,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  approvalRequestIdFromActivityPayload,
  threadAttentionAuditEntryFromEvent,
} from "./ThreadAttentionAudit.ts";

const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);

function activityEvent(input: {
  readonly kind: string;
  readonly payload?: unknown;
  readonly metadataRequestId?: string;
}) {
  return decodeEvent({
    sequence: 7,
    eventId: `event-${input.kind}`,
    aggregateKind: "thread",
    aggregateId: "thread-1",
    type: "thread.activity-appended",
    occurredAt: "2026-01-01T00:00:07.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: input.metadataRequestId ? { requestId: input.metadataRequestId } : {},
    payload: {
      threadId: "thread-1",
      activity: {
        id: `activity-${input.kind}`,
        tone: "approval",
        kind: input.kind,
        summary: "Attention changed",
        payload: input.payload ?? {},
        turnId: "turn-1",
        sequence: 3,
        createdAt: "2026-01-01T00:00:06.000Z",
      },
    },
  });
}

it("maps accepted activity lifecycle events without copying their payload", () => {
  const kinds = [
    "approval.requested",
    "approval.resolved",
    "provider.approval.respond.failed",
    "user-input.requested",
    "user-input.resolved",
    "provider.user-input.respond.failed",
  ] as const;

  for (const kind of kinds) {
    assert.deepEqual(
      threadAttentionAuditEntryFromEvent(
        activityEvent({
          kind,
          payload: { requestId: "request-from-payload", sensitive: "not persisted" },
          metadataRequestId: "request-from-metadata",
        }),
      ),
      {
        eventId: EventId.make(`event-${kind}`),
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        requestId: ApprovalRequestId.make("request-from-payload"),
        kind,
        sequence: 7,
        occurredAt: "2026-01-01T00:00:07.000Z",
      },
    );
  }
});

it("maps thread lifecycle and request-id fallback while ignoring routine activity", () => {
  const settled = decodeEvent({
    sequence: 8,
    eventId: "event-settled",
    aggregateKind: "thread",
    aggregateId: "thread-1",
    type: "thread.settled",
    occurredAt: "2026-01-01T00:00:08.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: "thread-1",
      settledAt: "2026-01-01T00:00:08.000Z",
      updatedAt: "2026-01-01T00:00:08.000Z",
    },
  });
  const unsettled = decodeEvent({
    sequence: 9,
    eventId: "event-unsettled",
    aggregateKind: "thread",
    aggregateId: "thread-1",
    type: "thread.unsettled",
    occurredAt: "2026-01-01T00:00:09.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: "thread-1",
      reason: "activity",
      updatedAt: "2026-01-01T00:00:09.000Z",
    },
  });

  assert.strictEqual(threadAttentionAuditEntryFromEvent(settled)?.kind, "thread.settled");
  assert.strictEqual(threadAttentionAuditEntryFromEvent(unsettled)?.kind, "thread.unsettled");
  assert.strictEqual(
    threadAttentionAuditEntryFromEvent(
      activityEvent({
        kind: "approval.requested",
        metadataRequestId: "request-from-metadata",
      }),
    )?.requestId,
    "request-from-metadata",
  );
  assert.strictEqual(
    threadAttentionAuditEntryFromEvent(activityEvent({ kind: "tool.updated" })),
    null,
  );
  assert.strictEqual(approvalRequestIdFromActivityPayload({ requestId: 42 }), null);
});
