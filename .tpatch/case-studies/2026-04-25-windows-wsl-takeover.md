# tpatch Case Study: Taking Over windows-wsl-support Mid-Flight

**Repo:** tesserabox/t3code (fork of pingdotgg/t3code)
**Feature:** `windows-wsl-support`
**Context:** The feature was already registered, partially implemented, and already in `applied` state with an older recorded patch. New work was added later on top of an otherwise dirty branch.

---

## 1. Proposed Methodology vs Skill Guidance

The proposed workflow was:

1. `tpatch apply <slug> --mode started` / "start manual"
2. commit the feature changes
3. `tpatch apply <slug> --mode done` / "stop manual"
4. `tpatch record <slug> --from <new-commit>~1`
5. generate the recipe from the recorded changes
6. add descriptions
7. commit the tpatch metadata
8. run `tpatch status`

The skill and repo guidance say:

1. always run `tpatch status <slug>` and `tpatch next <slug>` first
2. use Path B for manual work when the agent is acting as the provider
3. use `tpatch apply <slug> --mode started` and `--mode done` only while the feature is actually in the implementing/apply portion of the state machine
4. prefer `tpatch record <slug>` before commit on a clean tree, or use `--from <base>` if the code is already committed
5. generate the recipe after record, then commit the metadata separately

So the two procedures are mostly the same in intent, but not identical in control points.

---

## 2. Where They Match

- Both approaches are Path B workflows: the agent authors the change and tpatch records it after the fact.
- Both approaches isolate the implementation commit from the metadata commit.
- Both approaches use `record --from <commit>~1` as the practical way to package already-committed work.
- Both approaches rely on a post-record recipe generation step because Path B does not naturally produce a high-quality recipe.

These common points are the useful core of the workflow. For a takeover session, the commit-bounded diff is especially valuable because it gives an explicit patch boundary even when the working tree is noisy.

---

## 3. Where They Differ

### A. `status` / `next` first vs inferred next step

The skill explicitly says to ask tpatch for the current state before doing anything. The proposed workflow jumps directly to `apply --mode started`.

**Good in the skill:** it prevents moving the feature backwards or re-entering the wrong phase.

**Bad in the proposed flow:** it assumes the feature is still in the apply phase.

For this feature, `tpatch status windows-wsl-support` showed the feature was already `applied`, and `tpatch next windows-wsl-support` said the next step was `tpatch test windows-wsl-support`. Re-running `apply --mode started` here would have been state-machine drift, not progress.

### B. `apply --mode started/done` on an already-applied feature

The repo workflow doc shows `apply --mode started` and `--mode done` as the normal Path B pair while a feature is being implemented. That is correct for a fresh or currently-implementing feature.

**Good in the proposed flow:** it creates an explicit implementation session boundary.

**Bad in this takeover:** the feature was no longer in that phase. The right move was to treat the new work as an update to an already-applied feature and re-record it from the new commit boundary.

### C. commit before record

The skill prefers `record` before commit on a clean tree. The proposed flow commits first, then records with `--from`.

**Good in the proposed flow:** for takeover work on a dirty branch, it is safer and more auditable. The commit becomes the source of truth.

**Bad in the proposed flow:** it depends on contiguous feature commits. If unrelated feature commits are interleaved, `record --from <base>` can still capture the wrong range unless you also verify file scope.

**Good in the skill default:** the patch is captured directly from the working tree without needing a commit boundary.

**Bad in the skill default for this scenario:** it assumes the working tree is clean enough to be authoritative. That was not true here.

### D. "manual" wording on `apply`

The manual flag belongs to `analyze`, `define`, `explore`, and `implement`. For `apply`, the meaningful flags are `--mode started`, `--mode execute`, and `--mode done`.

So the user shorthand of "start --manual / stop --manual" captured the intent, but not the exact CLI surface.

---

## 4. What Happened in Practice

The actual successful workflow for this takeover was:

1. `tpatch status windows-wsl-support`
2. `tpatch next windows-wsl-support`
3. notice the feature was already `applied`, so do **not** re-enter `apply --mode started/done`
4. make a feature-only implementation commit
5. run the feature test command directly in PowerShell
6. run `tpatch record windows-wsl-support --from <implementation-commit>~1`
7. regenerate the recipe with `node .tpatch/tools/generate-recipe.cjs windows-wsl-support <implementation-commit>~1 HEAD`
8. verify recorded patch headers against the implementation commit file list
9. fix metadata descriptions and write the case study
10. commit only the feature metadata

This ended up being the right adaptation for an already-started feature.

---

## 5. New Findings From This Takeover

### A. `tpatch test` is currently shell-broken on Windows

`tpatch test windows-wsl-support` failed with:

```text
exec: "sh": executable file not found in %PATH%
```

The configured command itself was valid. Running `bun run test:windows-wsl-support` directly in PowerShell passed.

**Implication:** on Windows, a failed `tpatch test` can currently mean the wrapper is broken, not the feature tests.

### B. `record --from` produced a clean patch, but a polluted summary

The recorded `post-apply.patch` contained the correct 18 feature files from the implementation commit. However, the generated summary in `record.md` / `post-apply-diff.txt` reflected the broader dirty working tree before manual correction.

**Good:** the authoritative patch itself was correct.

**Bad:** the human summary was misleading until fixed.

**Implication:** for takeover work on a dirty branch, you must verify both the patch headers and the summary output.

### C. GitHub Copilot SDK 0.3.0 introduced a cross-platform protocol break

The permission approval flow changed in `@github/copilot-sdk@0.3.0`. The public package-root typings still looked close to the older `PermissionRequest` / `PermissionRequestResult` contract, but the runtime behavior required a different approval shape.

**Implication:** this was not just a Windows problem. Any instance upgrading to 0.3.0 would need adapter-side compatibility work unless the upstream integration already handled the newer approval protocol.

### D. The Windows bug was real, but it was only one piece of the failure

The Windows-specific issue was Bun/Electron CLI resolution to the actual `copilot.exe` binary. That bug happened in the same session as the SDK upgrade break, which made it tempting to record both under the Windows feature.

**Implication:** proximity during debugging is not a valid feature boundary. One problem was platform-specific path resolution, while the other was a cross-platform SDK contract change.

### E. Highest-numbered replay patches must be treated as authoritative artifacts

This repo treats the highest-numbered patch in a feature's patch stack as the replay artifact that matters. That means a polluted or partial final patch is not just messy documentation; it is a broken reconstruction mechanism.

**Implication:** if a feature is being repaired after the fact, it is often safer to regenerate the final patch from an explicit scoped diff than to trust the existing patch sequence.

### F. Untracked feature files can silently disappear from replay metadata

The earlier scoped-diff regeneration fixed dirty-tree pollution, but it still missed new files that were not yet tracked by git. In this takeover, that meant the WSL replay metadata initially omitted `backendTarget.test.ts` and `atomicFile.ts`, and the SDK replay metadata initially omitted the new Copilot regression tests.

**Implication:** a `git stash create` snapshot is not enough when the feature still has untracked files. The safer repair workflow is a temporary index seeded from `HEAD`, then `git add --all -- <explicit feature file list>`, then diff the feature base commit against the synthetic tree. That preserves scoped replay artifacts without staging or stashing the entire dirty branch.

## 6. Splitting a Bug Across Multiple Already-Applied Features

This takeover turned into a feature-boundary correction exercise, not just a patch-recording exercise.

At first glance, the Windows failure looked like it belonged entirely to `windows-wsl-support` because the visible symptom was local Copilot startup on Windows. After tracing the actual changes, the split was clearer:

- `windows-wsl-support` owns the desktop-managed environment work: local-primary registration, WSL target plumbing, environment routing, and the UI/runtime glue needed to make Windows and WSL coexist predictably.
- `upgrade-github-copilot-sdk-to-0-3-0-adapt-the-copilot` owns the SDK 0.3.0 upgrade, the permission-protocol adapter changes, the Windows Bun/Electron CLI resolution fix, and the build-time Copilot package version alignment.

The difficult part is that both features were already effectively in flight, and one of them was already marked `applied`. That changes the workflow:

- you cannot rely on the state machine alone to tell the historical truth
- you have to correct the feature contract and metadata after discovering the better boundary
- you may need to regenerate cumulative replay artifacts so the highest-numbered patch reconstructs the feature on its own

In practice, that meant re-scoping the WSL artifacts, creating a brand-new feature for the SDK upgrade, and regenerating the final patch and recipe for each feature separately.

This is the main takeover lesson: fixing a bug in an already-applied feature is often less about changing code and more about restoring truthful patch history.

---

## 7. Recommended Takeover Workflow

For a feature that is already started or partially recorded, the best workflow is:

1. `tpatch status <slug>`
2. `tpatch next <slug>`
3. if the feature is already `applied`, do not re-run `apply --mode started/done` unless you intentionally reopen or re-stage the feature
4. make a feature-only code commit
5. validate the feature directly; if `tpatch test` is wrapper-broken on the host OS, record that separately
6. `tpatch record <slug> --from <feature-commit>~1`
7. generate the recipe from the same commit range
8. compare patch headers against `git diff --name-only <feature-commit>~1..HEAD`
9. if the work actually spans multiple features, split the file lists and regenerate each feature's final replay patch separately
10. correct any polluted summaries or stale feature descriptions
11. commit only the tpatch metadata

This is close to the user's proposed methodology, but stricter about respecting the existing feature state and stricter about verifying summary pollution.

---

## 8. Overall Evaluation

The proposed methodology and the skill describe the same underlying Path B workflow, but at different levels of rigor.

- The proposed methodology is pragmatic and works well for takeover sessions because it anchors everything to an explicit feature commit.
- The skill is better about state discipline because it forces `status` / `next` before action.
- The repo's generate-recipe step remains necessary and useful; it fills a real Path B gap.
- For already-applied features, the safest hybrid is: **skill-first state check, proposed-flow commit boundary, then record/generate/metadata commit**.
- When a debugging session uncovers both platform-specific fixes and cross-platform dependency-adaptation work, the correct response is usually feature separation, not one oversized retrospective patch.

That hybrid is the best match for incomplete features that are resumed later on a branch with unrelated churn.
