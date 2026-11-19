# DonAron Universal Plugin Specification (v1)

This specification documents the universal DonAron plugin package format, safety guarantees, artifact contracts, policy engine, and secret-redacting logger implemented in `@donaron/core` (Phase 2).

> [!NOTE]
> **Implementation Status Separation:** Features implemented in **Phase 1** (monorepo foundation) and **Phase 2** (`@donaron/core` schema validation, path-safe loaders, artifact parsers, policy engine, and redacting logger) are marked **Implemented** below. Runtime orchestration, gates, harness adapters, CLI commands, and the flagship `donaron-dev` plugin remain **Planned** for Phases 3–7.

## 1. Implementation Scope

| Capability Area                                                                                   | Status          | Owner Package / Phase     |
| ------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| Universal manifest v1 JSON Schema + Ajv + semver validator                                        | **Implemented** | `@donaron/core` (Ph2)     |
| Path-traversal & symlink/junction-safe resolver + deterministic SHA-256 bundle digest             | **Implemented** | `@donaron/core` (Ph2)     |
| Plugin discovery (`discoverPlugins`), bundle loader (`loadPlugin`), dependency topological checks | **Implemented** | `@donaron/core` (Ph2)     |
| Markdown frontmatter + `SKILL.md`, `agents/*.md`, `rules/*.md`, declarative `hooks.json` parsers  | **Implemented** | `@donaron/core` (Ph2)     |
| Deterministic fail-closed policy engine (`evaluatePolicy`, `parsePolicyFile`, Choice 1A/2A rules) | **Implemented** | `@donaron/core` (Ph2)     |
| Secret-redacting Pino logger (`createLogger`, `redactSecrets`, `redactObject`)                    | **Implemented** | `@donaron/core` (Ph2)     |
| Scoped `planHash`/`codeHash` Evidence Store, Gates 01–05, `strict` workflow state machine         | Planned         | `@donaron/gates` (Ph3)    |
| Harness adapters & hook translators (Antigravity, Claude Code)                                    | Planned         | `@donaron/adapters` (Ph4) |
| `donaron` CLI (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`, `hook`)               | Planned         | `@donaron/cli` (Ph5)      |
| Flagship Node + React plugin (`plugins/donaron-dev`) + live Antigravity smoke verification        | Planned         | `donaron-dev` (Ph6)       |

## 2. Plugin Package Layout

A DonAron v1 plugin is a directory containing `plugin.json` at its root and any capability files declared in `capabilities`:

```text
my-plugin/
├── plugin.json                  # Required: Universal DonAron v1 manifest
├── assets/
│   └── logo.svg                 # Optional: PNG, SVG, JPG, JPEG, or WEBP
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md             # Skill metadata + instructions
│       ├── references/          # Optional safe relative documentation files
│       └── scripts/             # Optional scripts (never auto-executed; requiresPolicyApproval: true)
├── agents/
│   └── <agent-name>.md          # Agent contract + prompt body
├── rules/
│   └── <rule-name>.md           # Prompt guidance rule (never executable policy)
├── hooks/
│   └── hooks.json               # Declarative bindings to built-in DonAron handlers
├── tools/
│   └── mcp.json                 # Optional tool / MCP configuration files
└── policies/
    └── custom.json              # Optional structured PolicyRule[] JSON files
```

Plugins must not declare capabilities whose files do not exist inside the plugin root.

## 3. Discovery, Containment, and Bundle Digest (`@donaron/core`)

### 3.1 Safe Path Resolution (`resolveSafePluginPath`)

Every plugin path—whether in `plugin.json` (`logo`, `capabilities.*`), `SKILL.md` (`references`, `scripts`), or parser calls—must pass `resolveSafePluginPath(pluginRoot, relativePath, options)`:

- Rejects empty/whitespace strings, null bytes, and ASCII control characters (`0x00–0x1f`, `0x7f`).
- Rejects POSIX absolute paths (`/etc/passwd`), Windows backslash roots (`\Windows`), Windows drive-prefixed or drive-relative paths (`C:\...`, `C:secret.txt`), UNC/device paths (`\\server\share\...`, `//server/share/...`), and colons (`:`).
- Rejects any `..` path traversal segment.
- Canonicalizes `pluginRoot` via `fs.realpathSync` and verifies real-filesystem containment for both existing paths and non-existent target paths (including broken symlinks and Windows NTFS directory junctions), comparing case-insensitively on `win32` with strict directory separator boundaries.
- Normalizes all accepted relative paths to POSIX `/` separators (`relativePosixPath`).

### 3.2 Deterministic Bundle Digest (`computePluginDigest`)

`loadPlugin` computes a deterministic `sha256:<64-hex>` digest over `plugin.json`, optional `logo`, and every resolved capability asset (including skill `references`, skill `scripts`, `toolConfigPaths`, and `policyPaths`):

1. Validates each path via `resolveSafePluginPath(pluginRoot, path, { mustExist: true })` and ensures it is a regular file.
2. Deduplicates normalized POSIX paths and sorts them lexicographically.
3. Streams `<relativePosixPath>\0<byteLength>\0<fileBytes>` into SHA-256.

### 3.3 Non-Execution During Discovery and Loading

- `discoverPlugins(searchDirs)` inspects immediate subdirectories of existing directories in `searchDirs` for a valid regular `plugin.json` file inside the canonical directory, deduplicates canonical targets, and returns entries sorted by `dir`.
- `loadPlugin(pluginRoot, options)` validates `plugin.json`, checks optional `options.coreVersion` compatibility, parses all skills, agents, rules, and hooks, verifies tool/policy/logo regular files, detects duplicate internal skill names, agent names, rule IDs, and hook IDs, and computes the bundle digest.
- **No script, binary, or hook command is ever executed** during discovery, validation, or loading. Every parsed skill script entry explicitly records `requiresPolicyApproval: true`.

### 3.4 Dependency Resolution (`validatePluginDependencies`)

`validatePluginDependencies(plugins)` validates inter-plugin constraints without executing plugin code:

- Rejects duplicate plugin IDs (`DUPLICATE_PLUGIN_ID`).
- Rejects missing referenced dependencies (`MISSING_DEPENDENCY`).
- Validates target plugin versions against declared `versionRange` via `semver.satisfies` (`INCOMPATIBLE_DEPENDENCY_VERSION`).
- Detects dependency cycles (`CIRCULAR_DEPENDENCY`).
- Returns plugins sorted topologically (dependencies before dependents).

## 4. Artifact Contracts & Parsers

All Markdown artifacts (`skills`, `agents`, `rules`) are parsed by `parseMarkdownFrontmatter`, which strips an optional UTF-8 BOM (`\uFEFF`), normalizes CRLF (`\r\n`) to LF (`\n`), requires `---` delimiters starting on line 1, parses YAML with `yaml` (`schema: 'core'`, `strict: true`, `stringKeys: true`, `uniqueKeys: true`, `maxAliasCount: 25`), and requires a plain key-value object plus a non-empty Markdown body.

### 4.1 Skills (`SKILL.md` via `parseSkillFile`)

Manifest skill entries may point to a skill directory (resolving `<dir>/SKILL.md`), an explicit `SKILL.md` path, or `.` (root `SKILL.md`).

| Frontmatter Field    | Required | Type       | Notes                                                                |
| -------------------- | -------- | ---------- | -------------------------------------------------------------------- |
| `name`               | Yes      | `string`   | Unique within the plugin bundle; non-empty                           |
| `description`        | Yes      | `string`   | Non-empty summary                                                    |
| `purpose`            | Yes      | `string`   | Non-empty                                                            |
| `activation`         | Yes      | `string`   | When/how the skill activates                                         |
| `inputs`             | Yes      | `string[]` | Array of non-empty strings                                           |
| `outputs`            | Yes      | `string[]` | Array of non-empty strings                                           |
| `constraints`        | Yes      | `string[]` | Array of non-empty strings                                           |
| `completionCriteria` | Yes      | `string[]` | Array of non-empty strings                                           |
| `references`         | No       | `string[]` | Existing regular files resolved relative to skill dir                |
| `scripts`            | No       | `string[]` | Existing regular files; returned with `requiresPolicyApproval: true` |
| `version`            | No       | `string`   | Non-empty optional skill version                                     |

Unknown frontmatter keys fail with `SKILL_ADDITIONAL_PROPERTY`. Asset paths in `references` and `scripts` must stay contained within `pluginRoot` and cannot contain nested `..` segments after non-parent segments.

### 4.2 Agents (`agents/<name>.md` via `parseAgentFile`)

| Frontmatter Field       | Required | Type                                  | Notes                           |
| ----------------------- | -------- | ------------------------------------- | ------------------------------- |
| `name`                  | Yes      | `string`                              | Unique within the plugin bundle |
| `role`                  | Yes      | `string`                              | Non-empty role title            |
| `description`           | Yes      | `string`                              | Non-empty                       |
| `responsibilities`      | Yes      | `string[]`                            | Array of non-empty strings      |
| `nonResponsibilities`   | Yes      | `string[]`                            | Explicit boundaries             |
| `skills`                | Yes      | `string[]`                            | Skill names                     |
| `tools`                 | Yes      | `string[]`                            | Declared tool names             |
| `permissionProfile`     | Yes      | `string`                              | Non-empty profile identifier    |
| `modelTier`             | Yes      | `'fast' \| 'balanced' \| 'reasoning'` | Provider-neutral tier           |
| `inputContract`         | Yes      | `string`                              | Non-empty                       |
| `outputContract`        | Yes      | `string`                              | Non-empty                       |
| `handoffConditions`     | Yes      | `string[]`                            | Array of non-empty strings      |
| `maxRetries`            | Yes      | `integer`                             | `0` to `20` inclusive           |
| `requiresHumanApproval` | Yes      | `boolean`                             | Required boolean                |

Unknown frontmatter keys fail with `AGENT_ADDITIONAL_PROPERTY`.

### 4.3 Guidance Rules (`rules/*.md` via `parseRuleFile`)

| Frontmatter Field | Required | Type                                                    | Notes                           |
| ----------------- | -------- | ------------------------------------------------------- | ------------------------------- |
| `id`              | Yes      | `string`                                                | Unique within the plugin bundle |
| `category`        | Yes      | `'routing' \| 'security' \| 'development' \| 'writing'` | Guidance category               |
| `scope`           | Yes      | `string`                                                | Non-empty applicability scope   |
| `priority`        | Yes      | `integer`                                               | Integer ordering weight         |

Unknown frontmatter keys fail with `RULE_ADDITIONAL_PROPERTY`. Notably, an `enforcement` key is explicitly rejected because Markdown rules are prompt guidance only—deterministic enforcement belongs in structured JSON policy files and built-in security rules.

### 4.4 Declarative Hooks (`hooks/hooks.json` via `parseHooksFile`)

Top-level JSON must be `{ "hooks": HookBinding[] }` (no extra top-level keys).

| Field           | Required | Type                                                                          | Notes                                 |
| --------------- | -------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| `id`            | Yes      | `string`                                                                      | Unique across the plugin's hook files |
| `event`         | Yes      | `'SessionStart' \| 'PreToolUse' \| 'PostToolUse' \| 'Stop'`                   | Lifecycle event                       |
| `handler`       | Yes      | `'session-context' \| 'policy-guard' \| 'stale-tracker' \| 'gate-stop-guard'` | Built-in DonAron handler only         |
| `matcher`       | No       | `string`                                                                      | Non-empty tool/event matcher          |
| `timeoutSec`    | Yes      | `integer`                                                                     | `1` to `120` inclusive                |
| `failurePolicy` | Yes      | `'fail_closed' \| 'warn'`                                                     | Failure handling mode                 |
| `enabled`       | No       | `boolean`                                                                     | Defaults to `true` when omitted       |

Arbitrary shell `command` properties, unknown keys, and unknown handler names are strictly rejected (`HOOK_ADDITIONAL_PROPERTY`, `HOOK_INVALID_ENUM`).

## 5. Deterministic Fail-Closed Policy Engine

`evaluatePolicy(request, extraRules?)` evaluates `DEFAULT_SECURITY_POLICIES` combined with any optional `extraRules` (such as rules parsed via `parsePolicyFile`):

- **Precedence:** `DENY > REQUIRE_APPROVAL > ALLOW`. Within the same effect, higher `priority` wins; ties break deterministically by lexicographically smaller rule `id`.
- **Fail-Closed Guarantees (`{ effect: 'DENY', failedClosed: true }`):**
  - Any malformed regex in `pathPatterns` or `commandPatterns`.
  - `fs:write` or `fs:delete` with a missing or invalid `workspaceRoot`.
  - Invalid runtime `action` or `actorType`, or any unexpected evaluation exception.
- **Workspace Containment:** `fs:write` and `fs:delete` enforce lexical and real-disk symlink/junction containment inside `workspaceRoot`, rejecting `..` escapes, drive mismatches, UNC/device namespace paths, and escaping symlinks.
- **Built-in Choice 1A & Choice 2A Defaults (`DEFAULT_SECURITY_POLICIES`):**
  - `builtin-protect-donaron-state` (`critical: true`, priority `1000`): blocks `agent` `fs:write`/`fs:delete` under `.donaron/runs/**` and `.donaron/evidence/**`.
  - `builtin-block-agent-override-cmd` (`critical: true`, priority `1000`): blocks `agent` `cmd:exec` matching `donaron(.cmd|.exe)? gate override`.
  - `builtin-block-agent-override-action` (`critical: true`, priority `1000`): blocks `agent` `workflow:override`.
  - `builtin-human-override-approval` (priority `900`): requires interactive approval (`REQUIRE_APPROVAL`) for `human` `workflow:override`.
  - `builtin-block-destructive-commands` (`critical: true`, priority `950`): blocks `rm -rf /|~|*`, `Remove-Item -Recurse -Force <drive>:\`, `git push --force`/`-f`/`--force-with-lease`, `git reset --hard`, `DROP TABLE|DATABASE|SCHEMA`, `TRUNCATE TABLE`, and pipe-to-shell downloads (`curl|wget|iwr|Invoke-WebRequest ... | sh|bash|pwsh|powershell|iex`).
  - `builtin-block-secret-files` (priority `900`): denies reading/writing/deleting `.env*` (except `.env.example`), `*.pem`, `*.key`, `id_rsa`, and `id_ed25519` unless explicitly listed in `request.allowlistedPaths` (allowlists never bypass `critical: true` rules).
  - `builtin-block-env-read` (priority `850`): denies `agent` `env:read`.
  - `builtin-approval-external-release` (priority `800`): requires approval for `git push`, `npm publish`, and `pnpm publish`.

## 6. Secret-Redacting Structured Logger

`createLogger(options?)` wraps `pino` and runs `redactObject(context)` and `redactSecrets(message)` **before** delegating to Pino:

- **`redactSecrets(input)`:** Scrubs AWS access keys (`AKIA...`), GitHub PATs (`gh[pousr]_...`, `github_pat_...`), OpenAI/Anthropic keys (`sk-...`, `sk-ant-...`), Google API keys (`AIza...`), Bearer tokens, JWTs (`eyJ...`), PEM private key blocks, and URL passwords (`scheme://user:secret@host` → `scheme://user:[REDACTED]@host`).
- **`redactObject(value)`:** Recursively clones objects, arrays, `Map`, `Set`, and `Error` instances (preserving `Error` instances while scrubbing `message`, `name`, `stack`, `cause`, `errors`, and custom properties), replaces values of keys matching `/(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i` with `'[REDACTED]'`, applies `redactSecrets` to all string values, and replaces circular references with `'[Circular]'`.
- **Trust Boundary Disclosure:** Node.js is not an OS/container sandbox. `@donaron/core` enforces containment and policy checks at the validation and evaluator boundary; live hook interception and gate enforcement arrive in Phases 3–5.
