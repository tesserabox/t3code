# GitHub Copilot

GitHub Copilot support is currently in preview. T3 Code uses the official
`@github/copilot-sdk` in `copilot-cli` mode, so it shares authentication,
configuration, skills, and native sessions with the Copilot CLI.

## Set Up The Provider

Authenticate Copilot using either the Copilot CLI or GitHub CLI credentials, then open T3 Code
Settings and enable **GitHub Copilot**. The SDK bundles its supported Copilot runtime, so the
**Binary path** can normally stay `copilot`.

T3 Code asks the runtime for the available models and reasoning options. Models disabled by
organization policy are not shown.

## Sessions And COPILOT_HOME

An empty **COPILOT_HOME path** uses `~/.copilot`. Sessions created by T3 Code are stored there and
can be resumed by the native Copilot CLI. T3 Code persists the native session ID so a server restart
can resume the same conversation.

If the native runtime reports that another client already owns a resumed session, T3 Code rejects
the resume instead of attaching a second owner to the same conversation.

Give separate provider instances different `COPILOT_HOME` paths when their sessions or
configuration must remain isolated. Instances using the same home are treated as the same
continuation environment.

## Project Configuration

**Discover project configuration** is on by default. It lets Copilot load project instructions,
skills, and MCP server definitions. T3 Code also attaches its own authenticated MCP server when
agent browser access is enabled.

Turning the setting off also disables custom instruction loading; it is a trust boundary, not only
an MCP-discovery toggle.

Copilot permissions, user questions, proposed plans, tools, background agents, context usage,
compaction, skills, and MCP status are normalized into the same T3 Code contracts used by web,
desktop, and mobile clients.

Project and inherited skills remain available to the Copilot session that discovered them. The
instance-wide Settings catalog only publishes context-independent personal, plugin, and built-in
skills, so opening one project cannot leak its skill list into another project's picker.

## Legacy `copilot` Settings

Early T3 Code feature branches used the driver name `copilot`. The current driver name is
`githubCopilot`, matching the upstream placeholder.

When old settings are loaded, T3 Code keeps the legacy instance ID so existing threads remain
routable, but runs it through the `githubCopilot` driver. Its configuration is preserved. New
instances use `githubCopilot`. The migrated `copilot` slot is presented as the default and cannot
be deleted as if it were a disposable custom instance.

Downgrading to an older feature branch may require changing the driver name back manually. Native
Copilot sessions remain in `COPILOT_HOME`; upstream builds without this driver cannot start or
resume them through T3 Code.

## Current Limitations

- Copilot conversation rollback is not exposed by the SDK and is reported as unsupported.
- Binary/audio/rich resource rendering is deferred; T3 Code keeps bounded metadata out of the
  activity stream instead of sending base64 payloads over WebSockets.
- Mid-session skill controls, custom-agent selection, and provider-specific rich rendering are not
  part of the preview.
- Copilot token context is shown in-thread, but the global usage scanner does not yet aggregate
  Copilot native history.
