# Specification: windows-portable-packaging-tests

## Acceptance criteria

1. Text executable fixtures bypass only the host-native execution probe.
2. macOS signing paths accept native separators.
3. Symlink fixtures skip only when an unprivileged probe fails.
4. Runtime source is unchanged.
5. The focused Windows suite passes with at most the capability-based skip.

## Dependency

Hard parent: `phase1-foundation`.
