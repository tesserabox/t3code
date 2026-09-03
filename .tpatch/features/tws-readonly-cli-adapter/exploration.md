# Exploration: tws-readonly-cli-adapter

## Reused infrastructure

- `apps/server/src/processRunner.ts` already provides direct spawn, Windows
  command resolution, typed process errors, timeout, UTF-8 observation, and
  output limits.
- Effect service/layer tests can inject `ProcessRunner` directly without
  spawning a real CLI.
- `Schema.fromJsonString(Schema.Unknown)` parses JSON without direct
  `JSON.parse`; manual guards can retain the complete object rather than
  stripping additive fields through `Schema.Struct`.

## Minimal file set

Add:

- `apps/server/src/tws/TwsCliDecoder.ts`
- `apps/server/src/tws/TwsCliDecoder.test.ts`
- `apps/server/src/tws/TwsCliAdapter.ts`
- `apps/server/src/tws/TwsCliAdapter.test.ts`

No existing production file needs modification. The service will be imported
by the later bindings feature.

## Decoder responsibilities

`TwsCliDecoder.ts` owns:

- supported CLI/schema constants;
- registry entry/check normalized types with retained `raw` objects;
- status/stack raw report envelopes;
- unknown enum observations;
- recursive TWS-attention derivation;
- canonical duplicate error-line normalization;
- typed decode/version/command-failure errors;
- pure decoders for version, registry list/check, status, and stack status.

The decoder validates only fields required by the public contract and retains
the original decoded records so additive keys survive.

## Adapter responsibilities

`TwsCliAdapter.ts` owns:

- the Effect service tag and live layer;
- exact allowed argument arrays;
- timeout and output caps;
- successful-version caching without caching failures;
- conversion from `ProcessRunner` output into pure decoder calls;
- no shell construction, TWS mutation, internal-file access, persistence, or
  provider-state inference.

## Tests

Decoder tests port the Phase 0 proof rules:

- exact version and schema acceptance;
- version 2 rejection;
- required-key and JSON failure;
- additive-key preservation;
- unknown-enum preservation/degradation;
- nested/summary attention derivation;
- registry list/check decoding;
- nonzero failure canonicalization and cross-stream dedupe.

Adapter tests inject a fake `ProcessRunner` and assert:

- exact command/argument/cwd values;
- first supported probe is reused;
- failed probe is retried;
- valid JSON stdout is ignored on nonzero exit;
- status feature and stack feature are passed as direct arguments.

## Follow-up boundary

The next feature may depend on this adapter to persist environment-owned TWS
workspace/feature/stack/worktree bindings. It must not reuse raw paths or names
as product primary IDs.
