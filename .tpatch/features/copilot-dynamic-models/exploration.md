# Exploration: copilot-dynamic-models

## Relevant Files

### Core Model Configuration (Current State)
- **packages/contracts/src/model.ts** - Contains model type definitions and likely the BUILT_IN_MODELS static configuration that needs to be replaced with dynamic discovery. This is where reasoningEffortLevels schema is defined.

- **packages/contracts/src/provider.ts** - Provider-related type definitions that may include model capability interfaces and provider-specific model schemas.

- **packages/contracts/src/providerRuntime.ts** - Runtime provider types that likely define how model capabilities are exposed at runtime, needs extension for dynamic capabilities.

- **packages/shared/src/model.ts** - Shared model utilities and normalization logic referenced in .plans/01-shared-model-normalization.md, may contain model transformation helpers.

### Provider Implementation (Integration Points)
- **apps/server/src/provider/** - Provider directory containing Copilot provider implementation. This is where client.listModels() integration will be added.

- **apps/server/src/codexAppServerManager.ts** - Server manager that handles provider initialization, needs to wire in dynamic model discovery during Copilot provider setup.

- **apps/server/src/bootstrap.ts** - Server bootstrap logic where provider initialization occurs, may need modification for async model fetching during startup.

### Web Client (Consumer of Model Data)
- **apps/web/src/providerModels.ts** - Client-side model handling that consumes model capability data, needs to handle dynamically-discovered reasoningEffortLevels.

### Existing Plans (Reference)
- **.plans/01-shared-model-normalization.md** - Existing plan for model normalization patterns to follow for consistency.

- **.plans/11-effect.md** - Effect patterns documentation for implementing async model fetching operations.

## Minimal Changeset

1. **packages/contracts/src/model.ts** - Extend model schema types to support dynamic reasoningEffortLevels populated from runtime data; add types for Copilot SDK listModels() response including supportedReasoningEfforts field.

2. **apps/server/src/provider/** - Create new `modelDiscovery.ts` service implementing CopilotModelDiscoveryService with Effect patterns; wrap client.listModels() with error handling, timeout, and transformation from supportedReasoningEfforts to reasoningEffortLevels.

3. **apps/server/src/provider/** - Add caching layer (in-memory with configurable TTL) for model capabilities within the Copilot provider, including cache invalidation and fallback to static defaults on failure.

4. **apps/server/src/codexAppServerManager.ts** or relevant provider initialization code - Integrate model discovery service into Copilot provider initialization flow, calling listModels() during provider setup.

5. **packages/shared/src/model.ts** - Add transformation utility to normalize supportedReasoningEfforts from Copilot SDK format to internal reasoningEffortLevels format, following patterns from 01-shared-model-normalization.md.

6. **.plans/** - Create new investigation document comparing copilot-api (44 models) vs SDK (16 models) with endpoint analysis and recommendation.
