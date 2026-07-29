# Analysis: custom-agents

## Summary
Add custom agent support across providers. Only Copilot and Claude SDKs have real agent definition support (system prompts, tool allow/blocklists, MCP servers per agent). Codex/Cursor/OpenCode need graceful degradation.

## Compatibility
- Compatible — additive feature, no breaking changes
- Copilot and Claude have SDK-level support; others get prompt injection or no-op
- Risk: Medium — touches contracts, all adapters, and UI

## Effort
Large — requires new contracts schema, per-adapter wiring, event handling, and a new UI component (agent selector).
