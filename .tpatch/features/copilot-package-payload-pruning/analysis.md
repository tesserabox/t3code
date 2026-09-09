# Analysis: copilot-package-payload-pruning

## Problem

A real Windows x64 package produced 97 loose files against the authoritative
upstream 80-file budget. The pinned Copilot SDK contributes 32 unpacked
natives; 19 x64 files are duplicate or unreachable from T3's SDK server mode.

## Compatibility

The hook is conditional on exact Copilot runtime `1.0.75`, validates target
Windows and glibc-Linux files before pruning, keeps computer-use, and modifies
the common staging tree before ASAR and WSL archive creation.

## Recommendation

Prune the reviewed package layout rather than raising the upstream performance
budget, and fail closed on package drift.
