# Spec: readme-copilot-notice

## Problem
Users of this fork may not realize that the Copilot provider creates sessions with a different schema than upstream t3code. Switching back to upstream after using Copilot will fail to load those sessions.

## Acceptance Criteria
1. README.md contains a visible section about the Copilot provider integration
2. The section includes a warning about backward-incompatibility with upstream
3. The warning mentions that Copilot sessions cannot be loaded by upstream t3code
4. The section mentions this is experimental and fork-specific

## Out of Scope
- Migration tooling for converting sessions between formats
- Runtime warnings in the UI (separate feature if needed)

## Plan
1. Read current README.md structure
2. Add a "Fork-Specific Features" or "Experimental Providers" section
3. Include compatibility warning with clear language
