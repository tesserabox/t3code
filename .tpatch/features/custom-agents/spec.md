# Spec: custom-agents

## Acceptance Criteria
1. New `CustomAgent` schema in contracts (name, displayName, description, prompt, tools, model, mcpServers)
2. `ServerSettings` includes `customAgents: Record<string, CustomAgent>`
3. Copilot adapter maps agents to SDK `customAgents` config in `createSession`
4. Claude adapter maps agents to SDK `agents` config in session options
5. Codex/Cursor/OpenCode gracefully degrade (prepend prompt or show "not supported")
6. UI agent selector in model picker or thread creation
7. Handle `session.custom_agents_updated` (Copilot) and equivalent Claude events

## Out of Scope
- Background/async agents (Claude-only, future enhancement)
- Agent memory scoping (Claude-only)
- Auto-discovery from `AGENTS.md` (separate feature)

## Minimum Viable Version
Contracts schema + Copilot/Claude wiring + simple agent selector dropdown.
