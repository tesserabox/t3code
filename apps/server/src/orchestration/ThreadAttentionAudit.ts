import {
  ApprovalRequestId,
  type OrchestrationEvent,
  type OrchestrationThreadAttentionAuditEntry,
  type OrchestrationThreadAttentionAuditKind,
} from "@t3tools/contracts";

export function approvalRequestIdFromActivityPayload(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : null;
}

function attentionActivityKind(kind: string): OrchestrationThreadAttentionAuditKind | null {
  switch (kind) {
    case "approval.requested":
    case "approval.resolved":
    case "provider.approval.respond.failed":
    case "user-input.requested":
    case "user-input.resolved":
    case "provider.user-input.respond.failed":
      return kind;
    default:
      return null;
  }
}

export function threadAttentionAuditEntryFromEvent(
  event: OrchestrationEvent,
): OrchestrationThreadAttentionAuditEntry | null {
  switch (event.type) {
    case "thread.settled":
    case "thread.unsettled":
      return {
        eventId: event.eventId,
        threadId: event.payload.threadId,
        turnId: null,
        requestId: null,
        kind: event.type,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
      };

    case "thread.activity-appended": {
      const kind = attentionActivityKind(event.payload.activity.kind);
      if (kind === null) {
        return null;
      }
      return {
        eventId: event.eventId,
        threadId: event.payload.threadId,
        turnId: event.payload.activity.turnId,
        requestId:
          approvalRequestIdFromActivityPayload(event.payload.activity.payload) ??
          event.metadata.requestId ??
          null,
        kind,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
      };
    }

    default:
      return null;
  }
}
