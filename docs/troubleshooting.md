# Troubleshooting Guide

---

## 1. `PreToolUse` Hook Denies a Tool Call Unexpectedly

- **Symptom:** Antigravity or Claude Code reports a tool call was denied by `donaron hook`.
- **Cause:** DonAron's fail-closed policy engine blocked a `.donaron/**` write, `.env`/key file access, out-of-workspace path (including symlink escapes), or destructive command.
- **Fix:** Keep file edits inside the workspace root, never edit `.donaron/**` directly (use `donaron workflow` / `donaron gate` CLI commands), and check `.donaron/policy.json` if custom workspace rules were added.

## 2. `Stop` Hook Blocks Stopping (`decision: "continue"` / `"block"`)

- **Symptom:** The agent cannot stop while in `IMPLEMENTATION` through `GATE_05`.
- **Cause:** One or more required gates for the active workflow (`strict` = Gates 01–05) are `MISSING`, `STALE` (code/tests edited after the gate ran), or `FAILED`.
- **Fix:** Run `node apps/cli/dist/cli.js workflow status` to see which gate is `STALE` or `MISSING`, re-run the required deterministic checks (`donaron gate run <id>`), or record an updated independent review bound to the new `codeHash`.
- **Loop Protection:** If `continuationActive: true` (Antigravity) or `stop_hook_active: true` (Claude Code) is set, the `Stop` hook yields (`allow_stop`) to prevent infinite loops.

## 3. `ANTIGRAVITY_RULES_SIZE_EXCEEDED` During Export or Validation

- **Cause:** Antigravity enforces a strict `< 24,000`-byte cap on `rules/AGENTS.md`.
- **Fix:** Move verbose guides out of `rules/*.md` into progressive `skills/<name>/references/*.md` files.

## 4. Gate 04 Fails on Monorepo Coverage Despite >70% Aggregate Total

- **Cause:** Gate 04 checks both the global aggregate AND every required workspace package (`packages/core`, `packages/gates`, `packages/adapters`, `apps/cli`).
- **Fix:** Inspect `coverage/coverage-summary.json` to locate the specific package under 70% on `lines`, `statements`, `functions`, or `branches` and add targeted tests.

## 5. `donaron gate override` Rejects Override Attempt

- **Cause:** Overrides require an interactive terminal (`isInteractiveTty: true`), human actor, `--yes`, non-empty `--approver`, `--reason` ≥ 10 chars, and **cannot** override Gate 03 `critical` security findings.
