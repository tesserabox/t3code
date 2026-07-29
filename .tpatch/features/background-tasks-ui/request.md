# Feature Request: Add background task tracking and UI across providers. Maintain a live count of active background agents/subagents, show a badge indicator in the status bar, and add a collapsible task panel to view active/completed background tasks. For Copilot: track via subagent.started/completed, system.notification (agent_completed), and session.background_tasks_changed. For Claude: track via collab_agent_tool_call lifecycle. Requires: adapter-level task registry, new runtime event for task count updates, and frontend task panel component. Depends on copilot-command-events for system.notification handling.

**Slug**: `background-tasks-ui`
**Created**: 2026-04-22T11:18:35Z

## Description

Add background task tracking and UI across providers. Maintain a live count of active background agents/subagents, show a badge indicator in the status bar, and add a collapsible task panel to view active/completed background tasks. For Copilot: track via subagent.started/completed, system.notification (agent_completed), and session.background_tasks_changed. For Claude: track via collab_agent_tool_call lifecycle. Requires: adapter-level task registry, new runtime event for task count updates, and frontend task panel component. Depends on copilot-command-events for system.notification handling.
