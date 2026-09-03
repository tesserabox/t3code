# Exploration: tws-identity-bindings

## File set

Add:

- `packages/contracts/src/twsBindings.ts`
- `packages/contracts/src/twsBindings.test.ts`
- `apps/server/src/persistence/Migrations/045_TwsBindings.ts`
- `apps/server/src/persistence/Migrations/045_TwsBindings.test.ts`
- `apps/server/src/persistence/Services/TwsBindings.ts`
- `apps/server/src/persistence/Layers/TwsBindings.ts`
- `apps/server/src/persistence/Layers/TwsBindings.test.ts`
- `apps/server/src/tws/TwsBindingMatch.ts`
- `apps/server/src/tws/TwsBindingMatch.test.ts`

Edit:

- `packages/contracts/src/index.ts`
- `apps/server/src/persistence/Migrations.ts`

## Patterns

- Brand IDs locally in `twsBindings.ts` using `TrimmedNonEmptyString` and
  `Schema.brand`.
- Follow migration 44 and the attention repository for migration/service/layer
  error handling and tests.
- Store locators and repository identity as JSON with typed decode on reads.
- Use SQLite `json_each` only for exact locator kind/value lookup.
- Delete a workspace subtree inside one SQL transaction in the repository
  layer.

## Repository boundaries

One service owns all four tables so workspace deletion and cross-table
consistency remain atomic. It does not generate IDs or call TWS; callers supply
environment-owned IDs and observations.

## Matching boundaries

The pure matcher consumes candidate binding IDs returned by the repository.
It never chooses based on repository identity. Automatic rename handling is
limited to the caller reusing a uniquely matched product ID and merging
locators; ambiguous matches remain unresolved.

## Tests

- contract JSON round-trip and bounds;
- migration table/index presence;
- complete multi-repo workspace/feature/node round-trip;
- archived/unmaterialized node;
- same names under different parents;
- exact alternate-locator lookup;
- retired filtering;
- locator update under stable ID;
- workspace subtree deletion;
- pure new/matched/ambiguous outcomes and deterministic locator merge.

## Explicit non-changes

No orchestration event, project/thread schema, TWS adapter behavior, server
layer composition, RPC, client, relay, or notification code changes.
