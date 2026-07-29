# Analysis: copilot-hide-internal-models

## Summary
Add a toggle in Copilot provider settings to hide models marked as internal-only from the model picker. The Copilot SDK's `listModels()` returns models like `claude-opus-4.6-1m` with "(Internal only)" in the name — these are not available to most users and clutter the model list.

## Compatibility
- Compatible — additive setting, defaults to off (show all)
- Copilot-specific — no impact on other providers
- Risk: Low — filtering is UI-side only, does not affect session creation
