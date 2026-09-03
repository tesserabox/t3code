import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { IsoDateTime, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";

export const WorkItemProviderKind = Schema.Literals(["github", "azure-devops"]);
export type WorkItemProviderKind = typeof WorkItemProviderKind.Type;

export const WorkItemActor = PullRequestActor;
export type WorkItemActor = typeof WorkItemActor.Type;

export const WorkItemLabel = PullRequestLabel;
export type WorkItemLabel = typeof WorkItemLabel.Type;

export const WorkItemKind = Schema.Literals(["issue", "work-item"]);
export type WorkItemKind = typeof WorkItemKind.Type;

export const WorkItemState = Schema.Literals(["open", "closed"]);
export type WorkItemState = typeof WorkItemState.Type;

export const WorkItemListState = Schema.Literals(["all", "open", "closed"]);
export type WorkItemListState = typeof WorkItemListState.Type;

const WorkItemRefFields = {
  projectId: ProjectId,
  host: TrimmedNonEmptyString,
  containerId: TrimmedNonEmptyString,
  number: PositiveInt,
} as const;

export const GitHubWorkItemRef = Schema.Struct({
  ...WorkItemRefFields,
  provider: Schema.Literal("github"),
});
export type GitHubWorkItemRef = typeof GitHubWorkItemRef.Type;

export const AzureDevOpsWorkItemRef = Schema.Struct({
  ...WorkItemRefFields,
  provider: Schema.Literal("azure-devops"),
});
export type AzureDevOpsWorkItemRef = typeof AzureDevOpsWorkItemRef.Type;

export const WorkItemRef = Schema.Union([GitHubWorkItemRef, AzureDevOpsWorkItemRef]);
export type WorkItemRef = typeof WorkItemRef.Type;

const WorkItemListEntryFields = {
  ...WorkItemRefFields,
  projectTitle: TrimmedNonEmptyString,
  containerTitle: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: WorkItemState,
  providerState: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
  author: Schema.NullOr(WorkItemActor),
  labels: Schema.Array(WorkItemLabel),
  createdAt: Schema.NullOr(IsoDateTime),
  updatedAt: Schema.NullOr(IsoDateTime),
} as const;

export const GitHubWorkItemListEntry = Schema.Struct({
  ...WorkItemListEntryFields,
  provider: Schema.Literal("github"),
  kind: Schema.Literal("issue"),
  repository: TrimmedNonEmptyString,
});
export type GitHubWorkItemListEntry = typeof GitHubWorkItemListEntry.Type;

export const AzureDevOpsWorkItemListEntry = Schema.Struct({
  ...WorkItemListEntryFields,
  provider: Schema.Literal("azure-devops"),
  kind: Schema.Literal("work-item"),
  repository: Schema.Null,
});
export type AzureDevOpsWorkItemListEntry = typeof AzureDevOpsWorkItemListEntry.Type;

export const WorkItemListEntry = Schema.Union([
  GitHubWorkItemListEntry,
  AzureDevOpsWorkItemListEntry,
]);
export type WorkItemListEntry = typeof WorkItemListEntry.Type;

export const GitHubWorkItemDetail = Schema.Struct({
  ...GitHubWorkItemListEntry.fields,
  body: Schema.String,
});
export type GitHubWorkItemDetail = typeof GitHubWorkItemDetail.Type;

export const AzureDevOpsWorkItemDetail = Schema.Struct({
  ...AzureDevOpsWorkItemListEntry.fields,
  body: Schema.String,
});
export type AzureDevOpsWorkItemDetail = typeof AzureDevOpsWorkItemDetail.Type;

export const WorkItemDetail = Schema.Union([GitHubWorkItemDetail, AzureDevOpsWorkItemDetail]);
export type WorkItemDetail = typeof WorkItemDetail.Type;

export const WorkItemListCursors = Schema.Record(
  TrimmedNonEmptyString,
  TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
);
export type WorkItemListCursors = typeof WorkItemListCursors.Type;

export const WorkItemListInput = Schema.Struct({
  state: WorkItemListState,
  projectId: Schema.optional(ProjectId),
  projectIds: Schema.optional(Schema.Array(ProjectId).check(Schema.isMaxLength(100))),
  host: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  cursors: Schema.optional(WorkItemListCursors),
  query: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type WorkItemListInput = typeof WorkItemListInput.Type;

export const WorkItemProviderSummary = Schema.Struct({
  host: TrimmedNonEmptyString,
  kind: WorkItemProviderKind,
  searchesOnHost: Schema.Boolean,
  projectCount: PositiveInt,
  configured: Schema.Boolean,
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkItemProviderSummary = typeof WorkItemProviderSummary.Type;

export const WorkItemProviderErrorReason = Schema.Literals([
  "missing-tool",
  "unauthenticated",
  "rate-limited",
  "failed",
]);
export type WorkItemProviderErrorReason = typeof WorkItemProviderErrorReason.Type;

export const WorkItemListProjectError = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  provider: WorkItemProviderKind,
  reason: WorkItemProviderErrorReason,
  message: TrimmedNonEmptyString,
});
export type WorkItemListProjectError = typeof WorkItemListProjectError.Type;

export const WorkItemListResult = Schema.Struct({
  providers: Schema.Array(WorkItemProviderSummary),
  entries: Schema.Array(WorkItemListEntry),
  errors: Schema.Array(WorkItemListProjectError),
  truncated: Schema.Boolean,
  nextCursors: WorkItemListCursors,
});
export type WorkItemListResult = typeof WorkItemListResult.Type;

export class WorkItemUnavailableError extends Schema.TaggedErrorClass<WorkItemUnavailableError>()(
  "WorkItemUnavailableError",
  {
    reason: WorkItemProviderErrorReason,
    provider: Schema.optional(WorkItemProviderKind),
    host: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(WorkItemUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    switch (this.reason) {
      case "missing-tool":
        return "The tool required to read work items is not installed or configured.";
      case "unauthenticated":
        return "The work-item provider has no working credentials.";
      case "rate-limited":
        return "The work-item provider rate limit has been reached.";
      case "failed":
        return "The work-item provider is unavailable.";
    }
  }
}

export class WorkItemOperationError extends Schema.TaggedErrorClass<WorkItemOperationError>()(
  "WorkItemOperationError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(WorkItemOperationError)(this, { status: 502 });
  }

  override get message(): string {
    return `Work item operation ${this.operation} failed: ${this.detail}`;
  }
}
