import { OrchestrationThreadAttentionAuditEntry } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadAttentionAuditInput,
  ListProjectionThreadAttentionAuditInput,
  ProjectionThreadAttentionAuditRepository,
  type ProjectionThreadAttentionAuditRepositoryShape,
} from "../Services/ProjectionThreadAttentionAudit.ts";

const MAX_THREAD_ATTENTION_AUDIT_ROWS = 100;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionThreadAttentionAuditRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadAttentionAuditRow = SqlSchema.void({
    Request: OrchestrationThreadAttentionAuditEntry,
    execute: (entry) =>
      sql`
        INSERT INTO projection_thread_attention_audit (
          event_id,
          thread_id,
          turn_id,
          request_id,
          kind,
          sequence,
          occurred_at
        )
        VALUES (
          ${entry.eventId},
          ${entry.threadId},
          ${entry.turnId},
          ${entry.requestId},
          ${entry.kind},
          ${entry.sequence},
          ${entry.occurredAt}
        )
        ON CONFLICT (event_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          request_id = excluded.request_id,
          kind = excluded.kind,
          sequence = excluded.sequence,
          occurred_at = excluded.occurred_at
      `,
  });

  const listProjectionThreadAttentionAuditRows = SqlSchema.findAll({
    Request: ListProjectionThreadAttentionAuditInput,
    Result: OrchestrationThreadAttentionAuditEntry,
    execute: ({ threadId, limit }) =>
      sql`
        SELECT
          event_id AS "eventId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          request_id AS "requestId",
          kind,
          sequence,
          occurred_at AS "occurredAt"
        FROM projection_thread_attention_audit
        WHERE thread_id = ${threadId}
        ORDER BY sequence DESC, event_id DESC
        LIMIT ${Math.min(limit, MAX_THREAD_ATTENTION_AUDIT_ROWS)}
      `,
  });

  const deleteProjectionThreadAttentionAuditRows = SqlSchema.void({
    Request: DeleteProjectionThreadAttentionAuditInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_attention_audit
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadAttentionAuditRepositoryShape["upsert"] = (entry) =>
    upsertProjectionThreadAttentionAuditRow(entry).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadAttentionAuditRepository.upsert:query",
          "ProjectionThreadAttentionAuditRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ProjectionThreadAttentionAuditRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadAttentionAuditRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionThreadAttentionAuditRepository.listByThreadId:query",
          "ProjectionThreadAttentionAuditRepository.listByThreadId:decodeRows",
        ),
      ),
    );

  const deleteByThreadId: ProjectionThreadAttentionAuditRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionThreadAttentionAuditRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadAttentionAuditRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadAttentionAuditRepositoryShape;
});

export const ProjectionThreadAttentionAuditRepositoryLive = Layer.effect(
  ProjectionThreadAttentionAuditRepository,
  makeProjectionThreadAttentionAuditRepository,
);
