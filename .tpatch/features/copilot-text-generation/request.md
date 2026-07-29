# Feature Request: Implement native text generation for the Copilot provider. Currently thread titles, commit messages, branch names, and PR content route to the Codex CLI, which requires Codex to be installed. Create CopilotTextGeneration.ts that uses the Copilot SDK session to generate text, matching the pattern of ClaudeTextGeneration.ts. Wire into RoutingTextGeneration.ts to replace the codexTextGen fallback.

**Slug**: `copilot-text-generation`
**Created**: 2026-04-27T04:50:12Z

## Description

Implement native text generation for the Copilot provider. Currently thread titles, commit messages, branch names, and PR content route to the Codex CLI, which requires Codex to be installed. Create CopilotTextGeneration.ts that uses the Copilot SDK session to generate text, matching the pattern of ClaudeTextGeneration.ts. Wire into RoutingTextGeneration.ts to replace the codexTextGen fallback.
