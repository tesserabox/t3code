# Specification: tws-identity-bindings

## Scope

Persist product-owned TWS identity bindings. This feature adds no adapter
refresh loop, RPC, UI, notification, or TWS mutation.

## Contracts

Add `packages/contracts/src/twsBindings.ts` with branded:

- `TwsWorkspaceBindingId`
- `TwsFeatureBindingId`
- `TwsStackNodeBindingId`

Add:

- `TwsLocatorKind`:
  `stable-id | registry-entry | path | name | git-branch | repository`
- `TwsLocator` with bounded nonempty value.
- `TwsWorkspaceBinding`
- `TwsWorkspaceProjectBinding`
- `TwsFeatureBinding`
- `TwsStackNodeBinding`

Workspace, feature, and stack-node records contain:

- opaque product ID;
- `EnvironmentId`;
- canonical locator;
- nonempty bounded alternate locator list;
- nullable grouping-only `RepositoryIdentity`;
- first/last seen timestamps;
- nullable retirement timestamp.

Feature records also contain the parent workspace ID.

Stack nodes also contain:

- parent feature ID;
- nullable T3 `ProjectId`;
- Git branch;
- nullable worktree path;
- archived flag.

Workspace-project associations contain first/last seen and retirement
timestamps.

## Migration 45

Create:

- `tws_workspace_bindings`
- `tws_workspace_project_bindings`
- `tws_feature_bindings`
- `tws_stack_node_bindings`

Each entity table stores canonical locator columns for indexing plus
`locators_json`. Repository identity remains nullable JSON metadata.

Required indexes:

- workspace by environment/canonical locator and environment/retired state;
- project association by project;
- feature by environment/workspace/canonical locator and retired state;
- stack node by environment/feature/canonical locator, project, and retired
  state.

Do not make mutable locator columns unique or primary keys.

## Repository

Add one `TwsBindingRepository` with:

- upsert workspace/project association/feature/stack node;
- list workspaces by environment;
- list workspace projects;
- list features by workspace;
- list stack nodes by feature;
- find workspace/feature/stack-node candidates by exact locator;
- delete one workspace and all child associations/features/nodes in a
  transaction.

List/find inputs are bounded to 500 rows and exclude retired records unless
`includeRetired` is true.

Locator matching occurs in SQLite against canonical columns or `json_each`
over `locators_json`.

## Pure matching

Add a pure helper that:

- returns `new` for zero matching IDs;
- returns `matched` for exactly one ID;
- returns `ambiguous` with sorted unique IDs for multiple matches;
- ignores repository identity;
- merges locators deterministically with canonical first and exact
  kind/value deduplication.

No ambiguous result performs a write.

## Acceptance criteria

1. Contract IDs reject empty values.
2. Locator arrays require 1-32 entries and values are bounded.
3. Migration 45 creates all tables and indexes.
4. Workspace, feature, project association, and stack-node rows round-trip.
5. One feature can contain nodes from multiple projects/repositories.
6. Archived nodes round-trip with a null worktree path.
7. Updating locators under the same product ID preserves that ID.
8. Same feature/branch names in different parent scopes remain separate.
9. Locator lookup returns every active candidate and does not consult
   repository identity.
10. Pure matching refuses ambiguity.
11. Deleting a workspace removes only its complete binding subtree.
12. Existing project/thread/repository/TWS behavior is unchanged.
13. Focused contracts, migration, repository, and matcher tests plus
    contracts/server typechecks and lint pass.

## Deferred

- adapter-driven observation/reconciliation and retirement;
- rename confirmation UI;
- snapshot/RPC/client exposure;
- TWS issue-to-attention mapping;
- occupancy warnings and launch policy;
- decisions/export links;
- TWS mutations.
