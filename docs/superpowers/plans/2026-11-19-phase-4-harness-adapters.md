# DonAron-plugin Phase 4 — Antigravity & Claude Code Adapters (`@donaron/adapters`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify `@donaron/adapters` (`packages/adapters`) — the shared `HarnessAdapter` contract, honest capability matrix (`NATIVE`, `EMULATED`, `PARTIAL`, `UNSUPPORTED`, `UNVERIFIED`), universal hook execution bridge connecting `@donaron/core` policies and `@donaron/gates` workflows, native exporters and stdin/stdout hook translators for **Antigravity** and **Claude Code**, atomic installation & provenance registry, and golden contract tests — at ≥70% test coverage across all metrics.

**Architecture:** All Phase 4 implementation lives inside `packages/adapters` and depends only on `@donaron/core` (`workspace:*`), `@donaron/gates` (`workspace:*`), and Node.js built-ins (zero new external npm dependencies and zero dependency on `@donaron/cli`). Modules split cleanly into `types.ts`, `bridge/`, `antigravity/`, `claude-code/`, and `registry.ts`, re-exporting through `packages/adapters/src/index.ts` while preserving Phase 1's `DONARON_ADAPTERS_VERSION` and `getAdaptersModuleInfo()`. Work executes on branch `phase-4/harness-adapters` cut from `phase-3/gate-engine` (`3f6b82f`).

**Tech Stack:** TypeScript 5.8 (strict ESM / `NodeNext`), Node.js `>=24.0.0`, `@donaron/core`, `@donaron/gates`, Vitest + `@vitest/coverage-v8`, ESLint 9 (`strictTypeChecked`), Prettier.

**Spec:** [2026-11-19-donaron-plugin-design.md](../specs/2026-11-19-donaron-plugin-design.md) (§3, §5, §6.4, §7 Phase 4)

---

## Global Constraints

- **Repository root:** `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`; work on branch `phase-4/harness-adapters` branched from `phase-3/gate-engine` (`3f6b82f`).
- **Dependency boundary:** `@donaron/adapters` depends only on `@donaron/core` (`workspace:*`), `@donaron/gates` (`workspace:*`), and Node.js built-ins (`node:fs`, `node:path`, `node:crypto`). Zero new external npm packages and zero imports from `@donaron/cli`.
- **Backward compatibility:** Preserve `DONARON_ADAPTERS_VERSION` and `getAdaptersModuleInfo()` in `packages/adapters/src/index.ts` so `@donaron/cli` and `tests/foundation/*` stay 100% green.
- **Antigravity Native Plugin Invariants:**
  - `<outDir>/plugin.json` emits **only** Antigravity-supported top-level keys (`name`, `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `logo`, `suggestedPrompts`, `disabled`).
  - `<outDir>/hooks.json` is written at the **plugin root** (`<outDir>/hooks.json`), never `<outDir>/hooks/hooks.json`.
  - `<outDir>/rules/AGENTS.md` compiles plain markdown rules (no YAML frontmatter) and fails closed if UTF-8 byte length is `>= 24,000` bytes.
  - Antigravity hook stdin resolves the active workspace from `cwd` first (falling back to `workspacePaths[0]`), distinct from the hook process CWD.
  - `installPlugin` deploys into the target plugin folder without ever hand-editing `~/.gemini/config/config.json`.
- **Claude Code Native Plugin Invariants:**
  - Emits `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `skills/<name>/SKILL.md`, and `agents/<name>.md` (mapping `modelTier`: `fast -> haiku`, `balanced -> sonnet`, `reasoning -> opus`).
  - Marks `runtimeVerification: 'UNVERIFIED'` in its capability matrix until explicitly executed live against `claude.exe`.
- **Fail-Closed Hook Bridge (Choice 1A & Choice 2A):**
  - Malformed hook stdin JSON or missing workspace root on `PreToolUse` fails closed (`deny`).
  - In repositories without an active `.donaron` workflow (Choice 2A), `PreToolUse` still enforces global hazard guards (`.env`/keys, destructive commands, `.donaron/**` tampering, out-of-workspace writes), while `Stop` returns `allow_stop`.
- **Phase 4 Green Bar:** `pnpm run clean && pnpm run check` exits `0` with ≥70% lines, statements, functions, and branches both across the monorepo and across `packages/adapters/src/**`.

## Review Focus

1. **Antigravity manifest & layout strictness:** Exporting to Antigravity must place `hooks.json` at the plugin root (`<outDir>/hooks.json`), strip all non-Antigravity fields from `plugin.json`, strip YAML frontmatter from `rules/AGENTS.md`, and fail closed when `rules/AGENTS.md` reaches or exceeds `24,000` UTF-8 bytes — pinned by Task 2 & Task 4 tests.
2. **Windows-safe hook commands & active workspace resolution:** Hook commands generated in `hooks.json` must quote paths safely for Windows `cmd /c` (`node "<cliPath>" hook <harness> <Event>`), and `translateHookInput` must prioritize stdin `cwd` over `workspacePaths[0]` — pinned by Task 2 & Task 3 tests.
3. **Fail-closed `PreToolUse` & loop-safe `Stop` hook bridging (Choice 1A & Choice 2A):** `executeNormalizedHook` must deny agent writes to `.donaron/**`, deny `donaron gate override`, deny `.env` reads and destructive commands even when no `.donaron` workflow is active, deny malformed `PreToolUse` payloads, and honor `continuationActive: true` on `Stop` — pinned by Task 1 & Task 4 tests.
4. **Honest capability reporting:** Antigravity must report `agentPolicyEnforcement: 'PARTIAL'` and `gates: 'EMULATED'`, and Claude Code must report `runtimeVerification: 'UNVERIFIED'` — pinned by Task 2, Task 3, and Task 4 tests.
5. **Path-safe export & atomic install/uninstall provenance:** Exporters and `PluginInstallationRegistry` must reject target paths that escape the destination directory or collide unsafely, and record SHA-256 digests and permissions in `registry.json` — pinned by Task 4 tests.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── packages/adapters/
│   └── src/
│       ├── index.ts                                  # public barrel exporting adapter APIs + getAdaptersModuleInfo
│       ├── index.test.ts                             # Phase 1 module metadata test
│       ├── types.ts                                  # HarnessId, SupportLevel, HarnessAdapter, hook & export types
│       ├── bridge/
│       │   ├── hook-executor.ts                      # executeNormalizedHook bridging @donaron/core & @donaron/gates
│       │   └── hook-executor.test.ts
│       ├── antigravity/
│       │   ├── antigravity-adapter.ts                # AntigravityAdapter: exporter, 24KB rule compiler, camelCase hooks
│       │   └── antigravity-adapter.test.ts
│       ├── claude-code/
│       │   ├── claude-code-adapter.ts                # ClaudeCodeAdapter: .claude-plugin exporter, model alias, hooks
│       │   └── claude-code-adapter.test.ts
│       └── registry/
│           ├── installation-registry.ts              # getHarnessAdapter, listHarnessAdapters, PluginInstallationRegistry
│           └── installation-registry.test.ts
├── tests/
│   └── contract/
│       └── adapters-contract.test.ts                 # end-to-end golden export & live hook round-trip contract suite
└── docs/
    ├── harness-adapters.md
    └── superpowers/plans/2026-11-19-phase-4-harness-adapters.md
```

---

### Task 1: Branch Setup, Shared Adapter Contract Types & Universal Hook Bridge (`types.ts`, `bridge/hook-executor.ts`)

**Files:**

- Create: `packages/adapters/src/types.ts`
- Create: `packages/adapters/src/bridge/hook-executor.ts`
- Test: `packages/adapters/src/bridge/hook-executor.test.ts`

**Interfaces:**

- Consumes: `LoadedPlugin`, `HookEventName`, `evaluatePolicy`, `PolicyEvaluationInput`, `ValidationResult`, `ValidationIssue` from `@donaron/core`; `WorkflowOrchestrator` from `@donaron/gates`.
- Produces (`packages/adapters/src/types.ts`):

  ```ts
  import type {
    HookEventName,
    LoadedPlugin,
    PermissionScope,
    ValidationResult,
  } from '@donaron/core';

  export type HarnessId = 'antigravity' | 'claude-code';
  export type SupportLevel = 'NATIVE' | 'EMULATED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNVERIFIED';

  export interface HarnessCapabilityMatrix {
    readonly harnessId: HarnessId;
    readonly displayName: string;
    readonly skills: SupportLevel;
    readonly rules: SupportLevel;
    readonly agents: SupportLevel;
    readonly agentPolicyEnforcement: SupportLevel;
    readonly hooks: {
      readonly sessionStart: SupportLevel;
      readonly preToolUse: SupportLevel;
      readonly postToolUse: SupportLevel;
      readonly stop: SupportLevel;
    };
    readonly gates: SupportLevel;
    readonly runtimeVerification: SupportLevel;
    readonly notes: readonly string[];
  }

  export interface ExportPluginOptions {
    readonly cliEntryPath?: string; // path to compiled donaron cli.js; defaults to "donaron" if omitted
    readonly overwrite?: boolean;
  }

  export interface ExportedPluginBundle {
    readonly harnessId: HarnessId;
    readonly pluginId: string;
    readonly pluginName: string;
    readonly version: string;
    readonly outputDir: string;
    readonly writtenFiles: readonly string[]; // relative POSIX paths written inside outputDir
    readonly sourceDigest: string;
  }

  export interface InstallPluginOptions extends ExportPluginOptions {
    readonly targetPluginRootDir: string; // e.g., ~/.gemini/config/plugins or ~/.claude/plugins
    readonly registryFilePath?: string; // optional override for ~/.donaron/registry.json in tests
  }

  export interface InstalledPluginReceipt {
    readonly harnessId: HarnessId;
    readonly pluginId: string;
    readonly pluginName: string;
    readonly version: string;
    readonly installedPath: string;
    readonly sourceDigest: string;
    readonly permissions: readonly PermissionScope[];
    readonly installedAt: string;
  }

  export interface NormalizedToolCall {
    readonly id?: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }

  export interface NormalizedHookInput {
    readonly harnessId: HarnessId;
    readonly event: HookEventName;
    readonly workspaceRoot: string;
    readonly conversationId?: string;
    readonly toolCall?: NormalizedToolCall;
    readonly toolError?: string;
    readonly terminationReason?: string;
    readonly continuationActive?: boolean;
  }

  export interface NormalizedHookDecision {
    readonly event: HookEventName;
    readonly decision: 'allow' | 'deny' | 'ask' | 'allow_stop' | 'block_stop';
    readonly reason?: string;
    readonly systemMessage?: string;
    readonly matchedRuleId?: string;
  }

  export interface HarnessAdapter {
    readonly id: HarnessId;
    readonly displayName: string;
    getCapabilities(): HarnessCapabilityMatrix;
    validateCompatibility(plugin: LoadedPlugin): ValidationResult<true>;
    exportPlugin(
      plugin: LoadedPlugin,
      outDir: string,
      options?: ExportPluginOptions,
    ): ValidationResult<ExportedPluginBundle>;
    installPlugin(
      plugin: LoadedPlugin,
      options: InstallPluginOptions,
    ): ValidationResult<InstalledPluginReceipt>;
    translateHookInput(
      event: HookEventName,
      rawStdin: string,
    ): ValidationResult<NormalizedHookInput>;
    translateHookOutput(
      event: HookEventName,
      decision: NormalizedHookDecision,
    ): Readonly<Record<string, unknown>>;
  }
  ```

- Produces (`packages/adapters/src/bridge/hook-executor.ts`):

  ```ts
  export function executeNormalizedHook(input: NormalizedHookInput): NormalizedHookDecision;
  ```

- [ ] **Step 1: Create branch `phase-4/harness-adapters` from `phase-3/gate-engine`**

Run (sandbox): `git checkout -b phase-4/harness-adapters` inside `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.

- [ ] **Step 2: Write `packages/adapters/src/types.ts` and failing `hook-executor.test.ts` (Review Focus #3)**

Create `packages/adapters/src/types.ts`.
Create `packages/adapters/src/bridge/hook-executor.test.ts` testing:

- `SessionStart`: returns `decision: 'allow'` with a `systemMessage` summarizing the active workflow run (`runId`, `tier`, `state`) when `.donaron/active-run.json` exists, or `decision: 'allow'` without blocking when no active run exists.
- `PreToolUse` (Choice 1A & Choice 2A):
  - Maps shell tools (`run_command`, `Bash`, `execute_command`), file-write tools (`write_file`, `edit_file`, `Write`, `Edit`, `MultiEdit`), file-delete tools (`delete_file`), and file-read tools (`read_file`, `Read`, `view_file`) into `@donaron/core`'s `evaluatePolicy`.
  - Denies writing/editing `.donaron/runs/run-1/state.json` (`decision: 'deny'`).
  - Denies running `donaron gate override GATE_02` (`decision: 'deny'`).
  - Denies reading `.env` or running `rm -rf /` even in a workspace with NO `.donaron/` directory (Choice 2A) (`decision: 'deny'`).
  - Returns `decision: 'ask'` when a policy rule returns `REQUIRE_APPROVAL` (e.g., `git push --force`).
  - Allows safe in-workspace file edits (`src/index.ts`) and test commands (`pnpm test`) (`decision: 'allow'`).
  - Fails closed (`decision: 'deny'`) when `workspaceRoot` is empty/non-existent or `toolCall` is missing on `PreToolUse`.
- `PostToolUse`: returns `decision: 'allow'` without error.
- `Stop`:
  - Returns `decision: 'allow_stop'` when no active `.donaron` workflow exists in `workspaceRoot` (Choice 2A).
  - Returns `decision: 'block_stop'` with reason listing incomplete gates when an active workflow is in `IMPLEMENTATION` and Gates 02–05 are not fresh.
  - Returns `decision: 'allow_stop'` when `continuationActive: true` (infinite-loop guard).

- [ ] **Step 3: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/adapters/src/bridge/hook-executor.test.ts`
Expected: FAIL because `hook-executor.ts` does not exist.

- [ ] **Step 4: Implement `packages/adapters/src/bridge/hook-executor.ts`**

Bridge `NormalizedHookInput` to `evaluatePolicy` from `@donaron/core` and `WorkflowOrchestrator` from `@donaron/gates` inside a fail-closed `try/catch`.

- [ ] **Step 5: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/adapters/src/bridge/hook-executor.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(adapters): add shared HarnessAdapter contract and fail-closed universal hook executor"`

---

### Task 2: Antigravity Native Exporter & Hook Payload Translator (`antigravity/antigravity-adapter.ts`)

**Files:**

- Create: `packages/adapters/src/antigravity/antigravity-adapter.ts`
- Test: `packages/adapters/src/antigravity/antigravity-adapter.test.ts`

**Interfaces:**

- Consumes: `HarnessAdapter`, `HarnessCapabilityMatrix`, `ExportPluginOptions`, `ExportedPluginBundle`, `InstallPluginOptions`, `InstalledPluginReceipt`, `NormalizedHookInput`, `NormalizedHookDecision` from `../types.js`; `LoadedPlugin`, `HookEventName` from `@donaron/core`.
- Produces (`packages/adapters/src/antigravity/antigravity-adapter.ts`):

  ```ts
  export const ANTIGRAVITY_MAX_RULES_BYTES = 24000;
  export function buildWindowsSafeHookCommand(
    cliEntryPath: string | undefined,
    harnessId: 'antigravity' | 'claude-code',
    event: HookEventName,
  ): string;
  export class AntigravityAdapter implements HarnessAdapter { ... }
  ```

- [ ] **Step 1: Write failing `antigravity-adapter.test.ts` (Review Focus #1, #2, #4)**

Test `AntigravityAdapter`:

- `getCapabilities()` returns `skills: 'NATIVE'`, `rules: 'NATIVE'`, `agents: 'NATIVE'`, `agentPolicyEnforcement: 'PARTIAL'`, `hooks.{sessionStart,preToolUse,postToolUse,stop}: 'NATIVE'`, `gates: 'EMULATED'`, `runtimeVerification: 'NATIVE'`.
- `validateCompatibility(plugin)`:
  - Passes for `tests/fixtures/plugins/valid-sample`.
  - Fails closed with `ANTIGRAVITY_RULES_SIZE_EXCEEDED` when compiled `rules/AGENTS.md` is `>= 24,000` UTF-8 bytes.
  - Fails closed with `HARNESS_INCOMPATIBLE` when `manifest.compatibility.harnesses` is non-empty and omits `'antigravity'`.
- `exportPlugin(plugin, outDir, options)`:
  - Writes `<outDir>/plugin.json` containing **only** allowed Antigravity fields (`name`, `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `logo`, `suggestedPrompts`, `disabled`) and omits `manifestVersion`, `id`, `compatibility`, `permissions`, `capabilities`.
  - Writes `<outDir>/hooks.json` at the **plugin root** (and does NOT write `<outDir>/hooks/hooks.json`), binding configured events to `node "<cliEntryPath>" hook antigravity <Event>` with timeout in seconds/ms matching Antigravity's hook schema.
  - Writes `<outDir>/rules/AGENTS.md` with plain markdown (no `---` YAML frontmatter), deterministic priority ordering, and `< 24,000` bytes.
  - Writes `<outDir>/skills/<name>/SKILL.md` (plus any referenced `references/*` and `scripts/*`) and `<outDir>/agents/<name>.md` (`name` and `description` frontmatter + full role/contract body).
- `translateHookInput` & `translateHookOutput`:
  - Resolves `workspaceRoot` from `cwd` first, falling back to `workspacePaths[0]`.
  - Translates camelCase `PreToolUse` (`toolCall: { id, name, args }`) and maps `allow`/`deny`/`ask` to `{ decision: 'allow' | 'deny' | 'ask', reason? }`.
  - Translates `SessionStart` output to `{ injectSteps: [{ systemMessage: { systemMessage: '...' } }] }` when `systemMessage` is present, or `{}` when absent.
  - Translates `Stop` output to `{ decision: 'continue', reason: '...' }` on `block_stop`, and `{ decision: '' }` on `allow_stop`.
  - Fails closed on malformed JSON `rawStdin`.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/adapters/src/antigravity/antigravity-adapter.test.ts`
Expected: FAIL because `antigravity-adapter.ts` does not exist.

- [ ] **Step 3: Implement `packages/adapters/src/antigravity/antigravity-adapter.ts`**

Implement `AntigravityAdapter` with strict allowed-field filtering on `plugin.json`, root `hooks.json`, `< 24,000`-byte `rules/AGENTS.md` compilation, skill/agent markdown generation + asset copying, atomic installation into `<targetPluginRootDir>/<plugin.manifest.name>`, and camelCase hook stdin/stdout translation.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/adapters/src/antigravity/antigravity-adapter.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(adapters): add Antigravity native exporter, 24KB rules compiler, and camelCase hook translator"`

---

### Task 3: Claude Code Exporter & Hook Payload Translator (`claude-code/claude-code-adapter.ts`)

**Files:**

- Create: `packages/adapters/src/claude-code/claude-code-adapter.ts`
- Test: `packages/adapters/src/claude-code/claude-code-adapter.test.ts`

**Interfaces:**

- Consumes: `HarnessAdapter`, `HarnessCapabilityMatrix`, `ExportPluginOptions`, `ExportedPluginBundle`, `InstallPluginOptions`, `InstalledPluginReceipt`, `NormalizedHookInput`, `NormalizedHookDecision` from `../types.js`; `LoadedPlugin`, `HookEventName`, `AgentModelTier` from `@donaron/core`.
- Produces (`packages/adapters/src/claude-code/claude-code-adapter.ts`):

  ```ts
  export function mapModelTierToClaudeAlias(tier: AgentModelTier): 'haiku' | 'sonnet' | 'opus';
  export class ClaudeCodeAdapter implements HarnessAdapter { ... }
  ```

- [ ] **Step 1: Write failing `claude-code-adapter.test.ts` (Review Focus #2, #4)**

Test `ClaudeCodeAdapter`:

- `getCapabilities()` returns `skills: 'NATIVE'`, `rules: 'NATIVE'`, `agents: 'NATIVE'`, `agentPolicyEnforcement: 'PARTIAL'`, `hooks.{sessionStart,preToolUse,postToolUse,stop}: 'NATIVE'`, `gates: 'EMULATED'`, `runtimeVerification: 'UNVERIFIED'`.
- `exportPlugin(plugin, outDir, options)`:
  - Writes `<outDir>/.claude-plugin/plugin.json` (`name`, `version`, `description`, optional `author`, `homepage`, `repository`, `license`).
  - Writes `<outDir>/hooks/hooks.json` with Windows-safe command `node "<cliEntryPath>" hook claude-code <Event>`.
  - Writes `<outDir>/CLAUDE.md` compiling the plugin's markdown rules.
  - Writes `<outDir>/skills/<name>/SKILL.md` (+ `references/` and `scripts/`).
  - Writes `<outDir>/agents/<name>.md` mapping `modelTier` (`fast -> haiku`, `balanced -> sonnet`, `reasoning -> opus`) and `tools` in YAML frontmatter.
- `translateHookInput` & `translateHookOutput`:
  - Supports Claude Code's snake_case (`cwd`, `session_id`, `tool_name`, `tool_input`, `stop_hook_active`) as well as camelCase fields.
  - Translates `PreToolUse` decisions (`allow` -> `{ decision: 'allow', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }`; `deny` -> `{ decision: 'block', reason, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }`; `ask` -> `permissionDecision: 'ask'`).
  - Translates `Stop` decisions (`block_stop` -> `{ decision: 'block', reason }`; `allow_stop` -> `{}`).

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/adapters/src/claude-code/claude-code-adapter.test.ts`
Expected: FAIL because `claude-code-adapter.ts` does not exist.

- [ ] **Step 3: Implement `packages/adapters/src/claude-code/claude-code-adapter.ts`**

Implement `ClaudeCodeAdapter` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `haiku`/`sonnet`/`opus` agent frontmatter mapping, and Claude Code hook payload translation.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/adapters/src/claude-code/claude-code-adapter.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(adapters): add Claude Code exporter, modelTier mapper, and hook payload translator"`

---

### Task 4: Adapter Registry, Installation Provenance Ledger, Barrel Exports & Golden Contract Suite (`registry/installation-registry.ts`, `index.ts`, `tests/contract/adapters-contract.test.ts`)

**Files:**

- Create: `packages/adapters/src/registry/installation-registry.ts`
- Test: `packages/adapters/src/registry/installation-registry.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Create: `tests/contract/adapters-contract.test.ts`

**Interfaces:**

- Produces (`packages/adapters/src/registry/installation-registry.ts`):

  ```ts
  export function getHarnessAdapter(id: HarnessId): HarnessAdapter;
  export function listHarnessAdapters(): readonly HarnessAdapter[];

  export class PluginInstallationRegistry {
    readonly registryFilePath: string;
    constructor(registryFilePath: string);
    listInstalled(harnessId?: HarnessId): readonly InstalledPluginReceipt[];
    recordInstall(receipt: InstalledPluginReceipt): void;
    uninstallPlugin(
      pluginName: string,
      harnessId?: HarnessId,
    ): ValidationResult<readonly InstalledPluginReceipt[]>;
  }
  ```

- [ ] **Step 1: Write failing `installation-registry.test.ts` and `tests/contract/adapters-contract.test.ts` (Review Focus #1–#5)**

Test in `installation-registry.test.ts`:

- `listHarnessAdapters()` returns `AntigravityAdapter` and `ClaudeCodeAdapter`; `getHarnessAdapter('antigravity')` and `getHarnessAdapter('claude-code')` return the matching instances.
- `PluginInstallationRegistry` persists receipts to `registry.json`, upgrades existing entries for the same `(harnessId, pluginName)` idempotently, and `uninstallPlugin` removes the deployed directory and removes the receipt from `registry.json` (failing closed if `pluginName` contains path traversal characters like `../`).

Test in `tests/contract/adapters-contract.test.ts` (importing exclusively from `@donaron/core`, `@donaron/gates`, and `@donaron/adapters` public barrels):

- Loads `tests/fixtures/plugins/valid-sample` via `loadPlugin`, validates compatibility, exports to both Antigravity and Claude Code, and verifies golden file structures and contents.
- Executes end-to-end simulated hook stdin -> `translateHookInput` -> `executeNormalizedHook` -> `translateHookOutput` round-trips for both harnesses across `SessionStart`, `PreToolUse` (Choice 1A `.donaron` write deny, `donaron gate override` deny, Choice 2A `.env` read deny, safe file allow), `PostToolUse`, and `Stop` (Choice 2A allow_stop, active `IMPLEMENTATION` block_stop, `continuationActive: true` loop guard).

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/adapters/src/registry/installation-registry.test.ts tests/contract/adapters-contract.test.ts`
Expected: FAIL because `installation-registry.ts` and `packages/adapters/src/index.ts` exports do not exist.

- [ ] **Step 3: Implement `installation-registry.ts` and update `packages/adapters/src/index.ts`**

Export all Phase 4 types, `executeNormalizedHook`, `AntigravityAdapter`, `ClaudeCodeAdapter`, `getHarnessAdapter`, `listHarnessAdapters`, and `PluginInstallationRegistry` from `packages/adapters/src/index.ts` while preserving `DONARON_ADAPTERS_VERSION` and `getAdaptersModuleInfo()`.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/adapters/ tests/contract/adapters-contract.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(adapters): add adapter registry, provenance ledger, barrel exports, and golden contract tests"`

---

### Task 5: Phase 4 Adapter Documentation, `README.md` Update & Full Monorepo Clean Green Check

**Files:**

- Create: `docs/harness-adapters.md`
- Create: `docs/superpowers/plans/2026-11-19-phase-4-harness-adapters.md` (copied from this plan)
- Modify: `README.md` (mark Phase 4 **Implemented**)

- [ ] **Step 1: Author `docs/harness-adapters.md`, copy plan to `docs/superpowers/plans/2026-11-19-phase-4-harness-adapters.md`, and update `README.md`**

Document in `docs/harness-adapters.md`:

- `HarnessAdapter` interface and `executeNormalizedHook` lifecycle bridge (Choice 1A & Choice 2A).
- Antigravity native export layout (`plugin.json` allowed keys only, root `hooks.json`, `rules/AGENTS.md` <24 KB limit, `skills/`, `agents/`) and camelCase hook stdin/stdout schemas.
- Claude Code native export layout (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `skills/`, `agents/` with `haiku`/`sonnet`/`opus` mapping) and hook stdin/stdout schemas.
- Honest Capability Matrix table (`NATIVE`, `EMULATED`, `PARTIAL`, `UNSUPPORTED`, `UNVERIFIED`) separating contract-verified features from `UNVERIFIED` live `claude.exe` runtime execution and Planned Phases 5–7.

- [ ] **Step 2: Run full monorepo clean green-bar check**

Run: `pnpm run clean && pnpm run check`
And verify `coverage/coverage-summary.json` reports ≥70% across `lines`, `statements`, `functions`, and `branches` both overall and across `packages/adapters/src/**`.
Expected: Exit `0`, all tests green, zero lint/typecheck/Prettier errors.

- [ ] **Step 3: Commit Task 5**

Run: `git add -A && git commit -m "docs(adapters): add harness adapter specification and mark Phase 4 implemented"`
Expected: clean working tree on `phase-4/harness-adapters`.
