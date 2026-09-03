# Specification: phase1-foundation

## Included behavior

The consolidated patch contains exactly:

- durable compact thread attention audit contracts, migration, repository,
  mapper, and projection;
- read-only TWS `v1.2.14` CLI adapter and decoder;
- GitHub Issue / Azure Boards provider-neutral contracts;
- environment-scoped TWS workspace/project/feature/stack-node bindings,
  persistence, and ambiguity-safe locator matching.

## Dependency model

Hard parents:

- `copilot-cli-provider`
- `session-search`

Superseded granular Phase 1 records:

- `durable-thread-attention-ledger`
- `tws-readonly-cli-adapter`
- `hosting-work-item-contracts`
- `tws-identity-bindings`

Superseded historical Copilot children already covered by the Copilot root:

- `copilot-plan-compaction`
- `copilot-skill-discovery`
- `copilot-text-generation`
- `copilot-tool-detail`
- `copilot-turn-timing`

## Acceptance criteria

1. The patch is generated from the verified Phase 0 tip and contains only the
   30 reviewed Phase 1 source/test files.
2. Applying it recreates the current integrated non-tpatch tree byte-for-byte.
3. All 173 combined focused tests pass.
4. Contracts and server typechecks pass.
5. Changed-file lint is clean.
6. The single-parent landing and recipe replay verify.
7. The superseder is active and healthy, removing granular/covered child
   records from default replay without deleting audit history.
8. No new UI, RPC, relay, push, provider, TWS mutation, or target-platform
   behavior is claimed.

## External gates

Linux, Windows, and Windows+WSL execution remain documented target-host gates.
The consolidation feature does not alter or waive them.
