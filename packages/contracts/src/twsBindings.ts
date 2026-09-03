import * as Schema from "effect/Schema";

import { EnvironmentId, IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RepositoryIdentity } from "./environment.ts";

export const TWS_BINDING_MAX_LOCATORS = 32;
export const TWS_BINDING_MAX_LOCATOR_LENGTH = 4096;

export const TwsWorkspaceBindingId = TrimmedNonEmptyString.pipe(
  Schema.brand("TwsWorkspaceBindingId"),
);
export type TwsWorkspaceBindingId = typeof TwsWorkspaceBindingId.Type;

export const TwsFeatureBindingId = TrimmedNonEmptyString.pipe(Schema.brand("TwsFeatureBindingId"));
export type TwsFeatureBindingId = typeof TwsFeatureBindingId.Type;

export const TwsStackNodeBindingId = TrimmedNonEmptyString.pipe(
  Schema.brand("TwsStackNodeBindingId"),
);
export type TwsStackNodeBindingId = typeof TwsStackNodeBindingId.Type;

export const TwsLocatorKind = Schema.Literals([
  "stable-id",
  "registry-entry",
  "path",
  "name",
  "git-branch",
  "repository",
]);
export type TwsLocatorKind = typeof TwsLocatorKind.Type;

export const TwsLocator = Schema.Struct({
  kind: TwsLocatorKind,
  value: TrimmedNonEmptyString.check(Schema.isMaxLength(TWS_BINDING_MAX_LOCATOR_LENGTH)),
});
export type TwsLocator = typeof TwsLocator.Type;

export const TwsLocators = Schema.Array(TwsLocator).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TWS_BINDING_MAX_LOCATORS),
);
export type TwsLocators = typeof TwsLocators.Type;

const TwsBindingLifecycleFields = {
  environmentId: EnvironmentId,
  canonicalLocator: TwsLocator,
  locators: TwsLocators,
  repositoryIdentity: Schema.NullOr(RepositoryIdentity),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
} as const;

export const TwsWorkspaceBinding = Schema.Struct({
  workspaceBindingId: TwsWorkspaceBindingId,
  ...TwsBindingLifecycleFields,
});
export type TwsWorkspaceBinding = typeof TwsWorkspaceBinding.Type;

export const TwsWorkspaceProjectBinding = Schema.Struct({
  environmentId: EnvironmentId,
  workspaceBindingId: TwsWorkspaceBindingId,
  projectId: ProjectId,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});
export type TwsWorkspaceProjectBinding = typeof TwsWorkspaceProjectBinding.Type;

export const TwsFeatureBinding = Schema.Struct({
  featureBindingId: TwsFeatureBindingId,
  workspaceBindingId: TwsWorkspaceBindingId,
  ...TwsBindingLifecycleFields,
});
export type TwsFeatureBinding = typeof TwsFeatureBinding.Type;

export const TwsStackNodeBinding = Schema.Struct({
  stackNodeBindingId: TwsStackNodeBindingId,
  featureBindingId: TwsFeatureBindingId,
  projectId: Schema.NullOr(ProjectId),
  gitBranch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  archived: Schema.Boolean,
  ...TwsBindingLifecycleFields,
});
export type TwsStackNodeBinding = typeof TwsStackNodeBinding.Type;
