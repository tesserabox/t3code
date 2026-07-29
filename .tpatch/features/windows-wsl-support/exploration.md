# Exploration: windows-wsl-support

## Architecture Pattern (VS Code model)

- Split architecture: UI runs on Windows (Electron), server runs inside WSL
- Spawn via `wsl.exe -d <distro> -- <server-binary>`
- Communicate over stdio/RPC (same as existing WebSocket model)

## Key Technical Challenges

- File access via `\\wsl$\` is 100-500x slower than native — must run server inside WSL
- File watching doesn't work across WSL boundary — need inotify inside WSL
- Path translation requires `wslpath` utility
- Auth tokens must be passed from Windows to WSL via env vars or RPC

## Relevant Files

- `apps/desktop/src/main.ts` — server spawning, would need WSL detection
- `apps/server/src/bin.ts` — server entry point, would run inside WSL
- `apps/server/src/provider/Layers/copilotCliPath.ts` — binary resolution, needs WSL paths
- `scripts/build-desktop-artifact.ts` — may need Linux binary for WSL

## Dual-Server Question

- Could run Windows server for Windows projects + WSL server for WSL projects
- Requires multiplexing in the desktop app based on project path
- `\\wsl.localhost\` prefix detection to route to correct server
