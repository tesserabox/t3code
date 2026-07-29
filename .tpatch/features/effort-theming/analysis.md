# Analysis: effort-theming

## Summary
Adds an animated teal border and icon glow effect when "xhigh" effort level is selected for Copilot/Codex providers, similar to Claude's ultrathink rainbow border but with a distinct teal color palette. Driven purely by effort selection state in the composer.

## Compatibility
- CSS-only visual change plus a conditional class toggle in the composer registry.
- No impact on message content, prompt injection, or provider behavior.

## Risk: Low
- Visual-only; worst case is a styling glitch on specific browsers.
- CSS animations are GPU-accelerated and lightweight.
