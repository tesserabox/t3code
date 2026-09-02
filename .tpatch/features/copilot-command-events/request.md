# Feature Request: Wire up Copilot SDK command, shell, and system notification events

**Slug**: `copilot-command-events`
**Created**: 2026-04-22T10:44:43Z

## Description

Wire up Copilot SDK command and shell execution events, plus system notifications for background agent completion. Map the following currently-dropped events in CopilotAdapter's mapSessionEvent:

- `command.execute`, `command.completed`, `command.queued` — command execution timeline entries
- `shell_completed`, `shell_detached_completed` — shell lifecycle events
- `system.notification` — background agent completion callbacks (kind.type: "agent_completed" / "agent_idle"). These are the async notifications for background agents spawned by the Copilot SDK. Without this, background agent results are silently lost and the `<system_notification>` XML content is never surfaced to the UI.
- `system.message` — system-level messages from the SDK

All are currently dropped by the `default` case in mapSessionEvent.
