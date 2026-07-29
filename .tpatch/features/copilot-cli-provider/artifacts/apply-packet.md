# Apply Packet: copilot-cli-provider

## Request
# Feature Request: Expand the providers so that not only claude and codex are
 supported, but add the ability to use the copilot cli, as requested in
 this github issue from the upstream
 https://github.com/pingdotgg/t3code/issues/193

**Slug**: `copilot-cli-provider`
**Created**: 2026-04-17T09:58:12Z

## Description

Expand the providers so that not only claude and codex are
 supported, but add the ability to use the copilot cli, as requested in
 this github issue from the upstream
 https://github.com/pingdotgg/t3code/issues/193


## Spec
# Specification: copilot-cli-provider

## Acceptance Criteria

1. Users can select "GitHub Copilot CLI" as a provider option in the UI alongside existing Claude and Codex providers
2. The system detects whether `gh` CLI is installed and whether the user is authenticated via `gh auth status`
3. The system detects whether the Copilot CLI extension is installed via `gh extension list`
4. Clear error messages are displayed when Copilot CLI is not installed, `gh` CLI is missing, or authentication has failed
5. Users can send prompts that are executed via `gh copilot suggest` or `gh copilot explain` commands
6. Copilot CLI output is captured and displayed in the conversation view, with streaming if supported by the CLI
7. Copilot CLI responses are normalized to the shared event schema used by other providers
8. Existing Claude and Codex provider functionality remains unchanged (no regressions)
9. Provider selection persists across browser sessions via existing persistence mechanism
10. Provider-specific configuration options for Copilot CLI (e.g., command type: suggest vs explain) are exposed in the UI
11. Documentation is updated to reflect Copilot CLI provider setup requirements and usage

## Implementation Plan

### Phase 1: Research and Contract Definition

1. **Investigate Copilot CLI interface**
   - Document exact command signatures for `gh copilot suggest` and `gh copilot explain`
   - Determine if streaming output is supported (check for `--format` flags or TTY behavior)
   - Identify how context/files can be passed to commands
   - Review upstream issue t3code/issues/193 for additional requirements

2. **Define provider type in contracts**
   - Add `copilot-cli` to provider enum in `packages/contracts/src/`
   - Create `CopilotCliConfig` type for provider-specific configuration (command type, shell type for suggest)
   - Define `CopilotCliEvent` types that map to the shared event schema
   - Add Zod schemas for validation

### Phase 2: Core Provider Implementation

3. **Create Copilot CLI manager**
   - Create `apps/server/src/copilotCliManager.ts` following the pattern of existing managers
   - Implement CLI detection: check for `gh` binary in PATH
   - Implement auth detection: execute `gh auth status` and parse result
   - Implement extension detection: execute `gh extension list` and check for copilot

4. **Implement command execution**
   - Create subprocess wrapper for executing `gh copilot` commands
   - Handle stdin for passing prompts/context
   - Capture stdout/stderr streams
   - Implement timeout handling for long-running commands

5. **Implement session abstraction**
   - Design pseudo-session model for command-based interaction (since Copilot CLI is stateless)
   - Track conversation history client-side if needed for context
   - Map request/response cycles to the provider session interface

### Phase 3: Event Normalization and Integration

6. **Implement event normalization**
   - Create transformer to convert Copilot CLI output to shared event schema
   - Handle different output formats (suggest returns shell commands, explain returns text)
   - Map CLI exit codes to appropriate error events

7. **Register provider in providerManager**
   - Add Copilot CLI provider to `apps/server/src/providerManager.ts`
   - Implement dispatch logic for routing to `copilotCliManager`
   - Add provider capability flags (e.g., supports streaming: conditional)

### Phase 4: UI Integration

8. **Update provider selection UI**
   - Add Copilot CLI option to provider dropdown in `apps/web/src/`
   - Display provider status (installed/authenticated) as badges or indicators
   - Show appropriate setup instructions when requirements not met

9. **Add Copilot CLI configuration UI**
   - Create settings panel for Copilot CLI-specific options
   - Add command type selector (suggest/explain)
   - Add shell type selector for suggest command (bash, zsh, powershell)

10. **Handle response display**
    - Ensure conversation view properly renders Copilot CLI responses
    - Add syntax highlighting for shell command suggestions
    - Display command type indicator in response UI

### Phase 5: Error Handling and Polish

11. **Implement comprehensive error handling**
    - Create specific error types for: CLI not found, not authenticated, extension not installed, command timeout, rate limiting
    - Display actionable error messages with installation/auth instructions
    - Add retry logic where appropriate

12. **Add persistence**
    - Ensure Copilot CLI selection persists via existing provider persistence mechanism
    - Persist Copilot CLI-specific configuration options

### Phase 6: Documentation and Testing

13. **Update documentation**
    - Update `.docs/provider-architecture.md` with Copilot CLI provider details
    - Document setup requirements (gh CLI, authentication, extension installation)
    - Add troubleshooting guide for common issues

14. **Testing**
    - Add unit tests for `copilotCliManager` including mock subprocess responses
    - Add integration tests for provider selection and command execution
    - Test error scenarios (missing CLI, auth failure, timeout)
    - Verify no regressions in Claude and Codex providers


## Exploration
# Exploration: copilot-cli-provider

## Relevant Files

### Provider Contract Definitions
- `packages/contracts/src/provider.ts` - Core provider type definitions where `copilot-cli` provider type needs to be added to the provider enum and CopilotCliConfig type defined
- `packages/contracts/src/providerRuntime.ts` - Provider runtime schemas where Copilot CLI-specific runtime events need to be defined
- `packages/contracts/src/index.ts` - Contract exports that will need to export new Copilot CLI types

### Server-Side Provider Implementation
- `apps/server/src/provider/` - Provider directory where new `copilotCliManager.ts` should be created (following pattern of existing provider managers)
- `apps/server/src/codexAppServerManager.ts` - Reference implementation for how existing providers are structured (subprocess management, event handling)
- `apps/server/src/processRunner.ts` - Process execution utilities that will be used for running `gh copilot` CLI commands
- `apps/server/src/orchestration/` - Orchestration layer that dispatches to providers, will need to route to Copilot CLI provider

### Web UI Provider Selection
- `apps/web/src/providerModels.ts` - Provider model definitions for UI, needs Copilot CLI provider option added
- `apps/web/src/modelSelection.ts` - Model/provider selection logic that needs to handle Copilot CLI
- `apps/web/src/store.ts` - Application state store where provider selection is persisted

### Documentation
- `.docs/provider-architecture.md` - Provider architecture documentation that should document Copilot CLI provider specifics

### Shared Utilities
- `packages/shared/src/shell.ts` - Shell utilities that may be relevant for CLI detection and execution

## Minimal Changeset

1. **Add Copilot CLI provider type to contracts** (`packages/contracts/src/provider.ts`): Add `copilot-cli` to the provider enum, define `CopilotCliConfig` interface with command type (suggest/explain) and shell type options

2. **Create Copilot CLI manager** (`apps/server/src/provider/copilotCliManager.ts` - new file): Implement CLI detection (`gh` binary check), auth detection (`gh auth status`), extension detection (`gh extension list`), and command execution wrapper for `gh copilot suggest` and `gh copilot explain`

3. **Register provider in orchestration** (`apps/server/src/orchestration/`): Add dispatch logic to route requests to the new Copilot CLI manager

4. **Add UI provider option** (`apps/web/src/providerModels.ts`): Add Copilot CLI to available providers with appropriate capability flags and configuration options

5. **Update provider runtime events** (`packages/contracts/src/providerRuntime.ts`): Add event types for Copilot CLI responses, normalizing them to the shared event schema

6. **Document the provider** (`.docs/provider-architecture.md`): Add section covering Copilot CLI setup requirements, authentication flow, and command-based interaction model

