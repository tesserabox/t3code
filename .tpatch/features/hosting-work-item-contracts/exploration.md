# Exploration: hosting-work-item-contracts

## Reused contract seams

- `packages/contracts/src/sourceControl.ts`
  - GitHub/Azure provider vocabulary, narrowed at the work-item boundary
- `packages/contracts/src/pullRequest.ts`
  - `PullRequestActor`
  - `PullRequestLabel`
  - host-scoped provider summary and bounded cursor/list patterns
  - HTTP 503/502 tagged error conventions
- `packages/contracts/src/baseSchemas.ts`
  - `ProjectId`, `PositiveInt`, `IsoDateTime`, `TrimmedNonEmptyString`
- `packages/contracts/src/environment.ts`
  - additive optional capability negotiation
- `packages/contracts/src/index.ts`
  - module export surface

## Minimal file set

Add:

- `packages/contracts/src/workItem.ts`
- `packages/contracts/src/workItem.test.ts`

Edit:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/environment.ts`
- `packages/contracts/src/environment.test.ts`

No server, RPC, settings, persistence, web, desktop, or mobile file changes.

## Implementation notes

- Use T3 `ProjectId` for environment-local routing and a separate
  provider-local `containerId` for GitHub repository / Azure project identity.
- Keep repository nullable because Azure Boards work items need not be
  repository-scoped.
- Require normalized `open | closed`, with optional provider-native state.
- Use host-scoped cursors and summaries to keep multiple installations of one
  provider kind separate.
- Use required nullable timestamps/author so unknown is explicit rather than
  omitted inconsistently.
- Keep list result JSON-codec-safe; avoid optional values inside open-keyed
  records.

## Tests

- GitHub and Azure examples.
- JSON codec round-trip.
- host separation.
- normalized/provider-native state behavior.
- list bounds for projects, limit, query, and cursors.
- partial errors beside healthy entries.
- unknown state/reason rejection.
- absent/present environment capability under version skew.

## Follow-up

A later server feature should define `WorkItemProvider`,
`WorkItemProviderRegistry`, and `WorkItemService`, then implement GitHub and
Azure adapters before adding RPC or advertising `workItems: true`.
