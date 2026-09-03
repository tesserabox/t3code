# Analysis: tws-readonly-cli-adapter

## Summary

T3 has no TWS integration today. Phase 0 proved a stable read-only contract
against installed TWS `v1.2.14`, including versioned status/stack JSON,
unversioned registry arrays, additive fields, unknown enums, nonzero exits,
and duplicate error text across streams.

The first TWS slice should only wrap those public CLI surfaces. Product-owned
workspace/feature/stack/worktree bindings, persistence, attention mapping, and
client presentation remain separate dependent features.

## Compatibility

- Additive server-only service under a new `apps/server/src/tws/` boundary.
- Reuses `ProcessRunner`, so commands are spawned without shell concatenation
  and with timeout/output limits.
- No contract, database, provider, orchestration, client, relay, or push
  changes are required.
- Exact TWS schema version 1 is accepted for `status` and `stack status`.
- Registry list/check remain explicitly unversioned and are decoded only from
  their documented array shapes.

## Required behavior

- Probe exact CLI version `v1.2.14`.
- Invoke only:
  - `tws --version`
  - `tws registry list --json`
  - `tws registry check --json`
  - `tws status [feature] --json`
  - `tws stack status <feature> --json`
- Treat every nonzero exit as command failure and do not parse stdout.
- Parse JSON through Effect Schema rather than direct `JSON.parse`.
- Reject unsupported schema versions and missing top-level required keys.
- Preserve the complete decoded raw object so additive fields survive.
- Preserve raw unknown runtime/agent/attention enum values and emit normalized
  `unknown` observations without rejecting the report.
- Keep TWS attention separate from provider/session state.

## Risks

- TWS output can be large; cap stdout/stderr and never publish raw reports in
  shell snapshots.
- Feature names and paths must be direct arguments, never interpolated shell.
- A suspended or missing TWS CLI must surface typed failure rather than an
  empty success.
- Unknown enum values are forward-compatible data, not proof of a newer
  supported schema.
- Do not inspect `.tws`, registry backing files, tmux internals, or Git internals
  directly.

## Recommendation

Proceed as an independent server-only tpatch feature. Prove the Phase 0 decoder
rules in TypeScript, then add product-owned bindings as a later feature that
depends on this adapter.
