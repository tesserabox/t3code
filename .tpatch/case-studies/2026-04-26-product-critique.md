# tpatch Product Critique — From 3 Weeks of Real-World Usage

**Context**: 18 features, 51+ commits, 2 upstream syncs, 1 cross-platform handoff (macOS→Windows), 3 case studies.

---

## Is tpatch just a git wrapper?

**No, but it's close.** Here's what it adds beyond git:

### What tpatch actually does that git doesn't:

1. **Intent tracking** — `spec.md`, `analysis.md`, `exploration.md` capture *why* a change exists, not just *what* changed. Git commits have messages, but they're retrospective. tpatch's phases force you to articulate intent *before* coding.

2. **Deterministic replay** — `apply-recipe.json` is a step-by-step script that can re-apply changes to a different version of the upstream. Git patches are diffs; recipes are operations. The difference matters when context lines shift.

3. **Reconciliation semantics** — `tpatch reconcile` answers "can my feature survive an upstream update?" with a 4-phase decision tree. Git merge/rebase tells you "do lines conflict?" — tpatch tells you "does your feature still make sense?"

4. **Feature lifecycle** — requested → analyzed → defined → implementing → applied → active. Git has branches. tpatch has states with artifacts at each phase.

### What it doesn't add (honestly):

1. **Conflict resolution** — Phase 3.5 (`--resolve`) helps, but we still manually resolved 20+ file conflicts in our first upstream sync. The "provider-assisted" resolution is conceptually right but practically immature.

2. **Recipe reliability** — The LLM `implement` phase produces garbage 90%+ of the time. We never successfully used Path A end-to-end. Every feature used Path B (agent-authored).

3. **Cross-feature awareness** — tpatch doesn't know that `copilot-dynamic-models` depends on `copilot-cli-provider`. Features are islands. Dependencies are implicit.

---

## "Git with Intent" — is that the right framing?

**Yes, if you expand what "intent" means.**

Git tracks: "these lines changed in this file."
tpatch tracks: "we wanted to add Copilot provider support because of upstream issue #193, here's the spec, here's what we explored, here's the recipe to replay it, and here's whether it survived the last upstream update."

The value isn't in the mechanics (which ARE a git wrapper — patches, diffs, apply). The value is in the **metadata lifecycle** that wraps around git:

```
Intent (spec) → Exploration → Implementation → Recording → Reconciliation
```

Each step produces an artifact. Each artifact is useful to the next agent/human/session that touches this feature. That's not something git gives you.

---

## "A tool to keep your forks up to date" — is that accurate?

**Partially.** It's more like:

> "A tool to keep your fork's **customizations** alive across upstream updates, with enough metadata for agents to understand and re-apply them."

The "up to date" framing undersells it. Keeping forks up to date is `git merge upstream/main`. tpatch's value is knowing *which of your 18 custom features survived the merge* and *which need re-implementation*.

---

## Is it more than just forks?

**Potentially, but the current UX is fork-focused.** The concepts (intent tracking, deterministic replay, reconciliation) could apply to:

- **Feature flags / progressive rollout** — "is this feature still valid against the new API version?"
- **Multi-tenant customization** — "customer A's patches vs customer B's patches on the same base"
- **Agent-driven development** — "here's the spec, here's the exploration, now implement" (this is basically how we used it)

But today, the CLI commands (`upstream-ref`, `reconcile`, `record --from`) are all fork vocabulary.

---

## Is it just a hassle?

**Sometimes, yes.** Honest assessment of friction:

### High friction:
- **Recipe generation** — Manual Node script every time. Should be built into `record`.
- **Cross-feature file tracking** — Patches capture wrong files when features share code. Manual scoping needed.
- **Post-rebase metadata staleness** — After `git rebase -i`, all tpatch recordings are stale and need regeneration.
- **LLM implement phase** — Never worked for us. Path B (manual) every time.

### Low friction:
- **`tpatch add --slug`** — Quick, clean feature registration
- **`tpatch status`** — Good overview of all features
- **`tpatch record --from`** — When it works (single-feature commits), it's great
- **`--manual` flag** — v0.4.3's best addition. Lets agents bypass the LLM entirely.

### Worth the overhead?
**Yes, for fork management with 5+ features.** Below that, git branches + good commit messages are enough. Above that, the metadata lifecycle pays for itself — especially across sessions/agents/platforms.

---

## What tpatch should become

Based on 3 weeks of usage, tpatch's **real product** is:

> **An agent-native feature lifecycle manager for maintained forks.**

The key insight: tpatch is most valuable when **agents** are the primary users, not humans. Agents need structured intent (spec.md), deterministic replay (recipe), and reconciliation verdicts. Humans need good git hygiene. tpatch bridges the gap.

The CLI should lean into this identity:
1. Auto-generate recipes from `record` (close the Path B gap)
2. Feature dependencies (`depends_on: [parent-slug]`)
3. Better reconcile conflict resolution (the v0.5.0 shadow worktree is the right direction)
4. Per-feature test commands (already partially there)
5. Recipe stale detection (v0.5.1's `recipe-provenance.json` is good)

The skill file is the most important asset — it teaches agents the methodology. Keep investing there.
