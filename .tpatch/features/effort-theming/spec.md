# Spec: effort-theming

## Acceptance Criteria
1. Selecting "xhigh" effort for Copilot or Codex displays an animated teal border on the composer.
2. An icon glow effect accompanies the border animation.
3. The effect deactivates immediately when effort is changed away from xhigh.
4. The animation is visually distinct from Claude's ultrathink rainbow effect.
5. No prompt injection or model behavior change — purely visual.

## Out of Scope
- Theming for other effort levels (low, medium, high).
- Provider-specific color customization UI.

## Plan
1. Add CSS keyframes and classes for teal border animation + glow in `index.css`.
2. Toggle the class in `composerProviderRegistry.tsx` based on effort selection state.
