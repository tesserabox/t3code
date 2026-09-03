# Analysis: copilot-cli-provider

## Summary

Port GitHub Copilot to the v0.0.38 provider-instance architecture using the official
`@github/copilot-sdk` `1.0.8` in `mode: "copilot-cli"`. The SDK shares its session store with the
native Copilot CLI, so T3 Code can persist and resume the native session ID instead of emulating a
conversation around the retired `gh copilot suggest/explain` extension.

The canonical driver kind is the upstream placeholder `githubCopilot`. Imported settings and
instances that used `copilot` retain their instance IDs and opaque config while the runtime
canonicalizes the driver.

## Compatibility

**Status: compatible with semantic adaptation.**

The old generation-2 patch was useful only as an implementation and test seed. v0.0.38 now uses:

- `ProviderDriver`/`ProviderInstance` closures and a mutable instance registry
- `ProviderRuntimeEvent` v2
- generic annotated provider settings forms
- dynamic model option descriptors
- provider-owned text-generation services
- provider-neutral task, MCP, attachment, activity, and usage contracts
- target-aware desktop dependency staging

The historical full-file recipe and lockfile hunks must not be replayed.

## Phase 0 Scope

- official SDK client options and bundled CLI resolution
- dynamic auth/status/model/reasoning discovery
- per-instance session create, resume, stop, interrupt, and native session cursor
- send-time `turn.started`
- permissions, user input, proposed plans, tools, commands, hooks, tasks, compaction, skills, MCP,
  and context-usage normalization where current contracts have a lossless home
- bounded provider-owned text generation with ambient tools/config disabled
- active web/mobile presentation with the existing Copilot icon
- current package-manager lock regeneration and runtime dependency staging
- documented `copilot` to `githubCopilot` migration

Post-port review tightened the runtime boundary: stream chunks preserve whitespace, subagent text
never enters the root transcript, shutdown/stop are serialized and terminal, usage accumulates per
turn, text-generation sessions are deleted, config discovery controls custom instructions, and
instance snapshots exclude cwd-specific skills.

The final hardening pass bounds SDK event RPCs and every teardown stage, force-stops a stalled
shared client, retains real subagent completion output, and rejects native resume ownership
conflicts instead of co-owning the session.

Text-generation teardown applies the same bounded model independently to session disconnect,
hidden-session deletion, graceful client stop, and force stop. Cleanup proceeds through every
stage after a timeout, invokes `forceStop()` whenever graceful cleanup is incomplete, and retains
the generation failure as the primary cause when cleanup also fails.

Session creation is bounded separately before the send phase. A stalled `createSession()` has no
owned session handle to disconnect or delete, so cleanup stops the client once and force-stops it
once while preserving the creation-timeout error.

The complete text-generation client/session lifecycle is bracketed with `Effect.acquireUseRelease`.
Its idempotent release path is uninterruptible, so interruption during client startup, session
creation, or sending still drains bounded session/client cleanup exactly once. Cleanup failures are
logged during interruption rather than replacing the interrupt cause.

Final lint hardening removes redundant object-spread fallbacks and uses a regular `Effect.fn`
callback for the pure text-generation service factory. Provider status probing now brackets SDK
cleanup: a probe failure remains primary when stop also fails, while a cleanup-only failure becomes
the reported status error.

## Explicitly Deferred

- mid-session skill-control RPC/UI
- fetch-on-expand tool results
- custom-agent selection
- provider-specific image/audio/resource rendering
- effort theming
- WSL product work and unrelated provider features

Conversation rollback remains an explicit SDK limitation. Rich binary payloads are not placed on
the activity WebSocket; only bounded metadata is normalized.
