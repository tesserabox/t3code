# Specification: copilot-package-payload-pruning

## Acceptance criteria

1. X64 removes 19 unused loose natives; arm64 removes 20 plus non-target
   extensionless search tools.
2. Target executables, core runtime, search, specialized clipboard, Koffi, and
   Windows computer-use remain.
3. No-Copilot stages are unchanged.
4. Unsupported versions, missing target files, and layout drift fail.
5. Windows-only Copilot/Koffi packages do not enter the WSL archive.
6. The upstream 80-file limit remains unchanged.
7. Real packaged Windows and WSL runtime gates pass.

## Dependency

Hard parent: `windows-portable-packaging-tests`.
