# Analysis: copilot-cli-provider

## Summary

Add GitHub Copilot CLI as a third provider alongside the existing Claude and Codex providers. This would expand the provider system to support the `gh copilot` CLI tool, allowing users to interact with GitHub's AI assistant through the T3 Code interface. This aligns with upstream request t3code/issues/193 and follows the existing provider abstraction pattern.

## Compatibility

**Status**: compatible

The project already has a provider abstraction layer (documented in `.docs/provider-architecture.md`) with existing support for multiple providers (Claude and Codex). The architecture appears designed for extensibility with `providerManager.ts` handling dispatch and `packages/contracts` defining provider schemas. Adding a new provider follows the established pattern and doesn't conflict with existing functionality.

## Affected Areas

- packages/contracts/src/ - Add Copilot CLI provider type definitions and event schemas
- apps/server/src/providerManager.ts - Register and dispatch to Copilot CLI provider
- apps/server/src/ - New copilotCliManager.ts (analogous to codexAppServerManager.ts)
- .docs/provider-architecture.md - Document Copilot CLI provider specifics
- apps/web/src/ - UI updates for provider selection if not already generic
- packages/shared/src/ - Any shared Copilot CLI utilities if needed

## Acceptance Criteria

1. Copilot CLI provider can be selected and configured in the UI
2. Sessions can be started using `gh copilot` CLI as the backend
3. Copilot CLI responses are streamed and displayed in the conversation view
4. Provider-specific events from Copilot CLI are normalized to the shared event schema
5. Existing Claude and Codex providers continue to function without regression
6. Error handling covers Copilot CLI authentication failures and CLI not installed scenarios
7. Provider selection persists across sessions

## Implementation Notes

- Research `gh copilot` CLI interface - it uses `gh copilot suggest` and `gh copilot explain` commands rather than a persistent JSON-RPC server like Codex
- May need different session management pattern since Copilot CLI is command-based rather than server-based
- Authentication flows through GitHub CLI (`gh auth`) - need to detect and handle auth state
- Consider whether to wrap individual commands or attempt a pseudo-session abstraction
- Event normalization will differ significantly from Codex's structured JSON-RPC events
- Reference upstream issue for any specific requirements or prior discussion

## Unresolved Questions

- What is the exact CLI interface for `gh copilot`? Does it support streaming output?
- Should this be a full interactive provider or limited to suggest/explain commands?
- How does Copilot CLI handle context (file contents, codebase awareness)?
- Are there rate limits or usage restrictions on the Copilot CLI that need handling?
- Does the upstream issue (t3code/issues/193) specify particular requirements or constraints?
- Should this provider support the same turn-based conversation model as Codex, or adapt to Copilot's command-response pattern?

