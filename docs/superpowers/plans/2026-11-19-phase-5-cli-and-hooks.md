# DonAron-plugin Phase 5 — `donaron` CLI & Live Hook Bridge (`@donaron/cli`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify `@donaron/cli` (`apps/cli`) — the complete `donaron` command-line interface (`doctor`, `adapter capabilities`, `plugin validate|info|list|install|uninstall`, `export`, `workflow start|status|advance|register-author|record-review`, `gate run|status|override`, and `hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>`), plus an end-to-end workflow and hook enforcement suite against a Node.js + React fixture repository — at ≥70% test coverage across all metrics.

**Architecture:** `@donaron/cli` (`apps/cli`) is a thin orchestration layer over `@donaron/core`, `@donaron/gates`, and `@donaron/adapters` using Node.js built-ins (zero domain logic duplication and zero new external npm packages required). Commands accept an injectable `CliExecutionContext` (`cwd`, `stdin`, `isInteractiveTty`, `confirmed`, `registryFilePath`, `antigravityPluginsDir`, `claudePluginsDir`, `pretestRunner`) for fast in-process unit testing while `apps/cli/src/cli.ts` wires real `process.argv`, `process.cwd()`, `process.stdin`, and `process.stdout` for subprocess execution. Work executes on branch `phase-5/cli-and-hooks` cut from `phase-4/harness-adapters` (`7fe2498`).

**Tech Stack:** TypeScript 5.8 (strict ESM / `NodeNext`), Node.js `>=24.0.0`, `@donaron/core`, `@donaron/gates`, `@donaron/adapters`, Vitest + `@vitest/coverage-v8`, ESLint 9 (`strictTypeChecked`), Prettier.

**Spec:** [2026-11-19-donaron-plugin-design.md](../specs/2026-11-19-donaron-plugin-design.md) (§5, §6.5, §7 Phase 5)

---

## Global Constraints

- **Repository root:** `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`; work on branch `phase-5/cli-and-hooks` branched from `phase-4/harness-adapters` (`7fe2498`).
- **Backward compatibility:** Preserve `DONARON_CLI_VERSION`, `CliInfo`, `CliRunResult`, `getCliInfo()`, and `runCli(argv, context?)` in `apps/cli/src/index.ts` so all existing Phase 1 tests (`apps/cli/src/index.test.ts` and `tests/foundation/build-and-coverage.test.ts`) continue to pass unchanged.
- **Zero domain logic duplication:** All manifest loading, policy checking, scoped hashing, gate evaluation, workflow transitions, and hook translations delegate to `@donaron/core`, `@donaron/gates`, and `@donaron/adapters`.
- **Trust & Security Boundaries:**
  - `donaron plugin install` displays requested plugin permissions (`plugin.manifest.permissions`) and requires explicit confirmation (`--yes` or `context.confirmed === true` in an interactive TTY) whenever permissions are non-empty.
  - `donaron gate override` requires `isInteractiveTty === true`, explicit confirmation (`--yes` or `context.confirmed === true`), non-empty `--approver`, and `--reason` ≥ 10 chars, and is strictly rejected on Gate 03 `critical` findings (`CRITICAL_SECURITY_NON_OVERRIDABLE`).
  - `donaron hook <harness> <Event>` fails closed if `stdin` is malformed JSON or empty (returning a native `deny` / `block` payload on `PreToolUse` and a safe `allow_stop` payload on `Stop` so the host harness never crashes or fails open).
- **Phase 5 Green Bar:** `pnpm run clean && pnpm run check` exits `0` with ≥70% lines, statements, functions, and branches both across the monorepo and across `apps/cli/src/**`.

## Review Focus

1. **Fail-closed `donaron hook` stdin/stdout bridge:** When invoked via `donaron hook <antigravity|claude-code> PreToolUse` with malformed JSON stdin, missing `cwd`, or a policy violation (e.g. `.donaron/**` write, `donaron gate override`, `.env` read, `rm -rf /`), the CLI must output a valid harness-native JSON deny/block object on `stdout` — pinned by Task 4 unit and subprocess E2E tests.
2. **Permission confirmation on `donaron plugin install`:** Installing a plugin that declares permissions without `--yes` (or interactive confirmation) must fail closed with `INSTALL_CONFIRMATION_REQUIRED` and write nothing to the target harness folder — pinned by Task 2 tests.
3. **Interactive TTY enforcement on `donaron gate override` and tier downgrades on `donaron workflow start`:** Agent or non-TTY invocations of `donaron gate override` (`isInteractiveTty: false`) must be rejected, Gate 03 critical security findings must never be overridable, and `--actor agent` must be blocked from starting `--tier standard` or `--tier quick` — pinned by Task 3 & Task 4 tests.
4. **End-to-end strict 5-gate workflow progression via CLI:** A Node.js + React workspace must be able to run `workflow start` → `workflow register-author` → `workflow record-review` → `gate run 01` → `workflow advance IMPLEMENTATION` → `gate run 02..05` → `workflow advance COMPLETED` with live `planHash`/`codeHash` tracking and anti-self-approval enforcement — pinned by Task 3 & Task 4 E2E tests.
5. **Structured `--json` output across all commands:** Every CLI command (`doctor`, `adapter capabilities`, `plugin *`, `export`, `workflow *`, `gate *`) must emit valid parseable JSON when `--json` is passed — pinned by Tasks 1–4 tests.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── apps/cli/
│   └── src/
│       ├── index.ts                                  # public barrel: DONARON_CLI_VERSION, getCliInfo, runCli
│       ├── index.test.ts                             # Phase 1 baseline CLI tests
│       ├── cli.ts                                    # Node CLI bin entrypoint reading stdin for hook command
│       ├── types.ts                                  # CliExecutionContext, ParsedCliArgs
│       ├── args.ts                                   # deterministic argv flag & positional argument parser + output helpers
│       └── commands/
│           ├── doctor-and-adapter.ts                 # `donaron doctor` and `donaron adapter capabilities`
│           ├── plugin-and-export.ts                  # `donaron plugin validate|info|list|install|uninstall` and `donaron export`
│           ├── workflow-and-gate.ts                  # `donaron workflow start|status|advance|register-author|record-review` and `donaron gate run|status|override`
│           ├── hook-command.ts                       # `donaron hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>`
│           └── commands.test.ts                      # comprehensive unit tests for all CLI commands & flags
├── tests/
│   └── e2e/
│       └── cli-workflow-e2e.test.ts                  # E2E CLI & subprocess hook tests against a Node.js + React fixture repo
└── docs/
    ├── cli-reference.md
    └── superpowers/plans/2026-11-19-phase-5-cli-and-hooks.md
```

---

### Task 1: Branch Setup, CLI Context & Arg Parser (`types.ts`, `args.ts`), and `doctor` & `adapter capabilities` Commands (`commands/doctor-and-adapter.ts`)

**Files:**

- Create: `apps/cli/src/types.ts`
- Create: `apps/cli/src/args.ts`
- Create: `apps/cli/src/commands/doctor-and-adapter.ts`
- Test: `apps/cli/src/commands/commands.test.ts` (Part 1: arg parser, `doctor`, `adapter capabilities`)

**Interfaces:**

- Produces (`apps/cli/src/types.ts`):

  ```ts
  import type { PretestCheckRunner } from '@donaron/gates';

  export interface CliInfo {
    readonly name: string;
    readonly version: string;
    readonly modules: readonly {
      readonly name: string;
      readonly version: string;
      readonly dependencies: readonly string[];
    }[];
  }

  export interface CliRunResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  export interface CliExecutionContext {
    readonly cwd?: string;
    readonly stdin?: string;
    readonly isInteractiveTty?: boolean;
    readonly confirmed?: boolean;
    readonly actorType?: 'agent' | 'human';
    readonly registryFilePath?: string;
    readonly antigravityPluginsDir?: string;
    readonly claudePluginsDir?: string;
    readonly cliEntryPath?: string;
    readonly pretestRunner?: PretestCheckRunner;
  }

  export interface ParsedCliArgs {
    readonly positionals: readonly string[];
    readonly flags: Readonly<Record<string, string | boolean | readonly string[]>>;
    readonly json: boolean;
  }
  ```

- Produces (`apps/cli/src/args.ts` & `apps/cli/src/commands/doctor-and-adapter.ts`):

  ```ts
  export function parseCliArgs(argv: readonly string[]): ParsedCliArgs;
  export function formatCliOutput(
    data: unknown,
    humanText: string,
    asJson: boolean,
    exitCode?: number,
  ): CliRunResult;
  export function formatCliError(
    code: string,
    message: string,
    asJson: boolean,
    details?: unknown,
  ): CliRunResult;
  export function handleDoctorCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  export function handleAdapterCommand(parsed: ParsedCliArgs): CliRunResult;
  ```

- [ ] **Step 1: Create branch `phase-5/cli-and-hooks` from `phase-4/harness-adapters`**

Run (sandbox): `git checkout -b phase-5/cli-and-hooks` inside `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.

- [ ] **Step 2: Write `apps/cli/src/types.ts` and failing tests in `apps/cli/src/commands/commands.test.ts` (Part 1)**

Test:

- `parseCliArgs` parses positional args, boolean flags (`--json`, `--yes`, `--overwrite`, `--approved`, `--rejected`), key-value flags (`--target antigravity`, `--tier strict`, `--reason "long reason"`), and repeated/comma-separated flags (`--plan docs/plan.md`).
- `handleDoctorCommand`: reports Node version, workspace modules (`@donaron/core`, `@donaron/gates`, `@donaron/adapters`), active workflow presence in `cwd`, and installed plugin counts in both human text and `--json` mode.
- `handleAdapterCommand`: supports `adapter capabilities`, `adapter capabilities antigravity [--json]`, `adapter capabilities claude-code [--json]`, and rejects unknown harness names with `exitCode: 1`.

- [ ] **Step 3: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts`
Expected: FAIL because `args.ts` and `doctor-and-adapter.ts` do not exist.

- [ ] **Step 4: Implement `apps/cli/src/args.ts` and `apps/cli/src/commands/doctor-and-adapter.ts`**

- [ ] **Step 5: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(cli): add CLI arg parser, doctor diagnostics, and adapter capabilities commands"`

---

### Task 2: `plugin` (`validate`, `info`, `list`, `install`, `uninstall`) and `export` Commands (`commands/plugin-and-export.ts`)

**Files:**

- Create: `apps/cli/src/commands/plugin-and-export.ts`
- Modify: `apps/cli/src/commands/commands.test.ts` (add `plugin` and `export` tests)

**Interfaces:**

- Consumes: `loadPlugin` from `@donaron/core`; `getHarnessAdapter`, `listHarnessAdapters`, `PluginInstallationRegistry`, `HarnessId` from `@donaron/adapters`.
- Produces (`apps/cli/src/commands/plugin-and-export.ts`):

  ```ts
  export function handlePluginCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  export function handleExportCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  ```

- [ ] **Step 1: Write failing tests for `plugin` and `export` in `commands.test.ts` (Review Focus #2, #5)**

Test:

- `plugin validate <dir> [--json]` returns `exitCode: 0` on `tests/fixtures/plugins/valid-sample` and `exitCode: 1` with validation issues on `tests/fixtures/plugins/invalid-manifest`.
- `plugin info <dir> [--json]` returns manifest id, name, version, digest, permissions, skills, agents, rules, and hooks.
- `export <dir> --target antigravity --out <outDir> [--overwrite] [--json]` and `--target claude-code` export native bundles to `<outDir>`.
- **Permission confirmation guard (Review Focus #2):** `plugin install <dir> --target antigravity` without `--yes` (and without `context.confirmed === true` in an interactive TTY) fails closed with `exitCode: 1` and `INSTALL_CONFIRMATION_REQUIRED` when the plugin declares permissions.
- `plugin install <dir> --target all --yes [--json]` installs into both Antigravity and Claude Code plugin directories and records receipts in `PluginInstallationRegistry`.
- `plugin list [--target antigravity] [--json]` lists installed receipts.
- `plugin uninstall <name> [--target antigravity] [--json]` removes the installed directory and receipt.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts`
Expected: FAIL because `plugin-and-export.ts` does not exist.

- [ ] **Step 3: Implement `apps/cli/src/commands/plugin-and-export.ts`**

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(cli): add plugin validate/info/list/install/uninstall and export commands"`

---

### Task 3: `workflow` (`start`, `status`, `advance`, `register-author`, `record-review`) and `gate` (`run`, `status`, `override`) Commands (`commands/workflow-and-gate.ts`)

**Files:**

- Create: `apps/cli/src/commands/workflow-and-gate.ts`
- Modify: `apps/cli/src/commands/commands.test.ts` (add `workflow` and `gate` tests)

**Interfaces:**

- Consumes: `WorkflowOrchestrator`, `EvidenceStore`, `computePlanHash`, `computeCodeHash`, `evaluateRecordFreshness`, `evaluateGate01Planning`, `evaluateGate02Pretest`, `evaluateGate03Security`, `evaluateGate04Testing`, `evaluateGate05Signoff` from `@donaron/gates`.
- Produces (`apps/cli/src/commands/workflow-and-gate.ts`):

  ```ts
  export function handleWorkflowCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  export function handleGateCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  ```

- [ ] **Step 1: Write failing tests for `workflow` and `gate` commands in `commands.test.ts` (Review Focus #3, #4, #5)**

Test:

- `workflow start --run-id run-1 --task "Build feature" --plan docs/plan.md [--json]` defaults to `strict` tier and initializes `.donaron/runs/run-1/state.json`.
- `workflow start --tier quick --actor agent` fails closed (`TIER_DOWNGRADE_FORBIDDEN`).
- `workflow register-author --kind plan --actor-id planner-1` and `--kind code --actor-id dev-1`.
- `workflow record-review --gate GATE_01 --role intake-reviewer --reviewer-id planner-1 --approved --summary "Self"` fails closed (`SELF_APPROVAL_FORBIDDEN`).
- `workflow record-review` with independent reviewers succeeds and automatically attaches current `planHash` / `codeHash`.
- `gate run 01`, `gate run 02`, `gate run 03`, `gate run 04`, `gate run 05`, and `gate run all` evaluate deterministic gates, persist evidence, update orchestrator state, and return `exitCode: 0` on `PASS` or `1` on `FAIL`/`BLOCKED`.
- `workflow advance IMPLEMENTATION`, `workflow status [--json]`, and `gate status [--json]`.
- `gate override GATE_02 --reason "Emergency hotfix waiver" --approver jay-r --yes`:
  - Fails closed (`exitCode: 1`) when `isInteractiveTty` is `false` or `actorType === 'agent'`.
  - Fails closed (`exitCode: 1`, `CRITICAL_SECURITY_NON_OVERRIDABLE`) on Gate 03 critical security findings even with `isInteractiveTty: true`.
  - Succeeds when `isInteractiveTty: true` and `confirmed` on overridable gate failures.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts`
Expected: FAIL because `workflow-and-gate.ts` does not exist.

- [ ] **Step 3: Implement `apps/cli/src/commands/workflow-and-gate.ts`**

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run apps/cli/src/commands/commands.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(cli): add workflow and gate orchestration commands with TTY override guards"`

---

### Task 4: Live `hook` Bridge Command (`commands/hook-command.ts`), `runCli` Dispatcher (`index.ts`, `cli.ts`), and E2E Node+React Fixture Tests (`tests/e2e/cli-workflow-e2e.test.ts`)

**Files:**

- Create: `apps/cli/src/commands/hook-command.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/cli.ts`
- Create: `tests/e2e/cli-workflow-e2e.test.ts`

**Interfaces:**

- Consumes: `getHarnessAdapter`, `executeNormalizedHook` from `@donaron/adapters`; all command handlers from `./commands/*.js`.
- Produces (`apps/cli/src/commands/hook-command.ts` & `apps/cli/src/index.ts`):

  ```ts
  export function handleHookCommand(
    parsed: ParsedCliArgs,
    context: CliExecutionContext,
  ): CliRunResult;
  export function runCli(argv: readonly string[], context?: CliExecutionContext): CliRunResult;
  ```

- [ ] **Step 1: Write failing E2E tests in `tests/e2e/cli-workflow-e2e.test.ts` (Review Focus #1, #3, #4)**

Create `tests/e2e/cli-workflow-e2e.test.ts` testing against a temporary Node.js + React workspace fixture (`package.json` with `react`, `docs/plan.md`, `src/App.tsx`, `coverage/test-results.json`, `coverage/coverage-summary.json`):

- Full strict 5-gate CLI lifecycle (`workflow start` → Gate 01 → `IMPLEMENTATION` → Gate 02 → Gate 03 → Gate 04 → Gate 05 → `COMPLETED`).
- Subprocess execution of compiled `apps/cli/dist/cli.js` via `spawnSync(process.execPath, [CLI_DIST, 'hook', 'antigravity', 'PreToolUse'], { input: ... })`:
  - Denies writing to `.donaron/runs/r1/state.json` and denies `donaron gate override`.
  - Denies malformed JSON `stdin` on `PreToolUse` with valid Antigravity JSON `{ "decision": "deny", ... }` and Claude Code JSON `{ "decision": "block", ... }`.
  - Blocks `Stop` (`{ "decision": "continue", ... }`) when an active workflow is in `IMPLEMENTATION` with incomplete gates, and allows `Stop` (`{ "decision": "" }`) once all 5 gates have fresh `PASS` evidence or when `continuationActive: true`.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run tests/e2e/cli-workflow-e2e.test.ts`
Expected: FAIL because `hook-command.ts` and `runCli` subcommand routing are not wired yet.

- [ ] **Step 3: Implement `hook-command.ts`, wire `apps/cli/src/index.ts` and `apps/cli/src/cli.ts`**

Ensure `apps/cli/src/cli.ts` reads `process.stdin` (fd `0`) when `process.argv[2] === 'hook'` and passes `isInteractiveTty: Boolean(process.stdin.isTTY && process.stdout.isTTY)` to `runCli`.

- [ ] **Step 4: Build project references and verify green (`apps/cli` + `tests/e2e`)**

Run: `.\node_modules\.bin\tsc.cmd --build && .\node_modules\.bin\vitest.cmd run apps/cli/ tests/e2e/cli-workflow-e2e.test.ts` and `tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(cli): wire live hook stdin/stdout bridge, runCli dispatcher, and E2E Node+React tests"`

---

### Task 5: Phase 5 CLI Reference Documentation, `README.md` Update & Full Monorepo Clean Green Check

**Files:**

- Create: `docs/cli-reference.md`
- Create: `docs/superpowers/plans/2026-11-19-phase-5-cli-and-hooks.md` (copied from this plan)
- Modify: `README.md` (mark Phase 5 **Implemented**)

- [ ] **Step 1: Author `docs/cli-reference.md`, copy plan to `docs/superpowers/plans/2026-11-19-phase-5-cli-and-hooks.md`, and update `README.md`**

Document every `donaron` command, synopsis, flags, exit codes, `--json` output schemas, interactive TTY override requirements, and `donaron hook <harness> <event>` stdin/stdout contracts in `docs/cli-reference.md`.

- [ ] **Step 2: Run full monorepo clean green-bar check**

Run: `pnpm run clean && pnpm run check`
And verify `coverage/coverage-summary.json` reports ≥70% across `lines`, `statements`, `functions`, and `branches` both overall and across `apps/cli/src/**`.
Expected: Exit `0`, all tests green, zero lint/typecheck/Prettier errors.

- [ ] **Step 3: Commit Task 5**

Run: `git add -A && git commit -m "docs(cli): add CLI reference documentation and mark Phase 5 implemented"`
Expected: clean working tree on `phase-5/cli-and-hooks`.
