# Analysis: hosting-work-item-contracts

## Summary

T3 already has provider discovery, repository identity, pull-request contracts,
provider registries, bounded cross-project listing, and environment-owned
credentials for GitHub and Azure DevOps. It has no provider-neutral issue/work
item vocabulary.

The smallest Phase 1 slice is contract-only. It should define a normalized
read model and adapter boundary without adding dead RPC methods or claiming
that any server currently implements work-item browsing.

## Compatibility

- Additive `packages/contracts` schema and tests.
- Optional environment capability remains absent until a later server feature
  advertises a real implementation.
- Reuse the GitHub/Azure values from `SourceControlProviderKind`, plus
  `ProjectId`, `PullRequestActor`, and `PullRequestLabel`, without accepting
  unsupported provider kinds at the work-item boundary.
- No provider CLI/API calls, credential handling, server registry, persistence,
  UI, or mutation behavior changes.

## Constraints

- GitHub Issues are repository-scoped; Azure Boards work items are project-
  scoped. The common contract needs an explicit provider-local container
  identity rather than pretending both are repositories.
- Normalize state only to `open` or `closed`; retain provider-native state as
  optional context.
- Every entry remains scoped to a T3 `ProjectId` and host.
- Search and continuation tokens are bounded because later adapters place them
  into CLI arguments or HTTP queries.
- Partial per-project failures must coexist with healthy entries.
- Authentication remains environment-owned and only summarized later.

## Recommendation

Proceed with one new `workItem.ts` contract module, JSON-codec tests, an index
export, and an optional `workItems` environment capability. Defer RPC and
provider services until GitHub and Azure adapters exist.
