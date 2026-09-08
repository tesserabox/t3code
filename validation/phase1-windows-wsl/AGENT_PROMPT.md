# Paste this prompt into the Windows agent

You are validating the T3 Code Phase 1 foundation on a real Windows 11 x64
machine with x64 Ubuntu under WSL2. Work through the task end to end; do not
stop after writing a plan.

Repository and handoff:

- Clone `https://github.com/tesseracode/t3code.git`.
- Checkout branch `validation/phase1-windows-wsl`.
- Require commit `7032ad0c135d451554c552daa9178783a11b5cd7` to be an ancestor
  of `HEAD`; it is the reviewed validation baseline.
- Read `AGENTS.md` and
  `validation/phase1-windows-wsl/README.md` completely before running commands.
- The immutable product source under test is branch `phase1/foundation`,
  commit `39295aed7a950a925791579661e79c4ff6b9072e`.
- The validation branch is a temporary handoff. Do not merge it into the
  product source.

Authority and safety:

- You may inspect the machine and install missing ordinary build prerequisites
  needed by the runbook on Windows and Ubuntu.
- Ask before rebooting, enabling a Windows feature, creating/importing a WSL
  distro, or making a machine-wide change unrelated to the listed
  prerequisites.
- You have permission to launch and interact with the locally built Electron
  app and local browser UI for this validation.
- Never use an existing T3 Code Windows or WSL state directory. The integrated
  launcher must refuse if the selected WSL account already has `.t3` or
  `.copilot`; use a human-approved disposable distro/account in that case.
- Never print, copy, commit, or return credentials, device codes, pairing URLs,
  or Copilot auth files. If a Copilot device login is required, pause only for
  the human to complete the browser step.
- Do not kill processes by name or pattern. Stop only exact PIDs you started or
  that the harness recorded.
- Do not commit, push, open a pull request, dispatch a workflow, or edit product
  source. If the handoff itself is broken, make the smallest local handoff fix,
  rerun the affected check, and include the exact diff in the report.
- Raw logs remain local. Return only sanitized evidence.

Execution:

1. Verify that the validation branch is current and the worktree has no
   unexpected tracked changes:

   ```powershell
   git merge-base --is-ancestor `
     7032ad0c135d451554c552daa9178783a11b5cd7 `
     HEAD
   if ($LASTEXITCODE -ne 0) { throw "Validation baseline is missing." }
   git status --short
   ```
2. Inspect prerequisites from the README. Install only what is missing. Use
   PowerShell 7.3 or newer (`pwsh`), not Windows PowerShell 5.1, for the
   runner.
3. Run:

   ```powershell
   pwsh -NoLogo -NoProfile -File .\validation\phase1-windows-wsl\run.ps1 `
     -WslDistro Ubuntu
   ```

   If the distro has another exact name, pass that name instead. Do not weaken
   commit, architecture, hash, version, or isolation checks.
4. Investigate any failure to root cause. Distinguish:
   - missing host prerequisite;
   - handoff/harness defect;
   - packaging defect;
   - Windows-native runtime defect;
   - WSL runtime defect;
   - Copilot authentication issue;
   - product integration/UI defect.
5. Once the automated run passes as far as the product allows, use
   `launch-desktop.ps1` and perform every integrated desktop check in the
   README. Use semantic UI/browser automation if available; otherwise perform
   the checks directly and ask the human only for authentication or an
   interaction that the agent cannot execute.
6. Test the real T3 GitHub Copilot approval flow on both the Windows and WSL
   projects. The direct packaged SDK probe is necessary but does not replace
   the integrated T3 UI turns.
7. Restart the isolated desktop app and verify persistence. Then test the
   intentionally invalid WSL distro against disposable settings and verify
   recoverable Windows fallback. Restore the disposable settings afterward.
8. Stop all exact PIDs started by the validation. Do not delete evidence before
   reporting it. Delete the exact retained `%TEMP%` stage recorded in
   `run-summary.json` after integrated evidence is captured; do not use a glob.
   Use `launch-desktop.ps1 -Stop -CleanupWslState` to remove only WSL state
   whose pre-run absence and validation ownership were recorded.

Reporting:

- Copy `validation/phase1-windows-wsl/RESULTS_TEMPLATE.md` to the run directory
  as `RESULTS.md`.
- Mark every gate `PASS`, `FAIL`, or `NOT RUN`; never infer success from a
  neighboring check.
- Include artifact paths, SHA-256 values, versions, source commit, WSL distro,
  environment-ID equality/inequality conclusions, and concise redacted failure
  excerpts.
- Do not include tokens, pairing URLs, auth material, prompt history outside
  the synthetic markers, or raw logs.
- Return the full sanitized `RESULTS.md`, the full `run-summary.json`, and any
  local handoff diff. End with one verdict:
  - `WINDOWS_AND_WSL_PASS`
  - `PRODUCT_DEFECT_FOUND`
  - `HOST_PREREQUISITE_BLOCKED`
  - `VALIDATION_INCOMPLETE`

Do not claim the gate passed unless both automated and integrated tables contain
no `FAIL` or `NOT RUN` rows.
