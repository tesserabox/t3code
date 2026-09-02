# Specification: copilot-dynamic-models

## Acceptance Criteria

1. **Dynamic Model Discovery**: Model capabilities are fetched dynamically via `client.listModels()` on Copilot provider initialization, replacing static BUILT_IN_MODELS configuration for Copilot provider.

2. **Reasoning Effort Population**: Each model's `reasoningEffortLevels` property is populated from the `supportedReasoningEfforts` field returned by the Copilot SDK runtime data.

3. **Graceful Fallback**: When `listModels()` fails, times out, or returns incomplete data, the system falls back to cached or default model configurations without disrupting service.

4. **Caching Strategy**: Model list is cached with configurable TTL (default: 1 hour) to minimize API calls while ensuring reasonable freshness of capability data.

5. **Static Configuration Deprecation**: Static BUILT_IN_MODELS for Copilot provider is removed or marked deprecated with migration path documented.

6. **Investigation Deliverable**: A comparison document is produced evaluating copilot-api (44 models) vs SDK (16 models), covering: endpoint stability, authentication requirements, model metadata quality, usability of additional models, and a recommendation.

7. **Effect Pattern Compliance**: All async model fetching operations follow established Effect patterns per project conventions.

8. **Type Safety**: Updated model type definitions in `packages/contracts/src/` reflect dynamic reasoning effort levels with proper TypeScript typing.

9. **Codex Provider Isolation**: Changes are isolated to Copilot provider, maintaining Codex-first architecture without impacting Codex provider functionality.

## Implementation Plan

### Phase 1: Investigation & Design (Pre-implementation)

1. **Locate Current BUILT_IN_MODELS**
   - Search codebase to identify source location (contracts, server, or shared)
   - Document current model schema and capability structure
   - Map existing reasoningEffortLevels implementation

2. **Copilot API Investigation**
   - Test copilot-api endpoint for model listing (44 models claim)
   - Document endpoint URL, authentication requirements, response schema
   - Compare response data with SDK's `client.listModels()` output
   - Assess endpoint stability (documented vs undocumented)
   - Produce investigation document with recommendation

3. **Review Existing Patterns**
   - Study `.plans/01-shared-model-normalization.md` for normalization patterns
   - Review `.plans/11-effect.md` for async operation patterns
   - Examine `apps/server/src/providerManager.ts` for provider dispatch patterns

### Phase 2: Core Implementation

4. **Create Model Discovery Service** (`apps/server/src/services/modelDiscovery.ts`)
   - Implement `CopilotModelDiscoveryService` using Effect patterns
   - Add `listModels()` wrapper with error handling
   - Transform `supportedReasoningEfforts` to `reasoningEffortLevels`
   - Include timeout handling (configurable, default 10s)

5. **Implement Caching Layer**
   - Add in-memory cache with TTL for model capabilities
   - Implement cache invalidation mechanism
   - Add cache miss fallback to default configuration
   - Consider cache warming on server startup

6. **Update Type Definitions** (`packages/contracts/src/`)
   - Extend model schemas to support dynamic reasoning effort levels
   - Add types for Copilot SDK `listModels()` response
   - Ensure backward compatibility with existing model types

### Phase 3: Integration

7. **Integrate with Provider Manager**
   - Modify Copilot provider initialization in `providerManager.ts`
   - Call model discovery service during provider setup
   - Wire dynamic capabilities to model resolution logic

8. **Implement Fallback Strategy**
   - Define minimal fallback model configuration
   - Add fallback trigger conditions (API failure, timeout, invalid response)
   - Log fallback events for monitoring

9. **Deprecate Static Configuration**
   - Mark BUILT_IN_MODELS as deprecated for Copilot
   - Add migration documentation
   - Keep static config as fallback source

### Phase 4: Testing & Documentation

10. **Unit Tests**
    - Test model discovery service transformation logic
    - Test cache behavior (hit, miss, expiration)
    - Test fallback scenarios
    - Test Effect error handling paths

11. **Integration Tests**
    - Test end-to-end model listing with mocked Copilot SDK
    - Test provider initialization with dynamic models
    - Test session creation with dynamically-discovered model capabilities

12. **Documentation**
    - Update architecture documentation
    - Document caching behavior and configuration
    - Add troubleshooting guide for model discovery failures
    - Create migration guide from static to dynamic models
