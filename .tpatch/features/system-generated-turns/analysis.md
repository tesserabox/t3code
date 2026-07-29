# Analysis: system-generated-turns

## Summary

Add support for system-generated turns — external events (file watchers, CI callbacks, MCP notifications, webhooks) that automatically trigger a new model turn in a provider session without explicit user input. Introduces a new `system-event` message role in the orchestration layer, with per-adapter mapping to each provider's best available mechanism (Claude: `isSynthetic` user message, Copilot: prefixed prompt, Codex: `developer_instructions`, OpenCode: native `system` field).

## Upstream Status

**Not present upstream.** No AI coding tool (VS Code Copilot Chat, Claude Code, Codex CLI, OpenCode) currently supports externally-triggered model turns. MCP's `sampling/createMessage` is the closest standardized protocol for server-initiated model invocation, but no host implements it as an automatic trigger. This is a novel capability.

## Compatibility

**Status: Compatible.**

The orchestration layer is fully event-sourced with a command/event/decider pattern. Adding a new command type (`thread.turn.start-system`) alongside the existing user-initiated turn commands is a natural extension:

- `OrchestrationMessageRole` already includes `"system"` (currently unused) — adding `"system-event"` is a one-line union extension.
- Provider sessions persist between turns, so `ProviderService.sendTurn()` can be called without establishing a new session.
- The `ProviderCommandReactor` and `RuntimeReceiptBus` provide the event infrastructure needed.
- No existing user-initiated flows are affected.

## Options Investigated

### Option A: Map system-event → user role
Simple but loses semantic clarity. The model and UI can't distinguish human from system intent. Policy/blocking requires extra metadata flags.

### Option B: New `system-event` role (RECOMMENDED)
Distinct role in contracts, per-adapter mapping at the boundary. Clean UI differentiation, native blocking/approval support, cost attribution. Each adapter maps to its best mechanism:

| Provider    | Mapping Target                              |
|-------------|---------------------------------------------|
| Claude SDK  | `SDKUserMessage { isSynthetic: true }`      |
| Copilot SDK | Prefixed prompt string                      |
| Codex SDK   | `developer_instructions` per-turn           |
| OpenCode    | Native `system` field on `promptAsync`      |

### Option C: Encode as tool_use/tool_result pair
**Rejected.** SDKs don't allow fabricating assistant `tool_use` blocks. Only Claude has tool-level APIs; Copilot, Codex, and OpenCode are opaque. Unpaired tool results are rejected. The model would see phantom tool calls it never decided to make.

## Risks

- **Runaway loops**: A model response triggers a file change, which triggers another turn → infinite loop. Requires rate limiting and chain-depth detection.
- **Cost control**: Auto-turns consume tokens without per-turn user consent. Needs budget/throttle policy.
- **Provider compatibility**: Adapter mapping means each provider gets a slightly different representation. Behavior may vary.
- **Security**: Webhooks and external event sources expand the attack surface. Event validation and source authentication needed.

## Affected Areas

- `packages/contracts/src/orchestration.ts` — role union, message schema
- `apps/server/src/orchestration/` — new command type, decider cases
- `apps/server/src/provider/ProviderCommandReactor.ts` — system turn handling
- `apps/server/src/provider/Layers/*Adapter.ts` — per-adapter role mapping (4 files)
- `apps/web/src/components/MessagesTimeline.tsx` — system-event message rendering
- `apps/web/src/` — trigger management UI (parallels ProjectScriptsControl)
- `apps/server/src/` — new EventTriggerService
