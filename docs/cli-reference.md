# DonAron CLI & Live Hook Bridge Reference (`@donaron/cli`)

This document specifies the `donaron` command-line interface and live harness hook bridge implemented in `@donaron/cli` (`apps/cli`).

---

## 1. Implementation Status: Implemented vs. Planned

| Capability | Status | Location / Target Phase |
| --- | --- | --- |
| `donaron doctor [--json]` diagnostics | **Implemented (Phase 5)** | `apps/cli/src/commands/doctor-and-adapter.ts` |
| `donaron adapter capabilities [antigravity\|claude-code] [--json]` | **Implemented (Phase 5)** | `apps/cli/src/commands/doctor-and-adapter.ts` |
| `donaron plugin <validate\|info\|list\|install\|uninstall> [--json]` | **Implemented (Phase 5)** | `apps/cli/src/commands/plugin-and-export.ts` |
| `donaron export <dir> --target <antigravity\|claude-code> --out <dir>` | **Implemented (Phase 5)** | `apps/cli/src/commands/plugin-and-export.ts` |
| `donaron workflow <start\|status\|advance\|register-author\|record-review>` | **Implemented (Phase 5)** | `apps/cli/src/commands/workflow-and-gate.ts` |
| `donaron gate <run\|status\|override>` (with TTY & critical-security guards) | **Implemented (Phase 5)** | `apps/cli/src/commands/workflow-and-gate.ts` |
| `donaron hook <antigravity\|claude-code> <SessionStart\|PreToolUse\|PostToolUse\|Stop>` | **Implemented (Phase 5)** | `apps/cli/src/commands/hook-command.ts` |
| End-to-end Node.js + React CLI workflow & subprocess hook bridge suite | **Implemented (Phase 5)** | `tests/e2e/cli-workflow-e2e.test.ts` |
| Flagship personal Node.js + React plugin (`plugins/donaron-dev`) | **Planned (Phase 6)** | `plugins/donaron-dev` |
| Self-gated verification & installation/troubleshooting docs | **Planned (Phase 7)** | `docs/` |

---

## 2. Global Flags & Exit Codes

- `--version`, `-v`: Prints `donaron <version>` and exits `0`.
- `--help`, `-h`: Prints full command synopsis and workspace module versions and exits `0`.
- `--json`: Emits structured JSON on `stdout` (`{ "ok": true, ... }` on success or `{ "ok": false, "error": { "code", "message", "details"? } }` on failure).
- **Exit codes:**
  - `0`: Command succeeded (or `donaron hook` emitted a valid harness hook payload on `stdout`).
  - `1`: Validation error, failed/blocked gate evaluation, unconfirmed permission prompt, non-TTY override attempt, or unknown flag/subcommand.

---

## 3. Command Reference

### 3.1 `donaron doctor`

```bash
donaron doctor [--json]
```

Inspects the local environment and reports:
- Node.js runtime version and OS platform
- Active workspace root (`process.cwd()`)
- Loaded workspace modules (`@donaron/core`, `@donaron/gates`, `@donaron/adapters`)
- Target harness plugin directories (`~/.gemini/config/plugins` for Antigravity, `~/.claude/plugins` for Claude Code)
- Installed plugin count from `~/.donaron/registry.json`
- Active `.donaron/active-run.json` workflow state (`runId`, `tier`, `state`, `taskDescription`) if present in the workspace

### 3.2 `donaron adapter capabilities`

```bash
donaron adapter capabilities [antigravity|claude-code] [--json]
```

Displays the honest capability matrix (`NATIVE`, `EMULATED`, `PARTIAL`, `UNSUPPORTED`, `UNVERIFIED`) for all v1 harness adapters or a single specified harness.

### 3.3 `donaron plugin`

```bash
donaron plugin validate <dir> [--json]
donaron plugin info <dir> [--json]
donaron plugin list [--target antigravity|claude-code] [--json]
donaron plugin install <dir> [--target antigravity|claude-code|all] [--yes] [--json]
donaron plugin uninstall <name> [--target antigravity|claude-code] [--json]
```

- **`validate <dir>`:** Loads `<dir>` via `@donaron/core`'s `loadPlugin` (verifying `donaron-plugin.v1.schema.json`, safe paths, skills, agents, rules, hooks, and policies) and checks compatibility against both `AntigravityAdapter` (including the `< 24,000`-byte `rules/AGENTS.md` limit) and `ClaudeCodeAdapter`.
- **`info <dir>`:** Prints manifest metadata, SHA-256 bundle digest, requested permissions, and capability inventory.
- **`list`:** Lists installed plugin receipts from `~/.donaron/registry.json` (optionally filtered by `--target`).
- **`install <dir>`:**
  - **Permission Confirmation Guard:** If the plugin declares any permissions (`fs:read`, `fs:write`, `cmd:exec`, `net:outbound`, `env:read`), `install` fails closed with `INSTALL_CONFIRMATION_REQUIRED` unless `--yes` (or interactive TTY confirmation) is supplied.
  - Exports and deploys the plugin into the target harness directory (`~/.gemini/config/plugins/<name>` and/or `~/.claude/plugins/<name>`) without modifying `~/.gemini/config/config.json`, and records provenance in `~/.donaron/registry.json`.
- **`uninstall <name>`:** Validates `<name>` against path traversal, verifies the recorded `installedPath` basename matches `<name>`, removes the deployed folder, and removes the receipt from `~/.donaron/registry.json`.

### 3.4 `donaron export`

```bash
donaron export <dir> --target <antigravity|claude-code> --out <outDir> [--overwrite] [--json]
```

Compiles a universal DonAron plugin directory into a native bundle for `--target antigravity` or `--target claude-code` at `--out <outDir>`. Fails closed with `EXPORT_DIR_NOT_EMPTY` if `<outDir>` is non-empty and `--overwrite` is not passed.

### 3.5 `donaron workflow`

```bash
donaron workflow start [--run-id <id>] [--task <text>] [--tier strict|standard|quick] [--plan <files...>] [--actor human|agent] [--actor-id <id>] [--json]
donaron workflow status [--run-id <id>] [--json]
donaron workflow advance <targetState> [--run-id <id>] [--actor-id <id>] [--json]
donaron workflow register-author --kind <plan|code> --actor-id <id> [--run-id <id>] [--json]
donaron workflow record-review --gate <GATE_01|02|03|05> --role <role> --reviewer-id <id> [--approved|--rejected] --summary <text> [--checklists <csv>] [--scope <text>] [--limitations <text>] [--run-id <id>] [--json]
```

- **`start`:** Defaults `--tier` to `'strict'` (all 5 gates mandatory). Rejects `--tier standard` or `--tier quick` when `--actor agent` (`TIER_DOWNGRADE_FORBIDDEN`).
- **`status`:** Computes live `planHash` and `codeHash` and reports current state, retry counts, and `FRESH`/`STALE`/`MISSING`/`FAILED` status for Gates 01–05.
- **`advance <targetState>`:** Enforces legal workflow transitions and gate freshness prerequisites (including automatic stale-evidence detection if files were edited during `TESTING`).
- **`register-author` & `record-review`:** Records artifact authors and binds review records to current workspace `planHash` / `codeHash` while enforcing anti-self-approval (`SELF_APPROVAL_FORBIDDEN`) and per-gate reviewer role allowlists (`UNAUTHORIZED_REVIEWER_ROLE`).

### 3.6 `donaron gate`

```bash
donaron gate run <01|02|03|04|05|all> [--run-id <id>] [--offline-waiver <reason>] [--packages <csv>] [--allow-skipped] [--json]
donaron gate status [--run-id <id>] [--json]
donaron gate override <gateId> --reason <text> --approver <name> [--run-id <id>] [--yes] [--json]
```

- **`run`:** Evaluates deterministic Gate 01, 02, 03, 04, 05, or `all`, writes numbered evidence records under `.donaron/runs/<runId>/evidence/`, updates the workflow state machine (`handleGateResult`), and exits `0` on `PASS` or `1` on `FAIL`/`BLOCKED`.
- **`status`:** Reports latest decision, findings count, and live freshness for Gates 01–05.
- **`override`:**
  - **Choice 1A Interactive Human TTY Guard:** Requires an interactive terminal session (`isInteractiveTty: true`), human actor, explicit confirmation (`--yes`), non-empty `--approver`, and `--reason` ≥ 10 characters.
  - **Hard Security Invariant:** Gate 03 (`GATE_03`) with any `critical` severity finding can **never** be overridden (`CRITICAL_SECURITY_NON_OVERRIDABLE`).

### 3.7 `donaron hook` (Live Harness Stdin/Stdout Bridge)

```bash
donaron hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>
```

Invoked automatically by native Antigravity (`hooks.json`) and Claude Code (`hooks/hooks.json`) lifecycle hooks:
1. Reads the harness-native JSON payload from `stdin` (fd `0`).
2. Translates `stdin` via `adapter.translateHookInput(event, rawStdin)`. If `stdin` is malformed JSON, fails closed by emitting a harness-native `deny` / `block` payload on `PreToolUse` or `allow_stop` payload on `Stop`.
3. Executes `executeNormalizedHook` (enforcing Choice 1A `.donaron/**` & override guards, Choice 2A global hazard guards even in non-workflow repos, custom `.donaron/policy.json` rules, and `Stop` gate completion checks with `continuationActive` loop protection).
4. Writes the harness-native JSON response to `stdout` and exits `0`.
