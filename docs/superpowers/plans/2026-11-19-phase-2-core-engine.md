# DonAron-plugin Phase 2 — Core Schema, Loaders & Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the complete platform-independent `@donaron/core` package (`schemas/donaron-plugin.v1.schema.json`, Ajv manifest validator, path-traversal-proof plugin loader, skill/agent/rule/hook parsers, fail-closed deterministic policy engine, and secret-redacting Pino logger) with unit + security tests at ≥70% coverage.

**Architecture:** All Phase 2 code lives inside `packages/core` (zero dependencies on `@donaron/gates`, `@donaron/adapters`, `@donaron/cli`, or any harness SDK) plus the canonical schema under `schemas/donaron-plugin.v1.schema.json`. Pure domain modules (`manifest/`, `loader/`, `parsers/`, `policy/`, `logger/`) compose into a single barrel export in `packages/core/src/index.ts`. Work executes on branch `phase-2/core-engine` cut from `phase-1/foundation` (`e9749e3`).

**Tech Stack:** TypeScript 5.8 (strict ESM / `NodeNext`), Node.js `>=24.0.0`, `ajv` (Draft 2020-12) + `ajv-formats`, `yaml`, `semver`, `pino`, Vitest + `@vitest/coverage-v8`, ESLint 9 (`strictTypeChecked`), Prettier.

**Spec:** [2026-11-19-donaron-plugin-design.md](../specs/2026-11-19-donaron-plugin-design.md) (§5, §6.2, §7 Phase 2)

## Global Constraints

- Repository root: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`; work on branch `phase-2/core-engine` branched from `phase-1/foundation` (`e9749e3`)
- Core independence: `@donaron/core` must have zero workspace dependencies and zero harness-SDK dependencies
- Strict JSON Schema v1: `additionalProperties: false`; unknown fields rejected loudly; valid semver required for `version`, `compatibility.donaronPlugin`, and `dependencies[].versionRange`
- Never execute any plugin script or hook command during discovery, validation, or loading
- Fail-closed policy evaluation: `DENY > REQUIRE_APPROVAL > ALLOW`; any matcher error or missing workspace root on filesystem checks resolves to `{ effect: 'DENY', failedClosed: true }`
- Choice 1A & 2A defaults built in: agents are blocked from modifying `.donaron/runs/**` or `.donaron/evidence/**`, blocked from invoking `donaron gate override`, blocked from escaping workspace root, and blocked from reading `.env*`/private keys or running destructive commands
- Windows-safe path handling: use `node:path` + `fs.realpathSync`, normalize POSIX relative paths for digests, handle Windows case-insensitive roots, drive letters, and UNC paths
- Windows pnpm execution rule: run `pnpm --dir ... add` / `pnpm --dir ... install` with `BypassSandbox: true`; run `pnpm run check`, `pnpm run test`, `pnpm run build` inside the sandbox
- Phase 2 green bar: `pnpm clean && pnpm check` (`build` + `typecheck` + `lint` + `format:check` + `test:coverage`) passes with ≥70% lines, statements, functions, and branches across `@donaron/core`

## Review Focus

1. **Windows drive-relative & UNC path escapes (`C:secret`, `\\host\share`, mixed `/` and `\`):** Naive `path.join` or `.startsWith()` checks allow drive-relative or case-mismatched escapes on Windows — pinned by Task 2 tests.
2. **Symlink / NTFS directory junction escaping `pluginRoot`:** Lexically clean paths like `skills/evil/SKILL.md` can point outside `pluginRoot` via symlinks/junctions — pinned by Task 2 real-filesystem symlink/junction containment tests.
3. **Windows CRLF (`\r\n`) and UTF-8 BOM (`\uFEFF`) in Markdown frontmatter:** Editors on Windows emit BOM + CRLF before `---`, silently breaking naive `^---\n` splitters — pinned by Task 3 frontmatter tests.
4. **Secret values embedded inside free-form strings, error messages, and nested arrays:** Key-only Pino redaction misses `Bearer eyJ...`, `sk-ant-...`, `ghp_...`, AWS keys, PEM blocks, and `://user:pass@` inside message strings — pinned by Task 6 logger & security tests.
5. **Broken user regex or thrown matcher error failing open in Policy Engine:** Invalid regex patterns in workspace policy configs must never throw uncaught exceptions or fall through to `ALLOW` — pinned by Task 5 fail-closed tests.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── schemas/
│   └── donaron-plugin.v1.schema.json
├── packages/core/
│   ├── package.json                           # add ajv, ajv-formats, yaml, semver, pino (+ @types/semver)
│   └── src/
│       ├── index.ts                           # public barrel exporting core APIs + ModuleInfo
│       ├── types.ts                           # shared ValidationIssue, Result, permission & capability types
│       ├── manifest/
│       │   ├── validator.ts                   # Ajv Draft 2020-12 manifest validator + semver compatibility check
│       │   └── validator.test.ts
│       ├── loader/
│       │   ├── safe-path.ts                   # path-traversal & realpath symlink/junction containment resolver
│       │   ├── safe-path.test.ts
│       │   ├── digest.ts                      # deterministic POSIX-normalized SHA-256 bundle digest
│       │   ├── digest.test.ts
│       │   ├── plugin-loader.ts               # discoverPlugins, loadPlugin, validatePluginDependencies
│       │   └── plugin-loader.test.ts
│       ├── parsers/
│       │   ├── frontmatter.ts                 # BOM/CRLF-safe YAML frontmatter extractor
│       │   ├── skill-parser.ts                # SKILL.md metadata + safe ref/script validation
│       │   ├── agent-parser.ts                # agents/<name>.md metadata + modelTier contract
│       │   ├── rule-parser.ts                 # rules/*.md guidance parser (rejects enforcement:'policy')
│       │   ├── hook-parser.ts                 # declarative hooks/hooks.json validator (rejects arbitrary cmds)
│       │   └── parsers.test.ts
│       ├── policy/
│       │   ├── defaults.ts                    # DEFAULT_SECURITY_POLICIES (Choice 1A & 2A + Spec §16)
│       │   ├── policy-engine.ts               # fail-closed evaluator + JSON policy file loader
│       │   └── policy-engine.test.ts
│       ├── logger/
│       │   ├── redact.ts                      # recursive key redactor + regex value scrubber
│       │   ├── logger.ts                      # Pino structured redacting logger factory
│       │   └── logger.test.ts
│       └── __tests__/
│           └── security.test.ts               # dedicated Phase 2 security regression suite
├── tests/fixtures/plugins/
│   ├── valid-sample/                          # complete valid v1 plugin fixture (skill, agent, rule, hook, policy)
│   └── invalid-manifest/                      # malformed manifest fixture
└── docs/
    ├── plugin-specification.md
    ├── manifest-schema.md
    └── superpowers/plans/2026-11-19-phase-2-core-engine.md
```

---

### Task 1: Branch Setup, Core Dependencies, Manifest v1 JSON Schema & Validator

**Files:**

- Modify: `packages/core/package.json`
- Create: `schemas/donaron-plugin.v1.schema.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/manifest/validator.ts`
- Test: `packages/core/src/manifest/validator.test.ts`

**Interfaces:**

- Produces (`packages/core/src/types.ts`):
  ```ts
  export type Permission = 'fs:read' | 'fs:write' | 'cmd:exec' | 'net:outbound' | 'env:read';
  export interface ValidationIssue {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }
  export type ValidationResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
  export interface PluginDependency {
    readonly id: string;
    readonly versionRange: string;
  }
  export interface PluginCapabilities {
    readonly skills?: readonly string[];
    readonly agents?: readonly string[];
    readonly rules?: readonly string[];
    readonly hooks?: readonly string[];
    readonly tools?: readonly string[];
    readonly policies?: readonly string[];
  }
  export interface DonAronManifest {
    readonly $schema?: string;
    readonly manifestVersion: '1';
    readonly id: string;
    readonly name: string;
    readonly displayName?: string;
    readonly version: string;
    readonly description: string;
    readonly author?: string | { readonly name: string; readonly url?: string };
    readonly license?: string;
    readonly homepage?: string;
    readonly repository?: string | { readonly type: 'git'; readonly url: string };
    readonly logo?: string;
    readonly suggestedPrompts?: readonly string[];
    readonly compatibility: {
      readonly donaronPlugin: string;
      readonly harnesses?: Readonly<Record<string, string>>;
    };
    readonly permissions: readonly Permission[];
    readonly capabilities: PluginCapabilities;
    readonly dependencies?: readonly PluginDependency[];
  }
  ```
- Produces (`packages/core/src/manifest/validator.ts`):

  ```ts
  export const SUPPORTED_MANIFEST_VERSION = '1';
  export function validateManifest(raw: unknown): ValidationResult<DonAronManifest>;
  export function isCompatibleWithCoreVersion(
    manifest: DonAronManifest,
    coreVersion: string,
  ): boolean;
  ```

- [ ] **Step 1: Create branch `phase-2/core-engine` from `phase-1/foundation` and install `@donaron/core` dependencies**

Run (sandbox): `git checkout -b phase-2/core-engine` inside `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.
Run (outside sandbox, `BypassSandbox: true`):

- `pnpm --dir C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin --filter @donaron/core add ajv@8.17.1 ajv-formats@3.0.1 yaml@2.8.1 semver@7.7.3 pino@9.14.0`
- `pnpm --dir C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin --filter @donaron/core add -D @types/semver@7.7.1`
  Expected: `packages/core/package.json` has only those 5 runtime deps + `@types/semver` devDep, zero `@donaron/*` workspace deps.

- [ ] **Step 2: Write `schemas/donaron-plugin.v1.schema.json` and `packages/core/src/types.ts`**

Create `schemas/donaron-plugin.v1.schema.json` using JSON Schema Draft 2020-12 with `additionalProperties: false`, required fields (`manifestVersion`, `id`, `name`, `version`, `description`, `compatibility`, `permissions`, `capabilities`), permission enum, relative-path pattern checks (rejecting leading `/`, `\`, drive prefixes, and `..` segments), `suggestedPrompts` maxItems 3, `logo` extension pattern (`\.(png|svg|jpg|jpeg|webp)$`), and `https://` pattern on external URLs. Create `packages/core/src/types.ts`.

- [ ] **Step 3: Write failing manifest validation tests**

Create `packages/core/src/manifest/validator.test.ts` testing:

- Valid minimal and full manifests pass `validateManifest`.
- Unknown top-level or nested fields fail with structured `ValidationIssue`.
- Unsupported `manifestVersion` (`"2"`) fails.
- Invalid `version` (`"not-semver"`), invalid `compatibility.donaronPlugin` range (`"???"`), invalid dependency `versionRange` fail.
- Invalid permission string (`"fs:admin"`), duplicate permissions, >3 `suggestedPrompts`, non-HTTPS `homepage`, absolute/traversal capability path (`"../evil.md"`, `"/etc/passwd"`) all fail.
- `isCompatibleWithCoreVersion(manifest, '1.2.0')` returns `true` for `^1.0.0` and `false` for `^2.0.0`.

- [ ] **Step 4: Run test to verify failure**

Run (sandbox): `pnpm run test -- packages/core/src/manifest/validator.test.ts` (or direct vitest on the file)
Expected: FAIL because `validator.ts` does not exist.

- [ ] **Step 5: Implement `packages/core/src/manifest/validator.ts`**

Compile `donaron-plugin.v1.schema.json` using `Ajv2020` (`ajv/dist/2020.js`) + `addFormats`, run schema validation + `semver.valid` / `semver.validRange` checks on `version`, `compatibility.donaronPlugin`, and `dependencies[].versionRange`, returning normalized `ValidationResult<DonAronManifest>`. Note: embed or load the schema via relative `fileURLToPath`/`readFileSync` (or static JSON import with `with { type: 'json' }`) so it works identically from both `src/` and built `dist/`!

- [ ] **Step 6: Verify tests pass and commit**

Run (sandbox): `pnpm run check`
Expected: All tests pass, `typecheck` + `strictTypeChecked` ESLint + Prettier pass, coverage ≥70%.
Commit: `git add -A && git commit -m "feat(core): add universal plugin manifest v1 schema and validator"`

---

### Task 2: Path-Safe Resolver (Windows + Symlink Containment) & SHA-256 Digest

**Files:**

- Create: `packages/core/src/loader/safe-path.ts`
- Create: `packages/core/src/loader/digest.ts`
- Test: `packages/core/src/loader/safe-path.test.ts`
- Test: `packages/core/src/loader/digest.test.ts`

**Interfaces:**

- Consumes: `ValidationIssue`, `ValidationResult` from `../types.js`
- Produces (`packages/core/src/loader/safe-path.ts`):
  ```ts
  export interface SafePathOptions {
    readonly mustExist?: boolean;
  }
  export interface ResolvedSafePath {
    readonly absolutePath: string;
    readonly relativePosixPath: string;
  }
  export function resolveSafePluginPath(
    pluginRoot: string,
    relativePath: string,
    options?: SafePathOptions,
  ): ValidationResult<ResolvedSafePath>;
  ```
- Produces (`packages/core/src/loader/digest.ts`):

  ```ts
  export function computePluginDigest(pluginRoot: string, relativePaths: readonly string[]): string; // returns "sha256:<64-hex>"
  ```

- [ ] **Step 1: Write failing tests for `safe-path.ts` and `digest.ts` (Review Focus #1 & #2)**

Create `packages/core/src/loader/safe-path.test.ts` (using `mkdtempSync` temp dirs cleaned up in `afterEach`):

- Accepts normal nested files (`skills/my-skill/SKILL.md`, `rules/security.md`) and returns normalized POSIX `relativePosixPath`.
- Rejects `../outside.txt`, `skills/../../outside.txt`, null bytes (`foo\0bar`), empty string, POSIX absolute (`/etc/passwd`), Windows absolute (`C:\Windows\win.ini`), Windows drive-relative (`C:foo.txt`), and Windows UNC (`\\server\share\file.txt`).
- Rejects a real symlink/junction inside `pluginRoot` pointing to a sibling temp directory outside `pluginRoot` (on Windows, use `'junction'` for directory symlinks so it works without admin privileges!).
- When `mustExist: true`, rejects missing files with code `'PATH_NOT_FOUND'`.

Create `packages/core/src/loader/digest.test.ts`:

- Produces identical `sha256:<64-hex>` regardless of input array order or `\` vs `/` separators.
- Changes digest when any file's content OR relative path changes.

- [ ] **Step 2: Run tests to verify failure**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/core/src/loader/`
Expected: FAIL because `safe-path.ts` and `digest.ts` do not exist.

- [ ] **Step 3: Implement `safe-path.ts` and `digest.ts`**

- `safe-path.ts`: Reject empty strings, `\0`, leading `/` or `\`, Windows drive prefix (`/^[a-zA-Z]:/`), UNC prefix (`/^\\\\/`), and any `..` path segment before resolution. Compute `realRoot = fs.realpathSync(pluginRoot)` and resolve candidate; if candidate (or nearest existing ancestor when `mustExist: false`) exists, verify `realpathSync` containment against `realRoot` using case-insensitive comparison on `win32` and strict separator boundary (`resolved === root || resolved.startsWith(root + path.sep)`).
- `digest.ts`: Normalize each relative path via `resolveSafePluginPath(..., { mustExist: true })`, sort lexicographically by `relativePosixPath`, stream path + `\0` + file length + `\0` + bytes into `crypto.createHash('sha256')`, return `` `sha256:${hash.digest('hex')}` ``.

- [ ] **Step 4: Run tests & full check, then commit**

Run (sandbox): `pnpm run check`
Expected: All tests pass, coverage ≥70%.
Commit: `git add -A && git commit -m "feat(core): add path-traversal-proof resolver and deterministic plugin digest"`

---

### Task 3: Skill, Agent, Rule & Declarative Hook Parsers

**Files:**

- Create: `packages/core/src/parsers/frontmatter.ts`
- Create: `packages/core/src/parsers/skill-parser.ts`
- Create: `packages/core/src/parsers/agent-parser.ts`
- Create: `packages/core/src/parsers/rule-parser.ts`
- Create: `packages/core/src/parsers/hook-parser.ts`
- Test: `packages/core/src/parsers/parsers.test.ts`

**Interfaces:**

- Consumes: `ValidationResult`, `ValidationIssue` from `../types.js`; `resolveSafePluginPath` from `../loader/safe-path.js`
- Produces:

  ```ts
  export type ModelTier = 'fast' | 'balanced' | 'reasoning';
  export type RuleCategory = 'routing' | 'security' | 'development' | 'writing';
  export type HookEventName = 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop';
  export type BuiltinHookHandler =
    | 'session-context'
    | 'policy-guard'
    | 'stale-tracker'
    | 'gate-stop-guard';

  export interface ParsedSkill {
    readonly name: string;
    readonly description: string;
    readonly purpose: string;
    readonly activation: string;
    readonly inputs: readonly string[];
    readonly outputs: readonly string[];
    readonly constraints: readonly string[];
    readonly completionCriteria: readonly string[];
    readonly references: readonly string[];
    readonly scripts: readonly { readonly path: string; readonly requiresPolicyApproval: true }[];
    readonly version?: string;
    readonly body: string;
    readonly sourcePath: string;
  }

  export interface ParsedAgent {
    readonly name: string;
    readonly role: string;
    readonly description: string;
    readonly responsibilities: readonly string[];
    readonly nonResponsibilities: readonly string[];
    readonly skills: readonly string[];
    readonly tools: readonly string[];
    readonly permissionProfile: string;
    readonly modelTier: ModelTier;
    readonly inputContract: string;
    readonly outputContract: string;
    readonly handoffConditions: readonly string[];
    readonly maxRetries: number;
    readonly requiresHumanApproval: boolean;
    readonly body: string;
    readonly sourcePath: string;
  }

  export interface ParsedRule {
    readonly id: string;
    readonly category: RuleCategory;
    readonly scope: string;
    readonly priority: number;
    readonly body: string;
    readonly sourcePath: string;
  }

  export interface HookBinding {
    readonly id: string;
    readonly event: HookEventName;
    readonly handler: BuiltinHookHandler;
    readonly matcher?: string;
    readonly timeoutSec: number;
    readonly failurePolicy: 'fail_closed' | 'warn';
    readonly enabled: boolean;
  }

  export function parseMarkdownFrontmatter(
    raw: string,
  ): ValidationResult<{ readonly data: Record<string, unknown>; readonly body: string }>;
  export function parseSkillFile(
    pluginRoot: string,
    relativePath: string,
  ): ValidationResult<ParsedSkill>;
  export function parseAgentFile(
    pluginRoot: string,
    relativePath: string,
  ): ValidationResult<ParsedAgent>;
  export function parseRuleFile(
    pluginRoot: string,
    relativePath: string,
  ): ValidationResult<ParsedRule>;
  export function parseHooksFile(
    pluginRoot: string,
    relativePath: string,
  ): ValidationResult<readonly HookBinding[]>;
  ```

- [ ] **Step 1: Write failing parser tests (including Review Focus #3: BOM + CRLF)**

Create `packages/core/src/parsers/parsers.test.ts` testing:

- `parseMarkdownFrontmatter`: handles LF, CRLF (`\r\n`), and UTF-8 BOM (`\uFEFF---`); rejects missing frontmatter, unclosed delimiter, non-object YAML, and syntax errors.
- `parseSkillFile`: parses valid `SKILL.md` (with `references` + `scripts` verified inside `pluginRoot`, marking every script `requiresPolicyApproval: true`); rejects missing required fields and rejects any reference/script escaping `pluginRoot` via `../`.
- `parseAgentFile`: parses valid agent markdown with `modelTier: 'balanced'`; rejects invalid `modelTier` (`'gpt-4'`), negative `maxRetries`, missing `nonResponsibilities`.
- `parseRuleFile`: parses valid rule markdown; rejects invalid `category` and rejects unknown frontmatter key `enforcement: 'policy'` (enforcing separation between prompt guidance rules and deterministic policies).
- `parseHooksFile`: parses valid declarative `hooks.json` with built-in handlers (`policy-guard`, `gate-stop-guard`, etc.); rejects arbitrary shell commands (`handler: 'rm -rf /'`, extra `command` field), invalid event names, and out-of-range `timeoutSec` (`0` or `300`).

- [ ] **Step 2: Run tests to verify failure**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/core/src/parsers/parsers.test.ts`
Expected: FAIL because parser files do not exist.

- [ ] **Step 3: Implement `frontmatter.ts`, `skill-parser.ts`, `agent-parser.ts`, `rule-parser.ts`, `hook-parser.ts`**

Use `yaml`'s `parse` for frontmatter, Ajv/strict type guards for each parsed structure, and `resolveSafePluginPath(..., { mustExist: true })` for file reads and skill `references`/`scripts` validation. Never execute scripts.

- [ ] **Step 4: Run full check and commit**

Run (sandbox): `pnpm run check`
Expected: All tests pass, coverage ≥70%.
Commit: `git add -A && git commit -m "feat(core): add skill, agent, rule, and declarative hook parsers"`

---

### Task 4: Safe Plugin Discovery, Full Bundle Loader & Dependency Resolver

**Files:**

- Create: `packages/core/src/loader/plugin-loader.ts`
- Create: `tests/fixtures/plugins/valid-sample/` (`plugin.json`, `skills/sample-skill/SKILL.md`, `skills/sample-skill/references/guide.md`, `agents/developer.md`, `rules/security.md`, `hooks/hooks.json`, `policies/custom.json`)
- Create: `tests/fixtures/plugins/invalid-manifest/plugin.json`
- Test: `packages/core/src/loader/plugin-loader.test.ts`

**Interfaces:**

- Consumes: `validateManifest`, `isCompatibleWithCoreVersion`, `resolveSafePluginPath`, `computePluginDigest`, `parseSkillFile`, `parseAgentFile`, `parseRuleFile`, `parseHooksFile`, `PolicyRule` (forward-typed via `types.ts` or Task 5 schema)
- Produces (`packages/core/src/loader/plugin-loader.ts`):

  ```ts
  export interface LoadedPlugin {
    readonly rootDir: string;
    readonly manifest: DonAronManifest;
    readonly digest: string;
    readonly skills: readonly ParsedSkill[];
    readonly agents: readonly ParsedAgent[];
    readonly rules: readonly ParsedRule[];
    readonly hooks: readonly HookBinding[];
    readonly toolConfigPaths: readonly string[];
    readonly policyPaths: readonly string[];
  }
  export interface DiscoveryEntry {
    readonly dir: string;
    readonly manifestPath: string;
  }
  export function discoverPlugins(searchDirs: readonly string[]): readonly DiscoveryEntry[];
  export function loadPlugin(
    pluginRoot: string,
    options?: { readonly coreVersion?: string },
  ): ValidationResult<LoadedPlugin>;
  export function validatePluginDependencies(
    plugins: readonly LoadedPlugin[],
  ): ValidationResult<readonly LoadedPlugin[]>;
  ```

- [ ] **Step 1: Create valid & invalid plugin fixtures under `tests/fixtures/plugins/`**

Create `valid-sample/` (with 1 skill + reference, 1 agent, 1 rule, 1 declarative hook binding, 1 JSON policy file) and `invalid-manifest/` (missing required fields + unknown field).

- [ ] **Step 2: Write failing loader & dependency tests**

Create `packages/core/src/loader/plugin-loader.test.ts` testing:

- `discoverPlugins` finds subdirectories containing `plugin.json` and ignores non-plugin folders cleanly (handles missing searchDirs without throwing).
- `loadPlugin` loads `tests/fixtures/plugins/valid-sample`, parses all skills/agents/rules/hooks, computes `sha256:` digest, and verifies compatibility against `coreVersion`.
- `loadPlugin` fails on `invalid-manifest`, missing declared capability files, incompatible `coreVersion`, and duplicate skill/agent/rule names within one plugin.
- `validatePluginDependencies` passes when dependencies exist and satisfy semver ranges; fails on missing dependency, version mismatch, duplicate plugin IDs, or circular dependencies.

- [ ] **Step 3: Run tests to verify failure**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/core/src/loader/plugin-loader.test.ts`
Expected: FAIL because `plugin-loader.ts` does not exist.

- [ ] **Step 4: Implement `packages/core/src/loader/plugin-loader.ts`**

Validate manifest, resolve and parse all declared capabilities safely, detect internal name collisions, compute bundle digest over `plugin.json` + all referenced files, and implement topological/cycle-aware dependency validation.

- [ ] **Step 5: Run full check and commit**

Run (sandbox): `pnpm run check`
Expected: All tests pass, coverage ≥70%.
Commit: `git add -A && git commit -m "feat(core): add safe plugin discovery, bundle loader, and dependency checks"`

---

### Task 5: Deterministic Fail-Closed Policy Engine & Built-In Security Policies

**Files:**

- Create: `packages/core/src/policy/defaults.ts`
- Create: `packages/core/src/policy/policy-engine.ts`
- Test: `packages/core/src/policy/policy-engine.test.ts`

**Interfaces:**

- Consumes: `ValidationResult` from `../types.js`; `resolveSafePluginPath` from `../loader/safe-path.js`
- Produces (`packages/core/src/policy/policy-engine.ts` & `defaults.ts`):

  ```ts
  export type PolicyEffect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  export type PolicyAction =
    | 'fs:read'
    | 'fs:write'
    | 'fs:delete'
    | 'cmd:exec'
    | 'net:outbound'
    | 'env:read'
    | 'workflow:override'
    | 'workflow:record-review';

  export interface PolicyRule {
    readonly id: string;
    readonly description: string;
    readonly priority: number;
    readonly effect: PolicyEffect;
    readonly actions: readonly PolicyAction[];
    readonly pathPatterns?: readonly string[]; // regex matched against normalized POSIX path
    readonly commandPatterns?: readonly string[]; // regex matched against command string
    readonly actorTypes?: readonly ('agent' | 'human' | 'system')[];
    readonly critical?: boolean;
  }

  export interface PolicyRequest {
    readonly action: PolicyAction;
    readonly actorType: 'agent' | 'human' | 'system';
    readonly actorId?: string;
    readonly workspaceRoot?: string;
    readonly targetPath?: string;
    readonly command?: string;
    readonly allowlistedPaths?: readonly string[]; // explicit workspace allowlist (never bypasses critical rules)
  }

  export interface PolicyDecision {
    readonly effect: PolicyEffect;
    readonly matchedRuleId: string;
    readonly reason: string;
    readonly evaluatedRulesCount: number;
    readonly failedClosed: boolean;
  }

  export const DEFAULT_SECURITY_POLICIES: readonly PolicyRule[];
  export function parsePolicyFile(
    pluginRoot: string,
    relativePath: string,
  ): ValidationResult<readonly PolicyRule[]>;
  export function evaluatePolicy(
    request: PolicyRequest,
    extraRules?: readonly PolicyRule[],
  ): PolicyDecision;
  ```

- [ ] **Step 1: Write failing policy engine & fail-closed tests (Review Focus #5)**

Create `packages/core/src/policy/policy-engine.test.ts` testing:

- Precedence: `DENY` beats `REQUIRE_APPROVAL` beats `ALLOW`; higher `priority` wins within the same effect; deterministic tie-break by `id`.
- Built-in Choice 1A rules:
  - Agent `fs:write` / `fs:delete` to `.donaron/runs/run-1/state.json` or `.donaron/evidence/gate.json` → `DENY` (even if `allowlistedPaths` lists it, because rule is `critical: true`).
  - Agent `cmd:exec` running `donaron gate override ...` → `DENY` (`critical: true`).
  - Human `workflow:override` → `REQUIRE_APPROVAL` (not blocked for human interactive flow).
- Built-in Choice 2A & Spec §16 rules:
  - `fs:read` on `.env`, `.env.local`, `certs/server.key`, `id_rsa` → `DENY`; `.env.example` → `ALLOW`.
  - `fs:write` targeting path outside `workspaceRoot` (`../outside.ts`, `C:\Windows\foo`) → `DENY`.
  - `cmd:exec` running `git push --force`, `git reset --hard`, `rm -rf /`, `DROP TABLE users` → `DENY`; `git push origin main` / `pnpm publish` → `REQUIRE_APPROVAL`; `pnpm test` → `ALLOW`.
- Fail-closed behavior (Review Focus #5):
  - Malformed regex (`"[unclosed"`) in an extra rule → returns `{ effect: 'DENY', failedClosed: true }` instead of throwing or returning `ALLOW`.
  - `fs:write` with `targetPath` provided but missing `workspaceRoot` → returns `{ effect: 'DENY', failedClosed: true }`.
- `parsePolicyFile` validates JSON policy files and rejects unknown fields or invalid regexes at parse time.

- [ ] **Step 2: Run tests to verify failure**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/core/src/policy/policy-engine.test.ts`
Expected: FAIL because `policy-engine.ts` and `defaults.ts` do not exist.

- [ ] **Step 3: Implement `defaults.ts` and `policy-engine.ts`**

Implement strict workspace-containment check for `fs:write`/`fs:delete`, regex matcher evaluation inside a fail-closed `try/catch`, critical-rule non-bypassable enforcement, and strict JSON schema parsing in `parsePolicyFile`.

- [ ] **Step 4: Run full check and commit**

Run (sandbox): `pnpm run check`
Expected: All tests pass, coverage ≥70%.
Commit: `git add -A && git commit -m "feat(core): add deterministic fail-closed policy engine and default security rules"`

---

### Task 6: Secret-Redacting Pino Logger, Core Exports, Security Test Suite & Phase 2 Docs

**Files:**

- Create: `packages/core/src/logger/redact.ts`
- Create: `packages/core/src/logger/logger.ts`
- Test: `packages/core/src/logger/logger.test.ts`
- Test: `packages/core/src/__tests__/security.test.ts`
- Modify: `packages/core/src/index.ts` (export all Phase 2 core APIs alongside existing `DONARON_CORE_VERSION` & `getCoreModuleInfo`)
- Create: `docs/plugin-specification.md`
- Create: `docs/manifest-schema.md`
- Create: `docs/superpowers/plans/2026-11-19-phase-2-core-engine.md` (copy of this plan)
- Modify: `README.md` (update Phase 2 status to Implemented once green)

**Interfaces:**

- Produces (`packages/core/src/logger/redact.ts` & `logger.ts`):

  ```ts
  export const REDACTED_VALUE = '[REDACTED]';
  export function redactSecrets(input: string): string;
  export function redactObject<T>(value: T): T;
  export interface LoggerOptions {
    readonly name?: string;
    readonly level?: 'debug' | 'info' | 'warn' | 'error';
    readonly destination?: { write(chunk: string): void };
  }
  export interface DonAronLogger {
    debug(context: Record<string, unknown>, message: string): void;
    info(context: Record<string, unknown>, message: string): void;
    warn(context: Record<string, unknown>, message: string): void;
    error(context: Record<string, unknown>, message: string): void;
  }
  export function createLogger(options?: LoggerOptions): DonAronLogger;
  ```

- [ ] **Step 1: Write failing logger & security regression tests (Review Focus #4)**

Create `packages/core/src/logger/logger.test.ts` testing:

- `redactSecrets` replaces AWS keys (`AKIA...`), GitHub PATs (`ghp_...`, `github_pat_...`), OpenAI (`sk-...`), Anthropic (`sk-ant-...`), Google (`AIza...`), Bearer JWTs (`eyJ...`), PEM private keys, and URL credentials (`postgres://user:secret@host/db`) with `[REDACTED]`, while leaving normal text untouched.
- `redactObject` recursively redacts sensitive keys (`token`, `apiKey`, `password`, `secret`, `authorization`, `cookie`, case-insensitive) inside nested objects & arrays AND scrubs secret patterns in string values, safely handling circular references without throwing.
- `createLogger` writes valid JSON lines to custom `destination` stream with zero raw secrets leaking in either `context` fields or `message` strings.

Create `packages/core/src/__tests__/security.test.ts` (end-to-end Phase 2 security verification via `@donaron/core` public barrel):

- Path traversal & symlink escape rejection through `loadPlugin`.
- Malformed manifest & arbitrary executable hook rejection.
- Policy bypass attempts (`.donaron/runs/**` write, `donaron gate override` command, `.env` read, `git push --force`, broken regex fail-closed).
- Secret redaction through `createLogger`.

- [ ] **Step 2: Run tests to verify failure**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/core/src/logger/ packages/core/src/__tests__/security.test.ts`
Expected: FAIL because `redact.ts`, `logger.ts`, and barrel exports do not exist yet.

- [ ] **Step 3: Implement `redact.ts`, `logger.ts`, update `packages/core/src/index.ts`, and author Phase 2 docs**

- Implement `redact.ts` and `logger.ts` wrapping `pino`.
- Update `packages/core/src/index.ts` exporting all manifest, loader, parser, policy, and logger public types & functions while preserving `ModuleInfo`, `DONARON_CORE_VERSION`, and `getCoreModuleInfo()`.
- Author `docs/plugin-specification.md` and `docs/manifest-schema.md` documenting exact v1 manifest fields, versioning/compatibility policy, safe loading guarantees, parser schemas, and policy precedence (distinguishing Phases 1–2 implemented from Phases 3–7 planned).
- Copy this plan into `docs/superpowers/plans/2026-11-19-phase-2-core-engine.md` and update `README.md` status table.

- [ ] **Step 4: Run complete Phase 2 green-bar check**

Run (sandbox): `pnpm run clean && pnpm run check`
And verify `coverage/coverage-summary.json` reports ≥70% across `lines`, `statements`, `functions`, and `branches` (both overall AND specifically across `packages/core/src/**`).
Expected: Exit `0`; every unit, foundation, and security test passes; zero ESLint/Prettier/typecheck errors.

- [ ] **Step 5: Commit Task 6**

Run: `git add -A && git commit -m "feat(core): add redacting logger, public exports, security tests, and Phase 2 docs"`
Expected: clean working tree on `phase-2/core-engine`.
