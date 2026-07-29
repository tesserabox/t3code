# Exploration: effort-theming

## Key Files
- `apps/web/src/index.css` — CSS keyframes and animation classes for teal border/glow.
- `apps/web/src/components/chat/composerProviderRegistry.tsx` — conditional class application based on effort level and provider type.

## Observations
- Claude's ultrathink rainbow uses a similar pattern: CSS animation class toggled by effort state.
- The teal palette differentiates Copilot/Codex xhigh from Claude ultrathink visually.
- Class toggle is driven by the composer's effort selection state, not by any backend signal.
- Animation uses `@keyframes` with border-color and box-shadow transitions.
