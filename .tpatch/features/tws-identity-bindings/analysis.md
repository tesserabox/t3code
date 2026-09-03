# Analysis: tws-identity-bindings

## Summary

The read-only TWS adapter can now observe registry, workspace, feature, and
stack topology, but T3 has no durable product identity for that topology.
Using TWS names or paths directly would make renames, archived worktrees,
multi-repo features, and cross-machine grouping unsafe.

This slice adds opaque environment-owned binding records and persistence. It
does not automatically reconcile or expose them to clients yet.

## Compatibility

- Additive contracts and SQLite tables.
- No changes to project/thread primary keys, repository routing, TWS files, or
  provider state.
- Existing databases migrate forward with empty binding tables.
- Bindings are scoped by `EnvironmentId`; this database remains authoritative
  only for its own environment.
- Repository identity is nullable metadata for grouping and must never be used
  to select a local path or binding.

## Required entities

- workspace binding;
- workspace-to-T3-project association;
- feature binding parented by workspace;
- stack-node binding parented by feature, with optional T3 project,
  repository identity, and materialized worktree path.

Every entity has an opaque branded ID, a canonical locator, retained alternate
locators, first/last seen timestamps, and nullable retirement timestamp.

## Locator rules

- Known locator kinds:
  `stable-id`, `registry-entry`, `path`, `name`, `git-branch`, `repository`.
- Locators are bounded and deduplicated.
- A locator match can suggest one binding, no binding, or ambiguity.
- Ambiguity never auto-merges records.
- Changing repository identity never re-routes a binding.

## Risks

- Feature names are not globally unique; parent workspace is mandatory.
- Stack entries can repeat branch names across repositories; parent feature and
  optional project/repository metadata remain explicit.
- Archived nodes may have no worktree path.
- Generic nullable tables would blur invariants, so workspace, feature,
  project-association, and stack-node storage remain distinct.

## Recommendation

Proceed with contracts, migration 45, one repository service/layer, and a pure
locator matcher. Defer adapter-driven refresh/reconciliation, RPC, UI, and TWS
attention mapping.
