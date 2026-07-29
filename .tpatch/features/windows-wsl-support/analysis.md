# Analysis: windows-wsl-support

## Summary

Windows and WSL support for T3 Code requires more than a single `BackendTarget`. The desktop app needs a native Windows-local environment plus opt-in WSL-managed environments, each with its own server base directory, persisted connection metadata, and routing rules. The implementation spans WSL distro detection, `wsl.exe` server spawning, `wslpath` translation, WSL bundle staging and auto-install, native `inotify` file watching, desktop-managed environment registration, and atomic persistence for multi-environment coexistence.

## Compatibility

- Major platform expansion; upstream is still oriented around a single desktop-local backend.
- Requires new platform-detection logic, path translation layers, process spawning strategies, and desktop IPC for managed environments.
- Requires per-environment state isolation so local and WSL servers do not share sqlite state, logs, settings, or saved environment credentials.
- Copilot SDK upgrade and Windows-specific CLI resolution are tracked separately so this feature stays focused on environment management.

## Risk: High

- Large surface area: filesystem, process management, path translation, desktop IPC, and persistence.
- WSL interop introduces edge cases (network, permissions, path formats, UTF-16 CLI output, shell passthrough quirks).
- Multi-environment persistence raises correctness risks under concurrent writes unless temp-file naming and cache persistence are hardened.
- No existing Windows CI infrastructure to validate against.
