# DonAron-plugin Phase 1 — Foundation & Monorepo Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the verified, green-tested TypeScript ESM pnpm monorepo foundation for DonAron-plugin (5-module layout, strict build/lint/format/test/coverage tooling, architecture doc, and decision log) with zero Phase 2+ premature domain logic.

**Architecture:** Five workspace modules under `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin` with a strict acyclic dependency DAG: `@donaron/core` (zero internal deps) ← `@donaron/gates` ← `@donaron/adapters` ← `@donaron/cli`, plus the `plugins/donaron-dev` source bundle directory. TypeScript project references (`tsc --build`) compile pure ESM `.js` + `.d.ts` outputs, while Vitest + `@vitest/coverage-v8` enforces ≥70% coverage across lines, statements, functions, and branches.

**Tech Stack:** Node.js `>=24.0.0` (observed `v24.18.0`), pnpm `10.x` workspaces, TypeScript `5.8.x` (strict ESM / `NodeNext`), Vitest `3.x` + `@vitest/coverage-v8`, ESLint `9.x` (flat config + `typescript-eslint`), Prettier `3.x`.

**Spec:** [donaron-plugin-design.md](file:///C:/Users/USER/.gemini/antigravity/brain/f191838d-7465-414a-88b3-ba048c56604e/donaron-plugin-design.md) and [DONARON-PLUGIN-SPEC.md](file:///c:/Users/USER/Downloads/DONARON-PLUGIN-SPEC.md)

## Global Constraints

- Repository root: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`
- Runtime floor: Node.js `>=24.0.0`; pure ESM (`"type": "module"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`) across all packages
- Exactly 5 workspace modules: `packages/core`, `packages/gates`, `packages/adapters`, `apps/cli`, `plugins/donaron-dev`
- Core independence: `@donaron/core` must have zero dependencies on any other workspace package or harness SDK
- No unnecessary dependencies: install only pinned Phase 1 build/lint/format/test devDependencies (defer `ajv`, `pino`, `commander` to the phases that consume them)
- Windows-safe scripts and paths only: use `node -e` / `node:fs` / `node:path` in `package.json` scripts (never Bash-only commands like `rm -rf`)
- Coverage baseline: Vitest `@vitest/coverage-v8` configured with `json-summary` + `text` reporters and minimum `70%` thresholds for `lines`, `statements`, `functions`, and `branches`
- Documentation honesty: `README.md` and `docs/` must clearly distinguish Phase 1 implemented foundation from planned Phases 2–7
- Windows pnpm execution rule: run `npm install -g pnpm` and `pnpm install` with `BypassSandbox: true`; run `pnpm run`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm exec` inside the sandbox
- Phase 1 green bar: `pnpm clean && pnpm build && pnpm lint && pnpm format:check && pnpm test:coverage` all pass before presenting Phase 1 for user approval

## Review Focus

1. **Windows cross-workspace ESM resolution (`ERR_MODULE_NOT_FOUND`):** Missing `"exports"` maps, `"type": "module"`, or `.js` relative import extensions can pass `tsc` but crash at Node 24 runtime — pinned by Task 3's compiled CLI smoke test executing `node apps/cli/dist/cli.js --version` across all built workspace packages.
2. **Vitest `coverage-summary.json` availability for Gate 04:** Gate 04 (Phase 3) parses `coverage/coverage-summary.json` and enforces ≥70% across all four metrics — pinned by Task 4's coverage verification check asserting the JSON summary file exists and every metric is ≥70%.
3. **TypeScript project reference clean rebuilds:** Missing `composite: true`, `declaration: true`, or wrong `references` order breaks clean builds — pinned by Task 4's clean-build test verifying `.js` and `.d.ts` artifacts after `pnpm clean && pnpm build`.
4. **Windows CRLF line-ending drift:** Git on Windows can check out/stage CRLF and break Prettier — pinned by `.gitattributes` (`eol=lf`) + `.prettierrc.json` (`"endOfLine": "lf"`) and verified by `pnpm format:check` in Tasks 1 and 4.
5. **Sensitive runtime state leaking into Git:** `.donaron/` runs, `.env*` secrets, `coverage/`, and `dist/` must never be tracked — pinned by Task 1's `tests/foundation/repo-hygiene.test.ts`.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── .gitattributes
├── .gitignore
├── .prettierrc.json
├── eslint.config.js
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── docs/
│   ├── architecture.md
│   ├── decisions.md
│   └── superpowers/
│       ├── specs/2026-11-19-donaron-plugin-design.md
│       └── plans/2026-11-19-phase-1-foundation.md
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{index.ts,index.test.ts}
│   ├── gates/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/{index.ts,index.test.ts}
│   └── adapters/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/{index.ts,index.test.ts}
├── apps/
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/{index.ts,cli.ts,index.test.ts}
├── plugins/
│   └── donaron-dev/
│       ├── package.json
│       └── README.md
└── tests/
    └── foundation/
        ├── repo-hygiene.test.ts
        └── build-and-coverage.test.ts
```

---

### Task 1: Repository Initialization, Toolchain Setup & Repo-Hygiene Verification

**Files:**

- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\.gitignore`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\.gitattributes`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\pnpm-workspace.yaml`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\package.json`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\tsconfig.base.json`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\tsconfig.json`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\eslint.config.js`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\.prettierrc.json`
- Create: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\vitest.config.ts`
- Test: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\tests\foundation\repo-hygiene.test.ts`

**Interfaces:**

- Consumes: Node `v24.18.0`, npm `11.16.0`, Git `2.55.0`
- Produces: Working `pnpm` workspace root with root scripts (`build`, `clean`, `lint`, `format`, `format:check`, `test`, `test:coverage`, `check`), strict `tsconfig.base.json`, ESLint flat config, Prettier LF config, Vitest v8 coverage config (70% thresholds + `json-summary`).

- [ ] **Step 1: Ensure `pnpm` is installed on Windows**

Run (outside sandbox, `BypassSandbox: true`): `npm install -g pnpm@10`
Then verify in sandbox: `pnpm -v`
Expected: prints `10.x.x`.

- [ ] **Step 2: Initialize repository directory and git**

Create `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin` and run `git init` inside it (with `main` default branch via `git init -b main`).
Expected: `.git` initialized cleanly on branch `main`.

- [ ] **Step 3: Write root configuration files & workspace manifests**

Create the root files with exact spec values:

- `.gitignore`: ignores `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.donaron/`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `Thumbs.db`.
- `.gitattributes`: `* text=auto eol=lf`
- `pnpm-workspace.yaml`: declares `packages:` list `["packages/*", "apps/*", "plugins/*"]`.
- `package.json`: `"name": "donaron-plugin-monorepo"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=24.0.0" }`, `"packageManager": "pnpm@<exact installed version>"`, scripts:
  - `"clean"`: Node one-liner removing `dist`, `coverage`, and `*.tsbuildinfo` across workspace roots (Windows-safe)
  - `"build"`: `"tsc --build"`
  - `"lint"`: `"eslint ."`
  - `"format"`: `"prettier --write ."`
  - `"format:check"`: `"prettier --check ."`
  - `"test"`: `"vitest run"`
  - `"test:coverage"`: `"vitest run --coverage"`
  - `"check"`: `"pnpm build && pnpm lint && pnpm format:check && pnpm test:coverage"`
    Pinned `devDependencies`: `typescript`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `@types/node`.
- `tsconfig.base.json`: `target: "ES2024"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `isolatedModules: true`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, `composite: true`, `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`.
- `tsconfig.json`: solution file with `"files": []`, `"references": []` (references populated as packages are added in Tasks 2–3).
- `eslint.config.js`: ESLint 9 flat config using `@eslint/js` recommended + `typescript-eslint` strictTypeChecked/recommended rules, ignoring `dist/`, `coverage/`, `node_modules/`, `eslint.config.js`, `vitest.config.ts`.
- `.prettierrc.json`: `{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "endOfLine": "lf" }`.
- `vitest.config.ts`: configures `include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"]`, `coverage.provider: "v8"`, `coverage.reporter: ["text", "json-summary"]`, `coverage.reportsDirectory: "coverage"`, `coverage.include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"]`, `coverage.exclude: ["**/*.test.ts", "**/dist/**"]`, `coverage.thresholds: { lines: 70, statements: 70, functions: 70, branches: 70 }`.

- [ ] **Step 4: Install root workspace dependencies**

Run (outside sandbox, `BypassSandbox: true`): `pnpm install` in `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.
Expected: `pnpm-lock.yaml` generated cleanly with zero peer dependency errors.

- [ ] **Step 5: Write failing repo-hygiene test first (validating workspace config & `.gitignore`)**

Create `tests/foundation/repo-hygiene.test.ts` with tests:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('Phase 1 repository hygiene', () => {
  it('ignores runtime state, secrets, build, and coverage outputs', () => {
    const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf8');
    for (const pattern of ['.donaron/', '.env', '.env.*', 'dist/', 'coverage/', 'node_modules/']) {
      expect(gitignore).toContain(pattern);
    }
  });

  it('enforces ESM and Node >=24.0.0 in root package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      type?: string;
      engines?: { node?: string };
    };
    expect(pkg.type).toBe('module');
    expect(pkg.engines?.node).toBe('>=24.0.0');
  });

  it('declares all three workspace globs in pnpm-workspace.yaml', () => {
    const workspace = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('packages/*');
    expect(workspace).toContain('apps/*');
    expect(workspace).toContain('plugins/*');
  });

  it('enforces LF line endings in .gitattributes and .prettierrc.json', () => {
    const gitattributes = readFileSync(resolve(ROOT, '.gitattributes'), 'utf8');
    const prettier = JSON.parse(readFileSync(resolve(ROOT, '.prettierrc.json'), 'utf8')) as {
      endOfLine?: string;
    };
    expect(gitattributes).toContain('eol=lf');
    expect(prettier.endOfLine).toBe('lf');
  });
});
```

- [ ] **Step 6: Run tests, lint, and format check**

Run (sandbox): `pnpm test && pnpm lint && pnpm format:check`
Expected: `repo-hygiene.test.ts` passes (4/4 tests), ESLint exits 0, Prettier exits 0.

- [ ] **Step 7: Commit Task 1**

Run: `git add -A && git commit -m "chore: initialize pnpm monorepo foundation and toolchain"`
Expected: clean git status.

---

### Task 2: Core Workspace Packages (`@donaron/core`, `@donaron/gates`, `@donaron/adapters`) & Project References

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Create: `packages/gates/package.json`, `packages/gates/tsconfig.json`, `packages/gates/src/index.ts`, `packages/gates/src/index.test.ts`
- Create: `packages/adapters/package.json`, `packages/adapters/tsconfig.json`, `packages/adapters/src/index.ts`, `packages/adapters/src/index.test.ts`
- Modify: `tsconfig.json` (add project references for `packages/core`, `packages/gates`, `packages/adapters`)

**Interfaces:**

- Produces (`@donaron/core`):
  ```ts
  export interface ModuleInfo {
    readonly name: string;
    readonly version: string;
    readonly dependencies: readonly string[];
  }
  export const DONARON_CORE_VERSION = '0.1.0';
  export function getCoreModuleInfo(): ModuleInfo;
  ```
- Produces (`@donaron/gates`, consumes `@donaron/core`):
  ```ts
  export const DONARON_GATES_VERSION = '0.1.0';
  export function getGatesModuleInfo(): ModuleInfo;
  ```
- Produces (`@donaron/adapters`, consumes `@donaron/core`, `@donaron/gates`):

  ```ts
  export const DONARON_ADAPTERS_VERSION = '0.1.0';
  export function getAdaptersModuleInfo(): ModuleInfo;
  ```

- [ ] **Step 1: Scaffold package manifests & `tsconfig.json` files for all three packages**

Create `package.json` (with `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, `"files": ["dist"]`, `"version": "0.1.0"`) and `tsconfig.json` (extending `../../tsconfig.base.json`, `rootDir: "src"`, `outDir: "dist"`):

- `packages/core`: zero workspace dependencies.
- `packages/gates`: `"dependencies": { "@donaron/core": "workspace:*" }`, `tsconfig.json` `references: [{ "path": "../core" }]`.
- `packages/adapters`: `"dependencies": { "@donaron/core": "workspace:*", "@donaron/gates": "workspace:*" }`, `tsconfig.json` `references: [{ "path": "../core" }, { "path": "../gates" }]`.
- Update root `tsconfig.json` references to include all three packages.
- Run (outside sandbox, `BypassSandbox: true`): `pnpm install` to link workspace packages.

- [ ] **Step 2: Write failing unit tests for `@donaron/core`, `@donaron/gates`, and `@donaron/adapters`**

Create:

- `packages/core/src/index.test.ts`: asserts `getCoreModuleInfo()` returns `{ name: '@donaron/core', version: DONARON_CORE_VERSION, dependencies: [] }`.
- `packages/gates/src/index.test.ts`: asserts `getGatesModuleInfo()` returns `{ name: '@donaron/gates', version: DONARON_GATES_VERSION, dependencies: ['@donaron/core@0.1.0'] }`.
- `packages/adapters/src/index.test.ts`: asserts `getAdaptersModuleInfo()` returns `{ name: '@donaron/adapters', version: DONARON_ADAPTERS_VERSION, dependencies: ['@donaron/core@0.1.0', '@donaron/gates@0.1.0'] }`.

- [ ] **Step 3: Run tests to verify they fail**

Run (sandbox): `pnpm test`
Expected: FAIL because `src/index.ts` files do not exist yet.

- [ ] **Step 4: Implement minimal typed entrypoints in each package**

Implement:

- `packages/core/src/index.ts`: exports `ModuleInfo`, `DONARON_CORE_VERSION`, `getCoreModuleInfo()`.
- `packages/gates/src/index.ts`: imports `getCoreModuleInfo` & `type ModuleInfo` from `@donaron/core`, exports `DONARON_GATES_VERSION`, `getGatesModuleInfo()`.
- `packages/adapters/src/index.ts`: imports `getCoreModuleInfo` from `@donaron/core` and `getGatesModuleInfo` from `@donaron/gates`, exports `DONARON_ADAPTERS_VERSION`, `getAdaptersModuleInfo()`.

- [ ] **Step 5: Build and run full checks to verify pass**

Run (sandbox): `pnpm build && pnpm lint && pnpm format:check && pnpm test:coverage`
Expected: `tsc --build` emits `.js` + `.d.ts` into all three `dist/` folders; all tests pass; coverage ≥70% across lines, statements, functions, and branches.

- [ ] **Step 6: Commit Task 2**

Run: `git add -A && git commit -m "feat: scaffold core, gates, and adapters workspace packages"`
Expected: clean git status.

---

### Task 3: CLI Workspace (`@donaron/cli`) & Flagship Plugin Skeleton (`plugins/donaron-dev`)

**Files:**

- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/index.ts`, `apps/cli/src/cli.ts`, `apps/cli/src/index.test.ts`
- Create: `plugins/donaron-dev/package.json`, `plugins/donaron-dev/README.md`
- Modify: `tsconfig.json` (add `apps/cli` reference)

**Interfaces:**

- Consumes: `getCoreModuleInfo`, `getGatesModuleInfo`, `getAdaptersModuleInfo`, `type ModuleInfo` from `@donaron/core`, `@donaron/gates`, `@donaron/adapters`
- Produces (`@donaron/cli`):
  ```ts
  export const DONARON_CLI_VERSION = '0.1.0';
  export interface CliInfo {
    readonly name: string;
    readonly version: string;
    readonly modules: readonly ModuleInfo[];
  }
  export function getCliInfo(): CliInfo;
  export function runCli(argv: readonly string[]): {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  ```
- CLI entrypoint (`apps/cli/src/cli.ts` → `apps/cli/dist/cli.js`): accepts `--version` / `-v` (prints `donaron 0.1.0`, exits 0) and `--help` / `-h` (prints Phase 1 baseline usage, exits 0); unknown args print error to stderr and exit 1.

- [ ] **Step 1: Scaffold `apps/cli` and `plugins/donaron-dev` workspace manifests**

Create:

- `apps/cli/package.json`: `"name": "@donaron/cli"`, `"version": "0.1.0"`, `"type": "module"`, `"bin": { "donaron": "./dist/cli.js" }`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, workspace dependencies on `@donaron/core`, `@donaron/gates`, `@donaron/adapters`.
- `apps/cli/tsconfig.json`: extends `../../tsconfig.base.json`, references `../../packages/core`, `../../packages/gates`, `../../packages/adapters`.
- `plugins/donaron-dev/package.json`: `"name": "@donaron/plugin-donaron-dev"`, `"version": "0.1.0"`, `"private": true`, `"description": "Personal Node + React DonAron plugin source bundle (populated in Phase 6)."`.
- `plugins/donaron-dev/README.md`: explicitly documents that this directory holds the flagship personal Node + React plugin to be authored in Phase 6 once the v1 schema (Phase 2) and adapters (Phase 4) are verified.
- Update root `tsconfig.json` to reference `apps/cli`.
- Run (outside sandbox, `BypassSandbox: true`): `pnpm install`.

- [ ] **Step 2: Write failing tests for `apps/cli` (including compiled ESM runtime smoke test)**

Create `apps/cli/src/index.test.ts`:

- Unit test: `getCliInfo()` returns `{ name: '@donaron/cli', version: '0.1.0', modules: [core, gates, adapters] }` with all 3 modules resolved.
- Unit tests for `runCli(['--version'])` → `{ exitCode: 0, stdout: 'donaron 0.1.0\n', stderr: '' }`, `runCli(['--help'])` → `{ exitCode: 0 }` with `donaron` in `stdout`, and `runCli(['--unknown'])` → `{ exitCode: 1 }` with non-empty `stderr`.
- Built-ESM runtime smoke test (Review Focus #1): spawns `process.execPath` (`node`) against `apps/cli/dist/cli.js --version` after build (or asserts `dist/cli.js` executes cleanly when built) to prove Windows ESM resolution works end-to-end without `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Run tests to verify they fail**

Run (sandbox): `pnpm test`
Expected: FAIL because `apps/cli/src/index.ts` and `apps/cli/src/cli.ts` do not exist.

- [ ] **Step 4: Implement `apps/cli/src/index.ts` and `apps/cli/src/cli.ts`**

- `apps/cli/src/index.ts`: exports `DONARON_CLI_VERSION`, `CliInfo`, `getCliInfo()`, and `runCli(argv)` (imports from `@donaron/core`, `@donaron/gates`, `@donaron/adapters`).
- `apps/cli/src/cli.ts`: `#!/usr/bin/env node` importing `{ runCli }` from `'./index.js'` (explicit `.js` extension for NodeNext ESM!), writing `stdout`/`stderr` and setting `process.exitCode`.

- [ ] **Step 5: Build and run tests + lint + format check**

Run (sandbox): `pnpm build && pnpm lint && pnpm format:check && pnpm test:coverage`
Expected: All unit tests and the compiled Node 24 ESM CLI smoke test pass; coverage ≥70% across all four metrics.

- [ ] **Step 6: Commit Task 3**

Run: `git add -A && git commit -m "feat: scaffold cli workspace and donaron-dev plugin skeleton"`
Expected: clean git status.

---

### Task 4: Architecture Docs, Decision Log, Committed Design Spec & Full Green Verification

**Files:**

- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/decisions.md`
- Create: `docs/superpowers/specs/2026-11-19-donaron-plugin-design.md` (copied from approved design artifact)
- Create: `docs/superpowers/plans/2026-11-19-phase-1-foundation.md` (copied from this plan)
- Test: `tests/foundation/build-and-coverage.test.ts`

**Interfaces:**

- Consumes: Built `dist/` artifacts and `coverage/coverage-summary.json` generated by `pnpm build` and `pnpm test:coverage`
- Produces: Complete Phase 1 approval deliverables (repository skeleton, architecture doc, decision log, green baseline verification suite)

- [ ] **Step 1: Write failing build-and-coverage verification test (Review Focus #2 & #3)**

Create `tests/foundation/build-and-coverage.test.ts` verifying:

- Every TypeScript workspace (`packages/core`, `packages/gates`, `packages/adapters`, `apps/cli`) has `dist/index.js` and `dist/index.d.ts` (and `apps/cli/dist/cli.js`), plus zero `@donaron/*` dependencies inside `packages/core/package.json` (enforcing Architectural Principle #1: Core Independence).
- Required Phase 1 docs exist (`README.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/superpowers/specs/2026-11-19-donaron-plugin-design.md`).

- [ ] **Step 2: Run test to verify it fails on missing docs**

Run (sandbox): `pnpm test tests/foundation/build-and-coverage.test.ts`
Expected: FAIL because `README.md`, `docs/architecture.md`, `docs/decisions.md`, and committed spec do not exist yet.

- [ ] **Step 3: Author `README.md`, `docs/architecture.md`, `docs/decisions.md`, and copy approved spec & plan**

- `README.md`: concise overview of DonAron-plugin, current implementation status table (**Phase 1 Implemented** vs. **Phases 2–7 Planned** — zero false claims), local commands (`pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:coverage`, `pnpm check`), and workspace layout.
- `docs/architecture.md`: 5-module dependency DAG, module responsibilities, dual-harness target summary (Antigravity + Claude Code), scoped hashing (`planHash` + `codeHash`), and fail-closed security boundaries.
- `docs/decisions.md`: numbered Architecture Decision Log (ADR-001 through ADR-009) pinning every Phase 1 technical choice (Approach 1 five-module monorepo, pure ESM + `tsc --build`, Vitest + v8 ≥70% across all 4 metrics, ESLint 9 flat config + Prettier LF, strict default workflow with zero-token mechanical checks, Choice 1A hook+TTY trust boundary, Choice 2A global security guards / workflow-only Stop hook, scoped `planHash`/`codeHash`, Antigravity + Claude Code v1 target scope).
- Copy approved design doc into `docs/superpowers/specs/2026-11-19-donaron-plugin-design.md` and this plan into `docs/superpowers/plans/2026-11-19-phase-1-foundation.md`.

- [ ] **Step 4: Run complete Phase 1 clean green-bar check**

Run (sandbox): `pnpm clean && pnpm build && pnpm lint && pnpm format:check && pnpm test:coverage`
And verify `coverage/coverage-summary.json` exists and reports `>= 70` for `lines`, `statements`, `functions`, and `branches`:
Run (sandbox): `node -e "const s = JSON.parse(require('node:fs').readFileSync('coverage/coverage-summary.json','utf8')).total; console.log(s); for (const k of ['lines','statements','functions','branches']) { if (s[k].pct < 70) process.exit(1); }"`
Expected: Every command exits `0`; all tests pass; coverage JSON summary ≥70% across all 4 metrics.

- [ ] **Step 5: Commit Task 4 and verify clean git log**

Run: `git add -A && git commit -m "docs: add Phase 1 architecture, decision log, spec, and verification tests"`
Run: `git status` and `git log --oneline`
Expected: clean working tree with 4 focused Phase 1 commits.
