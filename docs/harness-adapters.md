# DonAron Harness Adapters (`@donaron/adapters`)

This document specifies the shared `HarnessAdapter` contract, the universal hook execution bridge (`executeNormalizedHook`), the native plugin exporters and stdin/stdout hook payload translators for **Google Antigravity** and **Anthropic Claude Code**, the installation provenance registry (`PluginInstallationRegistry`), and the honest capability matrix implemented in `@donaron/adapters` (`packages/adapters`).

---

## 1. Implementation Status: Implemented vs. Planned

| Capability | Status | Location / Target Phase |
| --- | --- | --- |
| Shared `HarnessAdapter` contract & capability matrix types (`HarnessId`, `SupportLevel`, `HarnessCapabilityMatrix`) | **Implemented (Phase 4)** | `packages/adapters/src/types.ts` |
| Universal fail-closed hook executor (`executeNormalizedHook`) bridging `@donaron/core` policies & `@donaron/gates` workflows | **Implemented (Phase 4)** | `packages/adapters/src/bridge/hook-executor.ts` |
| Antigravity native exporter (`AntigravityAdapter`, `< 24,000`-byte `rules/AGENTS.md` compiler, root `hooks.json`, camelCase hook translator) | **Implemented (Phase 4)** | `packages/adapters/src/antigravity/antigravity-adapter.ts` |
| Claude Code native exporter (`ClaudeCodeAdapter`, `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `haiku`/`sonnet`/`opus` mapper, hook translator) | **Implemented (Phase 4)** | `packages/adapters/src/claude-code/claude-code-adapter.ts` |
| Adapter registry (`getHarnessAdapter`, `listHarnessAdapters`) & installation provenance ledger (`PluginInstallationRegistry`) | **Implemented (Phase 4)** | `packages/adapters/src/registry/installation-registry.ts` |
| End-to-end golden export & hook round-trip contract suite | **Implemented (Phase 4)** | `tests/contract/adapters-contract.test.ts` |
| `donaron` CLI (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`, `hook`) | **Planned (Phase 5)** | `apps/cli` |
| Flagship personal Node.js + React plugin (`plugins/donaron-dev`) | **Planned (Phase 6)** | `plugins/donaron-dev` |
| Self-gated verification & complete user/CLI reference docs | **Planned (Phase 7)** | `docs/` |

---

## 2. Honest Capability Matrix (`SupportLevel`)

Every adapter reports one of five explicit support levels for each capability:

- **`NATIVE`:** Supported directly by the target harness's native plugin format and verified by automated contract tests.
- **`EMULATED`:** Enforced deterministically through native harness lifecycle hooks (`PreToolUse`, `Stop`, `SessionStart`) invoking DonAron's Node.js engine (`@donaron/core` + `@donaron/gates`).
- **`PARTIAL`:** Native discovery works (`agents/<name>.md`), while DonAron-specific frontmatter constraints (`permissionProfile`, `maxRetries`, `requiresHumanApproval`) are preserved in the compiled agent markdown body and enforced via DonAron's `PreToolUse` / `Stop` hooks.
- **`UNSUPPORTED`:** Not supported by the target harness.
- **`UNVERIFIED`:** Export structure and hook payload translation are verified by automated contract tests, while live runtime execution against the installed external harness binary has not yet been executed in this environment.

| Capability | Google Antigravity (`antigravity`) | Anthropic Claude Code (`claude-code`) |
| --- | --- | --- |
| `skills` | `NATIVE` (`skills/<name>/SKILL.md` + `references/` + `scripts/`) | `NATIVE` (`skills/<name>/SKILL.md` + `references/` + `scripts/`) |
| `rules` | `NATIVE` (`rules/AGENTS.md`, strictly `< 24,000` UTF-8 bytes) | `NATIVE` (`CLAUDE.md`) |
| `agents` | `NATIVE` (`agents/<name>.md` with `name` + `description` frontmatter) | `NATIVE` (`agents/<name>.md` with `model: haiku\|sonnet\|opus` + `tools`) |
| `agentPolicyEnforcement` | `PARTIAL` (enforced via `PreToolUse` / `Stop` hook bridge) | `PARTIAL` (enforced via `PreToolUse` / `Stop` hook bridge) |
| `hooks.sessionStart` | `NATIVE` (root `hooks.json`) | `NATIVE` (`hooks/hooks.json`) |
| `hooks.preToolUse` | `NATIVE` (root `hooks.json`) | `NATIVE` (`hooks/hooks.json`) |
| `hooks.postToolUse` | `NATIVE` (root `hooks.json`) | `NATIVE` (`hooks/hooks.json`) |
| `hooks.stop` | `NATIVE` (root `hooks.json`) | `NATIVE` (`hooks/hooks.json`) |
| `gates` (Gates 01–05) | `EMULATED` (via `Stop` & `PreToolUse` hook bridge + `.donaron/` store) | `EMULATED` (via `Stop` & `PreToolUse` hook bridge + `.donaron/` store) |
| `runtimeVerification` | `NATIVE` | `UNVERIFIED` (contract-tested; live `claude.exe` runtime unverified) |

> **Note:** Codex, Cursor, and GitHub Copilot are intentionally excluded in v1 (`Non-Goals`); zero fake stubs are shipped.

---

## 3. Native Export Layouts

### 3.1 Google Antigravity (`AntigravityAdapter`)

```text
<outDir>/
├── plugin.json               # Strictly filtered to Antigravity-allowed top-level fields only
├── hooks.json                # MUST be at plugin root (never hooks/hooks.json)
├── rules/
│   └── AGENTS.md             # Plain markdown (no YAML frontmatter), validated < 24,000 bytes
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md
│       ├── references/...
│       └── scripts/...
└── agents/
    └── <agent-name>.md       # name + description YAML frontmatter + full contract body
```

- **Allowed `plugin.json` keys:** `name`, `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `logo`, `suggestedPrompts`. All DonAron-only keys (`manifestVersion`, `id`, `compatibility`, `permissions`, `capabilities`, `dependencies`, `license`) are stripped during export.
- **24 KB Rule Budget Guard (`ANTIGRAVITY_MAX_RULES_BYTES = 24000`):** `validateCompatibility` and `exportPlugin` fail closed with `ANTIGRAVITY_RULES_SIZE_EXCEEDED` if the compiled `rules/AGENTS.md` is `>= 24,000` UTF-8 bytes.
- **Auto-Discovery Safe Installation:** `installPlugin` deploys into `<targetPluginRootDir>/<plugin.manifest.name>` and never hand-edits `~/.gemini/config/config.json`.

### 3.2 Anthropic Claude Code (`ClaudeCodeAdapter`)

```text
<outDir>/
├── .claude-plugin/
│   └── plugin.json           # Claude Code manifest (name, version, description, author, homepage, repository, license)
├── hooks/
│   └── hooks.json            # Lifecycle hook bindings
├── CLAUDE.md                 # Compiled priority-ordered guidance rules
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md
│       ├── references/...
│       └── scripts/...
└── agents/
    └── <agent-name>.md       # YAML frontmatter with name, description, model (haiku|sonnet|opus), tools
```

- **Model Tier Mapping (`mapModelTierToClaudeAlias`):**
  - `'fast'` → `'haiku'`
  - `'balanced'` → `'sonnet'`
  - `'reasoning'` → `'opus'`

---

## 4. Universal Hook Execution Bridge & Payload Translation

Both adapters generate Windows-safe hook commands via `buildWindowsSafeHookCommand`:

```text
node "<cliEntryPath>" hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>
```

### 4.1 Hook Stdin -> `NormalizedHookInput` -> `executeNormalizedHook` -> Hook Stdout

1. **`translateHookInput(event, rawStdin)`:**
   - Fails closed (`HOOK_STDIN_INVALID_JSON` / `HOOK_STDIN_NOT_OBJECT`) if `rawStdin` is not a valid JSON object.
   - Resolves `workspaceRoot` from `cwd` first, falling back to `workspacePaths[0]` (Antigravity) or `workspace_roots[0]` (Claude Code).
   - Normalizes tool calls from Antigravity's `toolCall: { id, name, args }` or Claude Code's `tool_name` + `tool_input`.
   - Normalizes `Stop` continuation flags from Antigravity's `continuationActive` or Claude Code's `stop_hook_active`.
2. **`executeNormalizedHook(input)`:**
   - **`SessionStart`:** Checks `.donaron/active-run.json` in `workspaceRoot`. If an active run exists, returns `systemMessage` summarizing `runId`, `tier`, `state`, and `taskDescription`; otherwise returns quiet `allow`.
   - **`PreToolUse` (Choice 1A & Choice 2A):**
     - Fails closed (`decision: 'deny'`) if `workspaceRoot` is missing/non-existent or `toolCall` is absent.
     - Classifies shell (`run_command`, `Bash`, etc.), file-write (`write_file`, `edit_file`, `Write`, `Edit`, etc.), file-delete (`delete_file`, `remove_file`), and file-read (`read_file`, `Read`, `view_file`) tools and delegates to `@donaron/core`'s `evaluatePolicy`.
     - Enforces Choice 1A (blocks agent edits/deletions to `.donaron/**` and blocks `donaron gate override`) and Choice 2A (blocks `.env`/private-key reads, destructive commands, and out-of-workspace writes even when no `.donaron` workflow is active).
   - **`PostToolUse`:** Returns `{ event: 'PostToolUse', decision: 'allow' }`.
   - **`Stop`:** Delegates to `WorkflowOrchestrator(workspaceRoot).evaluateStopHookGate(...)`. Allows stopping when no active workflow exists (Choice 2A), when `continuationActive === true` (loop guard), or in interactive/terminal states; returns `block_stop` with the list of missing/stale gates during active implementation/verification states (`IMPLEMENTATION`..`GATE_05`).
3. **`translateHookOutput(event, decision)`:**
   - **Antigravity (`camelCase`):**
     - `SessionStart`: `{ injectSteps: [{ systemMessage: { systemMessage: "..." } }] }` or `{}`
     - `PreToolUse`: `{ decision: "allow" | "deny" | "ask", reason? }`
     - `PostToolUse`: `{}`
     - `Stop`: `{ decision: "continue", reason }` on `block_stop`, or `{ decision: "" }` on `allow_stop`
   - **Claude Code:**
     - `SessionStart`: `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }` or `{}`
     - `PreToolUse`: `{ decision: "allow" | "block" | "ask", reason?, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" | "deny" | "ask", permissionDecisionReason? } }`
     - `PostToolUse`: `{}`
     - `Stop`: `{ decision: "block", reason }` on `block_stop`, or `{}` on `allow_stop`

---

## 5. Installation Provenance Registry (`PluginInstallationRegistry`)

`PluginInstallationRegistry` (`packages/adapters/src/registry/installation-registry.ts`) persists a versioned JSON ledger (`registry.json`, typically `~/.donaron/registry.json`) recording every installed plugin's:
- `harnessId` (`'antigravity' | 'claude-code'`)
- `pluginId`, `pluginName`, `version`
- `installedPath`
- `sourceDigest` (`sha256:...` bundle digest)
- `permissions` (`fs:read`, `fs:write`, `cmd:exec`, `net:outbound`, `env:read`)
- `installedAt` (ISO-8601 timestamp)

Re-installing the same `(harnessId, pluginName)` updates the existing receipt idempotently, and `uninstallPlugin(pluginName, harnessId?)` validates `pluginName` against path traversal, removes the deployed directory on disk, and removes the receipt from `registry.json`.
