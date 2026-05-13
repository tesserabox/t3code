# Custom Agents — Cross-Provider Analysis

## SDK Support Reality

| Feature | Copilot | Claude | Codex | OpenCode | Cursor |
|---------|:---:|:---:|:---:|:---:|:---:|
| Custom agent definitions | ✅ | ✅ (richest) | ❌ | ⚠️ presets only | ❌ |
| System prompt per agent | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tool allow/blocklist | ✅ | ✅ both | ❌ | ❌ | ❌ |
| Model per agent | ❌ | ✅ | ❌ | ❌ | ❌ |
| MCP servers per agent | ✅ | ✅ | ❌ | ❌ | ❌ |
| Background/async agents | ❌ | ✅ | ❌ | ❌ | ❌ |
| Agent memory scoping | ❌ | ✅ | ❌ | ❌ | ❌ |
| Max turns | ❌ | ✅ | ❌ | ❌ | ❌ |

**Only Copilot and Claude have real SDK-level support.** Codex, Cursor, and OpenCode would need graceful degradation.

## Implementation Layers

### Layer 1 — Contracts (`packages/contracts/src/`)
- New unified `CustomAgent` schema (superset of both SDKs)
- Add to `ServerSettings` as `customAgents: Record<string, CustomAgent>`

### Layer 2 — Per-adapter wiring
- **Copilot**: Map to `customAgents` + `agent` in `createSession`
- **Claude**: Map to `agents` + `agent` in session options
- **Codex/Cursor**: Graceful degradation — prepend agent's `prompt` to user messages or "not supported" warning
- **OpenCode**: Map `name` to its `agent` field if it matches a server-side preset

### Layer 3 — Event handling
- Handle `session.custom_agents_updated` (Copilot) — project available agents
- Handle `subagent.selected/deselected` (Copilot) — track active agent
- Handle Claude's equivalent subagent lifecycle events
- Surface agent switches in the UI timeline

### Layer 4 — UI
- Agent selector in the model picker or thread creation
- Reuse existing `agentOptions` pattern from `ModelCapabilities`
- Settings page for defining custom agents (name, prompt, tools)

### Layer 5 — Discovery (optional)
- Parse structured definitions from `.t3code/agents.json` or a `## Agents` section in `AGENTS.md`
- Auto-discover via `enableConfigDiscovery` for Copilot

## Effort Estimate

| Layer | Effort | Notes |
|-------|--------|-------|
| Contracts schema | Small | New types + settings field |
| Copilot + Claude wiring | Medium | Map config → SDK, handle events |
| Codex/Cursor/OpenCode fallback | Small | Graceful no-op or prompt injection |
| UI (selector + settings) | Large | New components, state management |
| Discovery from files | Medium | Parser + file watching |

## Minimum Viable Version
Contracts schema + Copilot/Claude wiring + simple agent selector dropdown. Gets the two providers that actually support it working, while others gracefully ignore it.
