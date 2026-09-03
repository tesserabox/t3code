# Specification: tws-readonly-cli-adapter

## Scope

Add a server-internal, read-only adapter for the installed TWS `v1.2.14`
public CLI contract. This feature does not persist product bindings or expose a
client API.

## Service API

Provide a `TwsCliAdapter` Effect service with:

- `probe()`
- `listRegistry()`
- `checkRegistry()`
- `readStatus({ cwd, feature? })`
- `readStackStatus({ cwd, feature })`

Every command uses `ProcessRunner` with executable `tws`, direct argument
arrays, a bounded timeout, and bounded output.

## Allowed commands

The adapter may invoke only:

- `tws --version`
- `tws registry list --json`
- `tws registry check --json`
- `tws status --json`
- `tws status <feature> --json`
- `tws stack status <feature> --json`

No TWS mutator or internal-file read is permitted.

## Version and execution rules

- Supported CLI version is exactly `v1.2.14`.
- Report methods verify the supported version before invoking report commands.
- A successful version is cached for the adapter lifetime; failures are not
  cached.
- Nonzero exit means no report. Do not parse stdout, even when it contains
  valid JSON.
- Canonicalize and deduplicate nonempty stdout/stderr error lines, stripping a
  leading `Error:` prefix.
- Empty failure output produces one synthetic exit-status message.
- Invalid UTF-8 or output-limit failures remain explicit typed errors.

## Registry decoding

Registry list is an unversioned array of entries. Registry check is an
unversioned array of `{ entry, status }` objects.

Known entry fields:

- `id`
- `path`
- `aliases`
- `kind`
- `git_identity`
- `marker_id`
- `added_at`
- `updated_at`

Return normalized camel-case fields plus the complete raw object so additive
keys survive.

## Status and stack decoding

- Parse JSON with Effect Schema.
- Require a top-level object.
- Accept only integer `schema_version: 1`.
- Status requires:
  `schema_version`, `generated_at`, `workspace`, `features`, `issues`,
  `summary`.
- Stack status requires:
  `schema_version`, `workspace`, `feature`, `entries`, `summary`.
- Preserve the complete raw report object.
- Recursively observe raw:
  - `runtime_presence`
  - `agent_state`
  - `attention.status`
- Known raw values:
  - runtime: `present`, `absent`, `stale`, `unknown`
  - agent: `working`, `ready`, `blocked`, `done`, `unknown`
  - attention: `needs_attention`, `active`, `idle`
- Unknown values do not reject the report. Record their path/raw value and
  normalize only the derived observation to `unknown`.
- Derive `twsNeedsAttention` from any nested
  `attention.status = needs_attention` or a positive status summary
  `needs_attention` count.
- Do not combine this value with provider/session state.

## Errors

Expose typed errors for:

- process execution;
- nonzero TWS command exit;
- malformed version output;
- unsupported CLI version;
- invalid JSON/object shape;
- unsupported report schema version;
- missing required keys;
- invalid registry entry/check shapes.

Errors must not contain raw full command output or shell-concatenated
arguments.

## Acceptance criteria

1. Tests prove the exact allowed argument arrays.
2. Supported version succeeds and is cached only after success.
3. Unsupported/malformed versions fail explicitly.
4. Registry list/check captured shapes decode and preserve additive fields.
5. Status and stack schema version 1 decode.
6. Schema version 2 is rejected.
7. Missing required keys and invalid JSON are rejected.
8. Additive top-level/nested keys remain in `raw`.
9. Unknown enums remain raw and produce normalized unknown observations.
10. Nonzero exit ignores valid JSON stdout.
11. Duplicate stdout/stderr errors produce one canonical failure item.
12. TWS attention is derived independently from a caller's provider state.
13. Focused tests, server typecheck, and changed-file lint pass.

## Deferred

- product-owned workspace/feature/stack/worktree IDs and persistence;
- cache TTL/polling policy and filesystem invalidation;
- TWS issue-to-attention mapping;
- launch occupancy policy;
- RPC/client UI;
- decisions/export links;
- all TWS mutations.
