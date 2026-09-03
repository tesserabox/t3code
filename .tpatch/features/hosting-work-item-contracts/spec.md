# Specification: hosting-work-item-contracts

## Scope

Define read-only provider-neutral contracts for GitHub Issues and Azure DevOps
Boards. No server implementation or RPC is added.

## Shared primitives

- `WorkItemProviderKind` is the supported subset
  `github | azure-devops` from `SourceControlProviderKind`.
- `WorkItemActor` aliases `PullRequestActor`.
- `WorkItemLabel` aliases `PullRequestLabel`.
- `WorkItemKind`: `issue | work-item`.
- `WorkItemState`: `open | closed`.
- `WorkItemListState`: `all | open | closed`.

## Reference and rows

`WorkItemRef` contains:

- T3 `projectId`;
- provider and host;
- provider-local `containerId`;
- positive item number.

`containerId` is the GitHub repository identity or Azure DevOps project
identity used by the adapter. It is not a T3 primary key.

`WorkItemListEntry` is a discriminated union:

- GitHub: `provider: github`, `kind: issue`, repository required.
- Azure Boards: `provider: azure-devops`, `kind: work-item`, repository null.

Both variants add:

- `projectTitle`;
- `kind`;
- `containerTitle`;
- nullable repository locator;
- title and URL;
- normalized state;
- optional provider-native state;
- nullable author;
- labels;
- nullable created/updated timestamps.

`WorkItemDetail` extends the list row with a body string.

## Listing

`WorkItemListInput` supports:

- state;
- optional one project or up to 100 project IDs;
- optional host;
- optional limit from 1 to 500;
- optional per-host/container cursors bounded to 4096 characters;
- optional trimmed query bounded to 200 characters.

`WorkItemListResult` contains:

- provider summaries;
- entries;
- partial per-project errors;
- truncation flag;
- next cursors.

Provider summaries are host-scoped so GitHub.com and GitHub Enterprise remain
separate accounts.

## Errors

- `WorkItemProviderErrorReason`:
  `missing-tool | unauthenticated | rate-limited | failed`.
- List project errors identify the T3 project, provider, reason, and a
  sanitized message.
- `WorkItemUnavailableError` is a typed HTTP 503 contract whose message is
  derived from the closed reason rather than arbitrary provider output.
- `WorkItemOperationError` is a typed HTTP 502 contract.

No raw CLI/API output or credentials belong in these shapes.

## Capability

Add optional `workItems` to `ExecutionEnvironmentCapabilities`. It remains
absent until a server actually registers work-item providers and RPCs.

## Acceptance criteria

1. GitHub Issue and Azure Boards examples decode through one common schema.
2. JSON codec round-trip preserves the complete list result.
3. GitHub repository and Azure project containers remain explicit and
   provider-scoped.
4. Provider-native states can be retained without widening normalized
   `open/closed`.
5. Host-scoped provider summaries keep multiple hosts of one kind separate.
6. Project list, limit, query, and cursor bounds are enforced.
7. Partial errors coexist with healthy entries.
8. Unknown normalized states and error reasons are rejected.
9. Older environment descriptors decode without `workItems`.
10. No RPC, provider implementation, credential storage, UI, comments, or
    mutations are introduced.
11. Focused contracts tests, typecheck, and lint pass.

## Deferred

- provider/service registries;
- GitHub and Azure CLI/API adapters;
- RPC and server capability advertisement;
- detail fetching, comments, relations, builds, and mutations;
- client UI and refresh policy.
