# Spec: system-generated-turns

## Problem Statement

t3code's orchestration layer is strictly user-initiated — every model turn begins with an explicit user message. There is no mechanism for external events (file changes, CI results, MCP notifications, webhooks) to automatically trigger a model response. This prevents autonomous agent workflows, background monitoring, and event-driven AI interactions.

## Design Decision: Internal Role with Adapter Mapping

`system-event` is a **t3code-internal message role** that never reaches any provider SDK directly. At the adapter boundary, each adapter maps it to a provider-native format. The provider SDKs never see the string `"system-event"`.

```
  OrchestrationMessage { role: "system-event", content: "..." }
                            │
                    ┌───────┴───────────────────────────────┐
                    │       Adapter.mapSystemEvent()         │
                    ├───────────────────────────────────────┤
  Claude:     SDKUserMessage { isSynthetic: true }
  Copilot:    prompt string with "[System] ..." prefix
  Codex:      developer_instructions field
  OpenCode:   system field on promptAsync body
```

### Key distinction: turn-triggering vs context-only

A system-event may either:
- **Trigger a turn**: inject message + request model response (mapped with `shouldQuery: true` equivalent)
- **Inject context only**: append to transcript silently, consumed on next user-initiated turn (Claude's `shouldQuery: false` — other adapters would buffer and prepend to next prompt)

## Acceptance Criteria

1. A `"system-event"` literal exists in the `OrchestrationMessageRole` union in `packages/contracts/src/orchestration.ts`
2. `OrchestrationMessage` gains optional fields: `source: "user" | "system" | "trigger"` and `triggerRef?: string`
3. A new orchestration command `thread.turn.start-system` exists alongside `thread.turn.start`, carrying the event payload and trigger metadata
4. The decider emits `thread.message-sent` (role: `system-event`) + `thread.turn-start-requested` for turn-triggering events
5. Each provider adapter maps `system-event` messages to its provider-native format before sending — the SDK never receives the raw `system-event` role
6. Claude adapter: maps to `SDKUserMessage { isSynthetic: true, shouldQuery }` — supports both turn-triggering and context-only modes
7. Copilot adapter: maps to prefixed prompt string `"[System] {content}"` — turn-triggering only (no context-only mode)
8. Codex adapter: maps to `developer_instructions` in `collaborationMode.settings` — turn-triggering only
9. OpenCode adapter: maps to `system` field on `SessionPromptAsyncData` — turn-triggering only
10. System-event messages render distinctly in the chat UI (collapsible, different icon/color, clear "system" badge)
11. A policy gate can block system-event turns pending user approval (configurable: auto / ask / deny)
12. Rate limiting: max N system-event turns per minute per thread (configurable, default 5)
13. Loop detection: track event→turn→event chains, break at configurable depth (default 3)
14. Cost attribution: system-initiated turns are tagged for separate token tracking
15. Compaction/projection retains system-event messages (extend existing system message retention)
16. Existing user-initiated turn flows are completely unaffected — zero behavioral change when no triggers are configured

## Out of Scope (v1)

- Trigger rule management UI ("+ Add trigger" button) — v1 uses config/API only
- Webhook HTTP endpoint as event source — v1 focuses on file watchers and MCP notifications
- Multi-thread trigger routing (event targets a specific thread) — v1 targets the active thread
- Conditional triggers (pattern matching, file scope filters) — v1 fires unconditionally
- Cross-provider trigger chaining (one provider's output triggers another)

## Validation Requirements

These must be verified before implementation:

### Per-adapter validation
- [ ] **Claude SDK**: Confirm `SDKUserMessage { isSynthetic: true }` is accepted mid-conversation without errors. Test both `shouldQuery: true` and `shouldQuery: false`.
- [ ] **Copilot SDK**: Confirm `session.sendMessage()` accepts a prompt with `[System]` prefix without rejection or special handling.
- [ ] **Codex SDK**: Confirm `developer_instructions` in `V2TurnStartParams.collaborationMode.settings` is processed per-turn (not just at session init).
- [ ] **OpenCode SDK**: Confirm the `system` field on `SessionPromptAsyncData` body is accepted and effective when passed on `promptAsync`.

### Orchestration validation
- [ ] Confirm that `turn-start-requested` events from a system source flow through `ProviderCommandReactor` identically to user-initiated ones.
- [ ] Confirm that `ProviderSessionDirectory` reuses existing sessions for system-event turns (no spurious session creation).
- [ ] Confirm that the compaction logic in projections handles `system-event` role messages (currently filters on `system` role).

## Implementation Plan

### Phase 1: Contracts + Orchestration (no provider changes)
- Add `"system-event"` to `OrchestrationMessageRole` union
- Add `source` and `triggerRef` optional fields to `OrchestrationMessage`
- Add `thread.turn.start-system` command type
- Add decider case for system-initiated turns
- Add projection/compaction handling for `system-event` messages

### Phase 2: Adapter Mapping (per-provider)
- Add `mapSystemEvent()` method to each adapter
- Claude: `SDKUserMessage { isSynthetic: true, shouldQuery, priority: "now" }`
- Copilot: prefix prompt with `[System] `
- Codex: set `developer_instructions`
- OpenCode: set `system` field
- Integration test each adapter with a synthetic system-event message

### Phase 3: Policy + Safety
- Add policy gate (auto / ask / deny) to system-event turn requests
- Add rate limiter (per-thread, configurable)
- Add loop detection (chain depth tracking)
- Add cost attribution tagging

### Phase 4: Event Sources (v1)
- File watcher trigger source (extend existing `fs.watch` in serverSettings.ts pattern)
- MCP notification trigger source (`resources/updated`, `tools/list_changed`)
- EventTriggerService to manage sources and dispatch `thread.turn.start-system` commands

### Phase 5: UI
- Render system-event messages distinctly in MessagesTimeline
- Show trigger metadata (source, triggerRef) in message details
- Policy approval modal (when policy = "ask")
