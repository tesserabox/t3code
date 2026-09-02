# Feature Request: Add Windows and WSL support for T3 Code. Support running projects from both Windows filesystem and WSL distros in the same desktop instance, with desktop-managed environment registration, isolated per-environment state, wsl.exe server spawning, wslpath translation, auto-install of the server binary inside WSL, and native file watching via inotify.

**Slug**: `windows-wsl-support`
**Created**: 2026-04-22T04:27:24Z

## Description

Add Windows and WSL support for T3 Code. Support running projects from both Windows filesystem and WSL distros in the same desktop instance. The feature includes WSL distro detection, `wsl.exe` server spawning, `wslpath` translation, auto-install of the server binary inside WSL, native `inotify` file watching, desktop-managed environment registration, and isolated state directories so local and WSL environments can coexist without clobbering runtime state or saved connection metadata.

Follow-up Windows desktop dev fix: server build must spawn the absolute Node executable directly instead of using shell mode. On Windows, shelling process.execPath from C:\Program Files splits the command at the space and makes bun run dev:desktop fail during t3#build with 'C:\Program' is not recognized.
