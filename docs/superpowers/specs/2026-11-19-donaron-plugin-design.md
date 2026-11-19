# DonAron-plugin — System Design Document

**Date:** 2026-11-19
**Status:** Ready for User Approval
**Repository Target Path (builder call):** `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`
**Source Specification:** [DONARON-PLUGIN-SPEC.md](file:///c:/Users/USER/Downloads/DONARON-PLUGIN-SPEC.md)

---

## 1. Intent & Why

DonAron-plugin is a **personal multi-harness AI development workflow and enforcement system** built first for **Antigravity** and **Claude Code**, targeting **Node.js + React** codebases.

Core goals driving the design:

1. **Write once, run natively in both harnesses:** Author skills, specialized agent roles, rules, and hook bindings once in `plugins/donaron-dev/`, then export and install cleanly into both Antigravity and Claude Code without maintaining diverging copies.
2. **Fail-closed `strict` rigor by default:** AI agents never self-certify that plans, code reviews, security checks, tests, or coverage passed. All five mandatory gates (**Gates 01–05**) are evaluated by framework-controlled local Node.js code against immutable evidence bound to content hashes.
3. **Keep `strict` mode token-efficient:** Push every mechanical check (schema validation, path/command policy guards, TypeScript compilation, lint, secret scanning, dependency audit, Vitest execution + ≥70% coverage parsing, hash staleness checks) into **zero-token local Node.js scripts** driven by native harness hooks and the CLI. Load skills progressively on demand and pass compact structured artifacts between roles.
4. **Green-before-next-phase discipline:** Analyze first; never advance to the next phase until the current phase's build, lint, test, security, and coverage checks are all verified green and approved.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals

- Define a strict, versioned universal plugin manifest (`v1`, JSON Schema Draft 2020-12 via Ajv) with path-traversal-proof loading.
- Enforce **`strict` mode by default** across Gates 01–05 (≥70% test coverage, independent review, fail-closed security controls), with optional explicit `--tier standard` and `--tier quick` opt-in modes.
- Prevent gate bypass and stale approvals using scoped content hashes (`planHash` + `codeHash`), `PreToolUse` hook guards, and interactive TTY confirmation for overrides.
- Ship verified adapters for **Antigravity** and **Claude Code** behind a versioned adapter contract with honest capability reporting (`NATIVE`, `EMULATED`, `PARTIAL`, `UNSUPPORTED`, `UNVERIFIED`).
- Ship a thin `donaron` CLI for terminal management and live stdin/stdout hook bridging (`donaron hook <harness> <event>`).
- Ship the flagship personal Node + React plugin (`plugins/donaron-dev/`) containing progressive skills, the full 15-agent strict roster, compact rules, and hook bindings.

### Non-Goals (v1)

- Hosted marketplace, cloud registry, or remote auto-update server.
- Adapters for Codex, Cursor, or GitHub Copilot in v1 (adapter contract stays extensible; zero fake stubs shipped).
- Arbitrary third-party executable hook binaries or custom policy scripting DSLs in plugins.
- Claiming OS/container sandboxing (Node.js is not a sandbox; docs state trust boundaries honestly).
- Automatic git push, deploy, or release without explicit human approval.

### Anti-Goals (Failure Conditions Even If Code Compiles)

- **LLM self-certification:** Any path where an agent passes a gate by asserting success in prose or editing `.donaron/` evidence files.
- **False compatibility claims:** Marking any harness feature `NATIVE` without a passing contract test or documented live verification.
- **Token bloat:** Injecting full skill/reference catalogs or raw chat histories into prompts, or spending LLM tokens on checks deterministic Node scripts can run at 0 tokens.
- **Package sprawl:** Splitting a personal toolkit into 14+ tiny packages before a working plugin runs in Antigravity or Claude Code.
- **Fail-open security controls:** Silently allowing tool calls or gate transitions when a critical policy or hook check errors or times out.

---

## 3. Constraints & Verified Environment Facts

### Local Machine

- **OS:** Windows (PowerShell + `cmd /c` for Antigravity hooks). All scripts, paths, and hook commands must be Windows-safe (`node:path`, invoking `node` directly rather than Bash-only scripts).
- **Toolchain observed:** `node v24.18.0`, `git 2.55.0.windows.3`, `C:\Users\USER\.local\bin\claude.exe` present; **`pnpm` is not yet on `PATH`** (Phase 1 installs/enables `pnpm` before workspace install).

### Verified Antigravity Plugin & Hook Contract

- **Auto-discovery:** Placing a valid plugin directory in `~/.gemini/config/plugins/<name>/` (or workspace `.agents/plugins/<name>/`) is auto-discovered and enabled by default. `donaron` **never** hand-edits `~/.gemini/config/config.json`.
- **Manifest (`plugin.json`):** Only allowed top-level fields (`name`, `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `logo`, `suggestedPrompts`, `disabled`). Unknown fields are silently dropped.
- **Root `hooks.json`:** Native Antigravity plugins **must** place `hooks.json` at `<plugin_dir>/hooks.json` (not `hooks/hooks.json`), keyed by named hook objects supporting `SessionStart`, `PreToolUse` (`[{ matcher, hooks: [{ type: "command", command, timeout }] }]`), `PostToolUse`, and `Stop`.
- **Verified camelCase `stdin` / `stdout` payloads:**
  - Common `stdin`: `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`, `lastUserInput`, `hookEventName`, `cwd` (**agent's active workspace CWD**, distinct from the hook process CWD which is the plugin root; `PLUGIN_ROOT` and `PLUGIN_DATA` env vars are also provided).
  - `PreToolUse`: `stdin` adds `toolCall: { id, name, args }`, `stepIdx`; `stdout` returns `{ decision: "allow" | "deny" | "ask" | "force_ask", reason? }`.
  - `PostToolUse`: `stdin` adds `toolCall`, `stepIdx`, `error?`; `stdout` returns `{}`.
  - `SessionStart`: `stdout` returns `{ injectSteps?: [{ systemMessage: { systemMessage: "..." } }] }`.
  - `Stop`: `stdin` adds `executionNum`, `terminationReason`, `error`, `fullyIdle`, `continuationActive`; `stdout` returns `{ decision: "continue" | "", reason? }`.
- **Rules (`rules/AGENTS.md`):** Plain markdown (no frontmatter), always on when enabled; hard cap 24,000 bytes per file (shared 20,000-token rules budget).
- **Agents (`agents/<name>.md`):** Natively discovered with `name` + `description` YAML frontmatter + prompt body; custom frontmatter fields (`modelTier`, `tools`, `permissionProfile`) are not natively enforced by Antigravity and are therefore reported honestly as `agents: NATIVE`, `agentPolicyEnforcement: PARTIAL`.

### Claude Code Plugin Contract

- Native layout: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `skills/<name>/SKILL.md`, `agents/<name>.md`.
- Export layout and hook payload translation are verified via automated contract tests; live runtime execution against `claude.exe` remains marked `UNVERIFIED` until explicitly tested live and documented.

---

## 4. Approaches Considered

| Approach                                                                    | Summary                                                                                                              | Tradeoffs                                                                                                                                                                                                                                                                                       | Decision     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Approach 1: Focused 5-Module Monorepo + Dual Adapters + Flagship Plugin** | pnpm TS monorepo with `packages/core`, `packages/gates`, `packages/adapters`, `apps/cli`, and `plugins/donaron-dev`. | Preserves every architectural capability from the spec (schema, policy, hooks, 5 gates, state machine, adapters, CLI) while removing ~9 boilerplate packages; gets a working plugin running in Antigravity & Claude Code in 7 green-gated phases; defers multi-plugin remote ecosystem manager. | **Selected** |
| **Approach 2: Full Spec 14-Package Monorepo (12 Phases)**                   | Separate workspace package for every engine and 4+ harness adapters.                                                 | 1-to-1 match with initial spec layout, but excessive scaffolding for a personal toolkit with no usable harness integration until Phases 10–11.                                                                                                                                                  | Rejected     |
| **Approach 3: Single Dual-Native Plugin Repo (No Framework)**               | Lightweight single repo like `superpowers` with both manifests and ad-hoc hook scripts.                              | Fastest initial start, but drops formal manifest validation, versioned adapter contracts, evidence-based state machine, and reusable `donaron` CLI.                                                                                                                                             | Rejected     |

---

## 5. Decisions Log (User Decisions vs. Builder Calls)

### Explicitly Decided by User

- **Language & packaging:** TypeScript, Node.js, pnpm workspaces monorepo; initial target codebase: Node.js + React.
- **Architecture:** Approach 1 (5 focused modules).
- **Target harnesses:** Antigravity and Claude Code (personal workflow first).
- **Workflow mode:** **`strict` by default** (Gates 01–05, ≥70% coverage, independent reviews) with zero-token deterministic checks.
- **Trust boundary (Choice 1A):** `PreToolUse` hook guards blocking agent writes to `.donaron/**` and agent override attempts + interactive terminal confirmation (`process.stdin.isTTY`) with audit reason for human overrides (no local cryptographic signing key management in v1).
- **Global behavior in non-workflow repos (Choice 2A):** When `donaron-dev` is enabled globally and a repo has no active `.donaron` workflow, `PreToolUse` still enforces global hazard guards (`.env`/keys, destructive commands, out-of-workspace writes), while `Stop` and `PostToolUse` stay quiet and non-blocking.
- **Build & approval discipline:** Analyze first; never advance to the next phase until all checks and tests are green; pause for explicit user approval between major phases.

### Builder Calls (Settled for Consistency — Confirm or Adjust)

1. **Repository path:** `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.
2. **Toolchain:** Pure ESM (`"type": "module"`, NodeNext), `tsc --build` project references, `ajv` + `ajv-formats` (JSON Schema Draft 2020-12), `commander`, `vitest` + `@vitest/coverage-v8`, `pino`, `eslint` (flat config + `typescript-eslint`), `prettier`.
3. **Scoped hashes (`planHash` + `codeHash`):** Separate planning artifact hash (`planHash`) from source/test tree hash (`codeHash`) so writing code during `IMPLEMENTATION` does not break Gate 01, while any code/test edit automatically invalidates Gates 02–05.
4. **Execution model:** Host-integrated state ledger & hook enforcer (Antigravity/Claude Code run LLM turns and subagents; DonAron hooks & CLI own workflow state, policies, deterministic gates, and evidence).
5. **Mid-workflow `Stop` behavior:** `Stop` blocks only during active implementation/verification states (`IMPLEMENTATION` through `GATE_05`) on `NO_TOOL_CALL` when `continuationActive !== true` and required gates lack fresh `PASS` evidence; interactive/waiting states (`INTAKE`..`GATE_01`, `RESEARCH`, `NEEDS_HUMAN_APPROVAL`, `BLOCKED`, terminal states) always allow yielding to the user.
6. **Manifest v1 scope:** Deterministic policies live in built-in defaults + optional structured JSON policy files (`policies/*.json` / `.donaron/config.json`) while `rules/*.md` are prompt guidance only; universal `hooks/hooks.json` binds to DonAron's built-in hook handlers (no arbitrary third-party hook executables in v1); `capabilities.tools` holds optional MCP server config refs; `plugin.json` `permissions` declare what the plugin's own hooks/scripts/tools request.
7. **Gate thresholds & evaluators:**
   - **Gate 01:** Satisfied by `intake-reviewer` + `solutions-architect` records OR direct explicit human approval (`--approver human`) for solo personal workflows.
   - **Gate 03:** Pinned **OWASP Top 10:2021** + **OWASP Top 10 for LLM Applications v2025** (auto-triggered on AI SDK imports or `aiApplication: true`); `critical` = hard non-overridable `FAIL`, `high` = `FAIL` (interactive human override allowed), `medium`/`low` = logged warnings; checklist evaluator: `reviewer`, `code-reviewer`, or `human`.
   - **Gate 04:** Native Vitest runner (`--reporter=json` + `@vitest/coverage-v8` `coverage-summary.json`) behind a pluggable `TestRunnerParser` interface; enforces ≥70% across **lines, statements, functions, and branches**, supporting both single-package and monorepo **per-package** thresholds.
8. **`export` vs. `install`:** `donaron export` writes a portable bundle to any `--out` directory; `donaron plugin install [--target antigravity|claude-code|all]` validates, shows requested permissions, prompts confirmation, records provenance in `~/.donaron/registry.json`, and deploys atomically into the target harness plugin directory.
9. **Optional tiers:** `strict` is the default; `--tier standard` and `--tier quick` remain available only as explicit human CLI flags at `donaron workflow start`.

---

## 6. Architecture & Module Specifications

### 6.1 Monorepo Layout

```text
donaron-plugin/
├── package.json                  # scripts: build, lint, format:check, test, test:coverage, check
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc.json
├── vitest.config.ts
├── schemas/
│   └── donaron-plugin.v1.schema.json
├── packages/
│   ├── core/                     # Manifest schema, safe loader, parsers, deterministic policy engine, redacting logger
│   ├── gates/                    # Scoped hashing, Evidence Store, Gates 01-05, strict workflow state machine
│   └── adapters/                 # Shared adapter contract + Antigravity & Claude Code adapters
├── apps/
│   └── cli/                      # `donaron` CLI + `donaron hook <harness> <event>` stdin/stdout bridge
├── plugins/
│   └── donaron-dev/              # Flagship Node + React plugin (single source of truth)
│       ├── plugin.json           # Universal DonAron v1 manifest
│       ├── skills/               # Progressive SKILL.md + references/
│       ├── agents/               # Full 15-agent strict roster
│       ├── rules/                # Compact markdown guidance rules
│       └── hooks/hooks.json      # Declarative bindings to built-in DonAron hook handlers
├── tests/
│   ├── fixtures/                 # Valid/invalid plugins + minimal Node+React E2E fixture repo
│   └── contract/                 # Adapter contract & security tests
└── docs/
    ├── superpowers/specs/        # Committed design doc & architecture decision log
    ├── architecture.md
    ├── plugin-specification.md
    ├── gates-and-workflows.md
    ├── harness-adapters.md
    ├── security.md
    └── cli-reference.md
```

### 6.2 `packages/core`

- **Universal Manifest (`donaron-plugin.v1.schema.json`):** Validates `manifestVersion: "1"`, `id`, `name`, `version` (semver), `description`, `compatibility.donaronPlugin`, optional `displayName`, `author`, `license`, `homepage`, `repository`, `logo`, `suggestedPrompts`, `compatibility.harnesses`, `dependencies`, `permissions` (`fs:read`, `fs:write`, `cmd:exec`, `net:outbound`, `env:read`), and `capabilities` (`skills`, `agents`, `rules`, `hooks`, `tools`, `policies`). Enforces `additionalProperties: false`.
- **Safe Plugin Loader:** Resolves every file path with `path.resolve` + `fs.realpathSync` containment checks inside plugin root; rejects `..` traversal, Windows drive escapes, external symlinks, and missing declared references; computes SHA-256 bundle digest; never executes scripts during discovery or validation.
- **Parsers:**
  - `skills/<name>/SKILL.md`: YAML frontmatter (`name`, `description`, `purpose`, `activation`, `inputs`, `outputs`, `constraints`, `completionCriteria`, optional `references`, `scripts`, `version`) + markdown body.
  - `agents/<name>.md`: YAML frontmatter (`name`, `role`, `description`, `responsibilities`, `nonResponsibilities`, `skills`, `tools`, `permissionProfile`, `modelTier`: `fast|balanced|reasoning`, `inputContract`, `outputContract`, `handoffConditions`, `maxRetries`, `requiresHumanApproval`) + prompt body.
  - `rules/*.md`: YAML frontmatter (`id`, `category`: `routing|security|development|writing`, `scope`, `priority`) + concise markdown rules.
  - `hooks/hooks.json`: Declarative bindings mapping lifecycle events (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`) to built-in DonAron handlers (`session-context`, `policy-guard`, `stale-tracker`, `gate-stop-guard`) + timeout + failure policy (`fail_closed` | `warn`).
- **Deterministic Policy Engine:** Evaluates structured policy rules (built-in defaults + optional `policies/*.json` + workspace `.donaron/config.json`) with strict precedence `DENY > REQUIRE_APPROVAL > ALLOW`, highest explicit priority tie-break, and **fail-closed `DENY`** on evaluation error. Built-in defaults block:
  - Direct edits/deletes to `.donaron/runs/**` or `.donaron/evidence/**` by agents.
  - Agent shell invocations of `donaron gate override`.
  - Reading/printing `.env*`, `*.pem`, `*.key`, `id_rsa`, credential stores unless explicitly allowlisted.
  - Destructive shell commands (`rm -rf /`, `git push --force`, `git reset --hard`, `DROP TABLE`, etc.) → `DENY` or `REQUIRE_APPROVAL`.
  - File writes escaping the active workspace root → `DENY`.
- **Secret-Redacting Logger:** `pino` wrapper redacting sensitive keys (`*token*`, `*secret*`, `*password*`, `*key*`, `authorization`, `cookie`) and regex-scrubbing API keys, JWTs, and PEM blocks from all logs and audit artifacts.

### 6.3 `packages/gates`

- **Scoped Hashing & Evidence Store:**
  - Stored under `<workspace>/.donaron/runs/<runId>/` (`state.json`, `evidence/<gateId>-<timestamp>.json`, `audit.jsonl`).
  - `planHash`: SHA-256 of sorted planning artifact paths and contents declared for Gate 01.
  - `codeHash`: SHA-256 of `git rev-parse HEAD` (when in git) + sorted non-ignored source & test file paths and contents (excluding `.donaron/`, `node_modules/`, `dist/`, `coverage/`).
  - **Freshness rule:** Gate 01 evidence is fresh iff `record.planHash === currentPlanHash`. Gates 02, 03, 04, and 05 evidence are fresh iff `record.codeHash === currentCodeHash`. Any code or test edit after a `PASS` immediately makes Gates 02–05 `STALE`.
- **Gate Decision Record:**
  - Fields: `gateId`, `gateVersion`, `runId`, `planHash?`, `codeHash?`, `evaluator` (`{ type: "deterministic" | "agent" | "human", id: string }`), `checks[]`, `evidenceRefs[]`, `findings[]` (`severity: critical|high|medium|low|info`), `decision` (`PASS|FAIL|NEEDS_HUMAN_APPROVAL|BLOCKED|NOT_APPLICABLE`), `timestamp`, `humanApproval?`.
  - **Anti-self-approval:** On Gates 01, 02, and 05, if `evaluator.id` matches the recorded author/implementer actor for that revision, the record is rejected (`FAIL`).
- **Five Mandatory Gates (`strict` default):**
  1. **Gate 01 — Planning Document Review:** Verifies planning artifact(s) exist with non-empty Requirements, Specification, Architecture, Task Plan, and Acceptance Criteria sections + recorded approval from `intake-reviewer` & `solutions-architect` (or explicit `human` approval). Blocks `IMPLEMENTATION` until `PASS`.
  2. **Gate 02 — Pre-test Code Review:** Zero-token `tsc --noEmit` / build + linter + independent `reviewer`/`code-reviewer` review record with zero `critical`/`high` findings.
  3. **Gate 03 — Security Review:** Zero-token secret scanner (tracked/changed files) + dependency audit (`pnpm audit --json` / `npm audit --json`; fails closed or `BLOCKED` if offline without explicit waiver) + pinned **OWASP Top 10:2021** (& **OWASP LLM Top 10 v2025** when AI SDK imports or `aiApplication: true` detected) checklist evidence with explicit scope & limitations. `critical` = non-overridable `FAIL`; `high` = overridable `FAIL`.
  4. **Gate 04 — Testing & Coverage:** Zero-token Vitest execution (`--reporter=json` + `@vitest/coverage-v8` `coverage-summary.json`) behind `TestRunnerParser`. Fails closed on any failed test, zero executed tests, disallowed skipped tests, missing coverage report, or coverage below configurable minimum (**70%** default across lines, statements, functions, branches — evaluated per workspace package in monorepos).
  5. **Gate 05 — Code Review Sign-off:** Verifies fresh Gate 01 (`planHash`) and fresh Gates 02–04 (`codeHash`) all have `PASS` evidence + independent `code-reviewer` sign-off with zero blocking issues.
- **Workflow State Machine:**
  - States: `INTAKE` → `REQUIREMENTS_REVIEW` → `ARCHITECTURE` → `PLANNING` → `GATE_01` → `RESEARCH` → `IMPLEMENTATION` → `PRE_TEST_REVIEW` → `GATE_02` → `SECURITY_REVIEW` → `GATE_03` → `TESTING` → `GATE_04` → `FINAL_REVIEW` → `GATE_05` → `COMPLETED` (plus `REJECTED`, `BLOCKED`, `CANCELLED`, `NEEDS_HUMAN_APPROVAL`).
  - Rework edges preserve prior findings and increment bounded retry count (default max 3 retries per gate before transitioning to `NEEDS_HUMAN_APPROVAL`/`BLOCKED`). If `TESTING` modifies tests (changing `codeHash`), the engine routes through zero-token Gate 02/03 re-validation before Gate 04 & Gate 05.
  - Human override (`donaron gate override`) requires `process.stdin.isTTY` + interactive confirmation + non-empty `--reason` + `--approver`; writes to `audit.jsonl`; strictly rejected for Gate 03 `critical` findings.

### 6.4 `packages/adapters`

- **Shared Contract (`HarnessAdapter`):** `id`, `getCapabilities()`, `validateCompatibility(plugin)`, `exportPlugin(plugin, outDir, opts)`, `installPlugin(plugin, targetDir, opts)`, `translateHookInput(event, rawStdin)`, `translateHookOutput(event, decision)`.
- **Antigravity Adapter:**
  - Outputs `plugin.json` (strictly Antigravity-supported top-level keys only), root `hooks.json` (Windows-safe `node "<cliPath>" hook antigravity <Event>`), `rules/AGENTS.md` (validated `< 24,000` bytes), `skills/<name>/SKILL.md` (+ `references/`), `agents/<name>.md` (`name` + `description` frontmatter + full contract body).
  - Resolves target workspace from hook stdin's `cwd` (falling back to `workspacePaths[0]`).
  - Capability report: `skills: NATIVE`, `rules: NATIVE`, `agents: NATIVE`, `agentPolicyEnforcement: PARTIAL`, `hooks.sessionStart|preToolUse|postToolUse|stop: NATIVE`, `gates: EMULATED`.
- **Claude Code Adapter:**
  - Outputs `.claude-plugin/plugin.json`, `hooks/hooks.json` (`node "<cliPath>" hook claude-code <Event>`), `CLAUDE.md`, `skills/<name>/SKILL.md`, `agents/<name>.md` (mapping `name`, `description`, `tools`, and `modelTier` → `haiku`/`sonnet`/`opus` alias).
  - Capability report: export structure and hook translation contract-tested; live Claude Code runtime marked `UNVERIFIED` until explicitly executed and verified against local `claude.exe`.

### 6.5 `apps/cli` (`donaron`)

Thin Commander.js layer (zero domain logic):

- `donaron doctor [--json]`
- `donaron plugin validate <dir> [--json]`
- `donaron plugin list|info|install <dir> [--target antigravity|claude-code|all]|uninstall <name>`
- `donaron export <dir> --target antigravity|claude-code --out <dir>`
- `donaron adapter capabilities [antigravity|claude-code] [--json]`
- `donaron workflow start [--tier strict|standard|quick] [--task "..."] [--plan <files...>]`
- `donaron workflow status|advance|record-review [--json]`
- `donaron gate run <01|02|03|04|05|all> [--json]` / `status` / `override <gateId> --reason <text> --approver <name>`
- `donaron hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>` (bounded timeout; fails closed on critical policy/gate errors; honors Choice 2A in non-workflow repos and `continuationActive` loop guard on `Stop`).

### 6.6 `plugins/donaron-dev` (Flagship Personal Node + React Plugin)

- **Skills (progressive `SKILL.md` + `references/`):** `node-react-planning`, `node-react-implement`, `node-react-testing`, `security-review`, `code-review`, `debugging`.
- **Full 15-Agent Strict Roster:**
  - Planning: `requirements-gatherer`, `intake-reviewer`, `solutions-architect`, `planner`
  - Research: `explore`, `researcher`, `ask`
  - Build: `developer`, `developer-tester`, `devops`, `worker`, `general-purpose`
  - Verify: `reviewer`, `code-reviewer`, `qa`
- **Rules (`rules/*.md`, compiled `< 24 KB`):** Routing, security, Node+React development, and concise structured writing/handoff rules.
- **Hooks (`hooks/hooks.json`):** Declarative bindings to `session-context` (`SessionStart`), `policy-guard` (`PreToolUse`), `stale-tracker` (`PostToolUse`), and `gate-stop-guard` (`Stop`).

---

## 7. Seven Green-Gated Implementation Phases

Every phase follows **analyze → implement → verify all green → user approval before next phase**:

1. **Phase 1 — Foundation & Monorepo Setup:** Install/enable `pnpm`, create the 5 workspace modules, strict ESM TypeScript project references, ESLint/Prettier, Vitest + v8 coverage (≥70% thresholds), commit design doc & decision log. _Green bar: `pnpm build && pnpm lint && pnpm format:check && pnpm test` pass._
2. **Phase 2 — Core Schema, Loaders & Policy Engine (`packages/core`):** JSON Schema v1 (Ajv), path-traversal-proof loader, skill/agent/rule/hook parsers, fail-closed policy engine (protecting `.donaron/`, secrets, destructive commands), secret-redacting Pino logger. _Green bar: unit + security tests ≥70% lines/statements/functions/branches._
3. **Phase 3 — Gate Engine, Scoped Evidence Store & Strict Orchestrator (`packages/gates`):** `planHash`/`codeHash` engine, Evidence Store, stale-evidence invalidation, Gates 01–05 runners (compile/lint, secret scan + dependency audit, Vitest per-package coverage parser, anti-self-approval review checks), `strict` default state machine (+ optional `standard`/`quick`), bounded rework, TTY-gated overrides. _Green bar: unit + integration + gate-bypass & stale-hash security tests ≥70% coverage._
4. **Phase 4 — Antigravity & Claude Code Adapters (`packages/adapters`):** Shared contract, Antigravity exporter & camelCase hook translator, Claude Code exporter & hook translator, honest capability matrix. _Green bar: contract tests + golden export fixtures + Windows-safe hook stdin/stdout tests ≥70% coverage._
5. **Phase 5 — `donaron` CLI & Live Hook Bridge (`apps/cli`):** All CLI commands (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`, `hook`), interactive permission prompts, structured `--json` output, fail-closed hook error/timeout handling. _Green bar: E2E CLI + hook bridge tests on a real Node+React fixture repo ≥70% coverage._
6. **Phase 6 — Flagship `donaron-dev` Node + React Plugin (`plugins/donaron-dev`):** Complete progressive skills, full 15-agent strict roster, compact rules (<24 KB), and hook bindings; validate, export for Antigravity & Claude Code, and smoke-test live Antigravity installation/discovery & hook invocation. _Green bar: `donaron validate`, dual `donaron export`, and live Antigravity discovery & hook smoke checks pass._
7. **Phase 7 — Security Hardening, Self-Gated Verification & Documentation:** Run DonAron's own Gates 01–05 against `donaron-plugin` itself, verify secret redaction & permission boundaries, test install/upgrade/uninstall, and ship concise docs separating verified behavior from planned/unverified items. _Green bar: full monorepo green + ≥70% per-package coverage + self-hosted Gate 01–05 `PASS`._

---

## 8. What's Left to the Builder

- Internal file/module layout inside each of the 5 packages.
- Secret-scanner regex catalog and ignore-pattern syntax (`.donaronignore`).
- Human-readable CLI table formatting alongside `--json` output.
- Exact source files inside the minimal Node + React E2E test fixture repo.
- Exact prompt phrasing inside `plugins/donaron-dev/` skills and agent markdown bodies (within the defined contracts and Antigravity's 24 KB rule limit).
