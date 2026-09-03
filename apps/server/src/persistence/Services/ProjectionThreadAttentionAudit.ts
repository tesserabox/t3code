/**
 * ProjectionThreadAttentionAuditRepository - Durable thread attention audit projection.
 *
 * Stores compact, non-sensitive transitions derived from orchestration events.
 *
 * @module ProjectionThreadAttentionAuditRepository
 */
import { OrchestrationThreadAttentionAuditEntry, PositiveInt, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ListProjectionThreadAttentionAuditInput = Schema.Struct({
  threadId: ThreadId,
  limit: PositiveInt,
});
export type ListProjectionThreadAttentionAuditInput =
  typeof ListProjectionThreadAttentionAuditInput.Type;

export const DeleteProjectionThreadAttentionAuditInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadAttentionAuditInput =
  typeof DeleteProjectionThreadAttentionAuditInput.Type;

export interface ProjectionThreadAttentionAuditRepositoryShape {
  readonly upsert: (
    entry: OrchestrationThreadAttentionAuditEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: ListProjectionThreadAttentionAuditInput,
  ) => Effect.Effect<
    ReadonlyArray<OrchestrationThreadAttentionAuditEntry>,
    ProjectionRepositoryError
  >;

  readonly deleteByThreadId: (
    input: DeleteProjectionThreadAttentionAuditInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadAttentionAuditRepository extends Context.Service<
  ProjectionThreadAttentionAuditRepository,
  ProjectionThreadAttentionAuditRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadAttentionAudit/ProjectionThreadAttentionAuditRepository",
) {}
