import {
  EnvironmentId,
  ProjectId,
  TwsFeatureBinding,
  TwsFeatureBindingId,
  TwsLocator,
  TwsStackNodeBinding,
  TwsWorkspaceBinding,
  TwsWorkspaceBindingId,
  TwsWorkspaceProjectBinding,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

const BindingQueryLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }));

const BindingListOptions = {
  includeRetired: Schema.optional(Schema.Boolean),
  limit: Schema.optional(BindingQueryLimit),
} as const;

export const ListTwsWorkspacesInput = Schema.Struct({
  environmentId: EnvironmentId,
  ...BindingListOptions,
});
export type ListTwsWorkspacesInput = typeof ListTwsWorkspacesInput.Type;

export const ListTwsWorkspaceProjectsInput = Schema.Struct({
  environmentId: EnvironmentId,
  workspaceBindingId: TwsWorkspaceBindingId,
  ...BindingListOptions,
});
export type ListTwsWorkspaceProjectsInput = typeof ListTwsWorkspaceProjectsInput.Type;

export const ListTwsProjectWorkspacesInput = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  ...BindingListOptions,
});
export type ListTwsProjectWorkspacesInput = typeof ListTwsProjectWorkspacesInput.Type;

export const ListTwsFeaturesInput = Schema.Struct({
  environmentId: EnvironmentId,
  workspaceBindingId: TwsWorkspaceBindingId,
  ...BindingListOptions,
});
export type ListTwsFeaturesInput = typeof ListTwsFeaturesInput.Type;

export const ListTwsStackNodesInput = Schema.Struct({
  environmentId: EnvironmentId,
  featureBindingId: TwsFeatureBindingId,
  ...BindingListOptions,
});
export type ListTwsStackNodesInput = typeof ListTwsStackNodesInput.Type;

export const FindTwsWorkspaceByLocatorInput = Schema.Struct({
  environmentId: EnvironmentId,
  locator: TwsLocator,
  ...BindingListOptions,
});
export type FindTwsWorkspaceByLocatorInput = typeof FindTwsWorkspaceByLocatorInput.Type;

export const FindTwsFeatureByLocatorInput = Schema.Struct({
  environmentId: EnvironmentId,
  workspaceBindingId: TwsWorkspaceBindingId,
  locator: TwsLocator,
  ...BindingListOptions,
});
export type FindTwsFeatureByLocatorInput = typeof FindTwsFeatureByLocatorInput.Type;

export const FindTwsStackNodeByLocatorInput = Schema.Struct({
  environmentId: EnvironmentId,
  featureBindingId: TwsFeatureBindingId,
  locator: TwsLocator,
  ...BindingListOptions,
});
export type FindTwsStackNodeByLocatorInput = typeof FindTwsStackNodeByLocatorInput.Type;

export const DeleteTwsWorkspaceInput = Schema.Struct({
  environmentId: EnvironmentId,
  workspaceBindingId: TwsWorkspaceBindingId,
});
export type DeleteTwsWorkspaceInput = typeof DeleteTwsWorkspaceInput.Type;

export interface TwsBindingRepositoryShape {
  readonly upsertWorkspace: (
    binding: TwsWorkspaceBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertWorkspaceProject: (
    binding: TwsWorkspaceProjectBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertFeature: (
    binding: TwsFeatureBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertStackNode: (
    binding: TwsStackNodeBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listWorkspaces: (
    input: ListTwsWorkspacesInput,
  ) => Effect.Effect<ReadonlyArray<TwsWorkspaceBinding>, ProjectionRepositoryError>;
  readonly listWorkspaceProjects: (
    input: ListTwsWorkspaceProjectsInput,
  ) => Effect.Effect<ReadonlyArray<TwsWorkspaceProjectBinding>, ProjectionRepositoryError>;
  readonly listProjectWorkspaces: (
    input: ListTwsProjectWorkspacesInput,
  ) => Effect.Effect<ReadonlyArray<TwsWorkspaceProjectBinding>, ProjectionRepositoryError>;
  readonly listFeatures: (
    input: ListTwsFeaturesInput,
  ) => Effect.Effect<ReadonlyArray<TwsFeatureBinding>, ProjectionRepositoryError>;
  readonly listStackNodes: (
    input: ListTwsStackNodesInput,
  ) => Effect.Effect<ReadonlyArray<TwsStackNodeBinding>, ProjectionRepositoryError>;
  readonly findWorkspacesByLocator: (
    input: FindTwsWorkspaceByLocatorInput,
  ) => Effect.Effect<ReadonlyArray<TwsWorkspaceBinding>, ProjectionRepositoryError>;
  readonly findFeaturesByLocator: (
    input: FindTwsFeatureByLocatorInput,
  ) => Effect.Effect<ReadonlyArray<TwsFeatureBinding>, ProjectionRepositoryError>;
  readonly findStackNodesByLocator: (
    input: FindTwsStackNodeByLocatorInput,
  ) => Effect.Effect<ReadonlyArray<TwsStackNodeBinding>, ProjectionRepositoryError>;
  readonly deleteWorkspace: (
    input: DeleteTwsWorkspaceInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class TwsBindingRepository extends Context.Service<
  TwsBindingRepository,
  TwsBindingRepositoryShape
>()("t3/persistence/Services/TwsBindings/TwsBindingRepository") {}
