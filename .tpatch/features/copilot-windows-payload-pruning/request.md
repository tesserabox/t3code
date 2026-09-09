# Feature Request: Prune Copilot CLI native payloads that are unreachable from T3's SDK server mode when packaging Windows plus WSL. Preserve the x64 Windows and glibc Linux CLI executables, core runtime natives, search tools, specialized clipboard bindings, and computer-use plugin; remove generic cross-platform clipboard duplicates, Linux-musl Koffi, and interactive-only pvrecorder, webview, and Foundry Local payloads from both server.asar and wsl-runtime.tar.gz so the Windows payload stays within the upstream 80-file budget without raising it.

**Slug**: `copilot-windows-payload-pruning`
**Created**: 2026-09-09T02:06:23Z

## Description

Prune Copilot CLI native payloads that are unreachable from T3's SDK server mode when packaging Windows plus WSL. Preserve the x64 Windows and glibc Linux CLI executables, core runtime natives, search tools, specialized clipboard bindings, and computer-use plugin; remove generic cross-platform clipboard duplicates, Linux-musl Koffi, and interactive-only pvrecorder, webview, and Foundry Local payloads from both server.asar and wsl-runtime.tar.gz so the Windows payload stays within the upstream 80-file budget without raising it.
