# Specification: copilot-cli-provider

## Acceptance Criteria

1. T3 Code registers an opt-in `githubCopilot` provider backed by the official
   `@github/copilot-sdk` `1.0.8` in `copilot-cli` mode.
2. Default client options use the SDK-bundled platform runtime; explicit binary and
   `COPILOT_HOME` overrides remain per instance.
3. Provider checks report runtime version and authentication state, discover models dynamically,
   filter policy-disabled models, and expose supported reasoning effort through current option
   descriptors. Probe cleanup always stops the SDK client, preserves a start/status/auth/model
   failure when cleanup also fails, and reports cleanup-only failures explicitly.
4. Sessions create or resume with the SDK's native session ID, persist that ID as the resume
   cursor, serialize stop with event handling, treat native shutdown as terminal, discard late
   events, reject `session.resume.alreadyInUse` ownership conflicts, and keep separate adapter state
   per configured instance. Event RPC, drain, disconnect, graceful client-stop, and force-stop
   deadlines keep teardown bounded.
5. `turn.started.createdAt` is captured when T3 submits the message, not from a later SDK event.
6. Current T3 approval, user-input, and proposed-plan flows resolve the corresponding SDK
   callbacks. Approval options never advertise unsupported persistence, and identical plans remain
   valid in later turns. Unsupported rollback is a typed, explicit error.
7. Assistant, reasoning, tool, command, hook, task/subagent, compaction/truncation, skill, MCP, and
   context-usage events map to current `ProviderRuntimeEvent` contracts. Event processing is
   ordered, streaming whitespace is preserved, agent-scoped messages stay out of the root
   transcript, successful subagent completion retains its latest real response, usage accumulates
   every model call per turn, compaction reaches `thread.state.changed`, and terminal task rows are
   deduplicated.
8. Tool arguments/results and raw provenance are bounded and redact credential-shaped argument
   fields. Binary asset bytes are never copied into canonical activity payloads.
9. Copilot skills are discovered per session. The instance snapshot unions only
   context-independent personal/plugin/builtin skills across live sessions; project/inherited
   skills never leak between cwd values.
10. Provider-owned commit, PR, branch, and thread-title generation disables tools, skills, MCP,
    project config, custom instructions, extensions, and infinite sessions; malformed/oversized
    output fails, cleanup always runs, and hidden native generation sessions are deleted.
    Session creation, disconnect, deletion, graceful client stop, and force stop have independent
    deadlines; any stalled creation or graceful cleanup stage invokes bounded force stop without
    replacing the original generation failure or cleaning the same session twice. Startup,
    creation, and send interruption run the same idempotent uninterruptible finalizer while
    preserving interruption as the primary outcome.
11. Web settings/model pickers and mobile provider icons treat GitHub Copilot as active and use the
    existing Copilot glyph.
12. Legacy `providers.copilot` and `providerInstances.*.driver = "copilot"` configurations decode,
    preserve their instance IDs/config, run through `githubCopilot`, and render as a truthful
    non-deletable default slot.
13. The lockfile is regenerated with pnpm. Desktop/server staging retains the SDK and its native
    dependency closure outside the bundle so target platform packages remain resolvable.
14. Focused tests cover client options, provider/model status, migration, create/resume/stop,
    permissions/user input/plans, critical runtime events, text generation, and packaging closure.

## Non-Goals

- skill management controls
- provider-neutral rich resource UI
- custom agents
- tool-result fetch APIs
- WSL changes
- animated effort presentation
