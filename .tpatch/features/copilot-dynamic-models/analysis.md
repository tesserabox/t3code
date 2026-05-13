# Analysis: copilot-dynamic-models

## Summary

This feature request proposes replacing the static BUILT_IN_MODELS configuration with dynamic model discovery using the Copilot SDK's runtime data. The implementation would call client.listModels() to fetch available models and their capabilities (specifically supportedReasoningEfforts) at runtime, populating reasoningEffortLevels dynamically per model. Additionally, the request asks to investigate the copilot-api endpoint which reportedly exposes 44 models compared to the SDK's 16, potentially providing broader model coverage.

## Compatibility

**Status**: compatible

This feature aligns with the project's architecture of provider abstraction (see provider-architecture.md references). The change moves from static configuration to dynamic discovery, which improves maintainability without changing the core session/event architecture. The contracts package already handles model/session types via schemas, and this would extend that pattern. No conflicts with existing Codex-first approach since this appears to target Copilot as an additional provider.

## Affected Areas

- packages/contracts/src/ - Model type definitions and schemas for reasoningEffortLevels
- apps/server/src/ - Provider session initialization, model listing integration
- apps/server/src/providerManager.ts - Provider dispatch and model capability resolution
- .plans/ - May need a new implementation plan document
- packages/shared/src/ - Potential shared model normalization utilities (see .plans/01-shared-model-normalization.md)

## Acceptance Criteria

1. Model capabilities are fetched dynamically via client.listModels() on provider initialization
2. Each model's reasoningEffortLevels is populated from supportedReasoningEfforts runtime data
3. Static BUILT_IN_MODELS is removed or deprecated in favor of dynamic discovery
4. Graceful fallback exists if listModels() fails or returns incomplete data
5. Model list caches appropriately to avoid excessive API calls
6. Investigation document produced comparing copilot-api (44 models) vs SDK (16 models) with recommendation

## Implementation Notes

- Check .plans/01-shared-model-normalization.md for existing model normalization patterns to follow
- The contracts package should remain schema-only per AGENTS.md - runtime model fetching belongs in apps/server
- Consider caching strategy: models likely don't change frequently, but capabilities might
- Need to handle the case where Copilot SDK is unavailable (Codex-first architecture per AGENTS.md)
- The copilot-api investigation should document: endpoint stability, authentication requirements, model metadata quality, and whether the extra models are actually usable
- Effect patterns appear to be in use (packages/effect-acp, .plans/11-effect.md) - new async model fetching should follow established Effect patterns

## Unresolved Questions

- What is the source of the current BUILT_IN_MODELS - is it in contracts, server, or shared?
- Is copilot-api a documented/stable endpoint or an undocumented internal API?
- Should dynamic model discovery happen once at server startup, per-session, or be refreshable?
- How should model capability changes between discovery calls be handled for active sessions?
- Are there rate limits on client.listModels() or copilot-api that affect caching strategy?
- Does this affect the Codex provider or is it Copilot-specific? If Copilot-specific, how does it fit the Codex-first architecture?

