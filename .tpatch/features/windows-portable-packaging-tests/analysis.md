# Analysis: windows-portable-packaging-tests

## Problem

Five focused packaging tests failed deterministically on non-elevated Windows
before packaging started: three executed text `.exe` placeholders, one assumed
POSIX path separators, and one assumed symlink privileges.

## Compatibility

This backports authoritative upstream commits `0a590fa01` and `30f128fab`.
Runtime and packaging behavior are unchanged.

## Recommendation

Land the three-file upstream test portability patch as a replay parent for
subsequent Windows packaging work.
