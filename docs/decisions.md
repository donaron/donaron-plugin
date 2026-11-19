# Architecture Decision Log

Validated Phase 1 architectural and toolchain decisions for DonAron-plugin.

## ADR-001: Focused 5-Module Monorepo (Approach 1)

- **Decision:** Structure the repository around 5 workspace modules (`packages/core`, `packages/gates`, `packages/adapters`, `apps/cli`, `plugins/donaron-dev`) instead of 14 fine-grained engine packages.
- **Rationale:** Retains every capability in the specification (schema, policy, hooks, 5 gates, state machine, dual adapters, CLI) while minimizing cross-package boilerplate and delivering working harness integration in 7 green-gated phases.

## ADR-002: Pure ESM + TypeScript Project References (`tsc --build`)

- **Decision:** Enforce `"type": "module"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, and `composite: true` project references on Node.js `>=24.0.0`.
- **Rationale:** Zero-magic builds, accurate `.d.ts` emission across workspace boundaries, and native Node 24 ESM compatibility on Windows.

## ADR-003: pnpm Workspaces & Minimal Dependencies

- **Decision:** Pin `pnpm@10.34.9` as workspace manager and add dependencies only in the phase that consumes them (Phase 1 installs only TypeScript, Vitest + v8 coverage, ESLint 9, Prettier, and `@types/node`; Ajv, Pino, and Commander arrive in Phases 2 and 5).
- **Rationale:** Deterministic lockfile resolution and strict adherence to zero speculative dependencies.

## ADR-004: Vitest + `@vitest/coverage-v8` with 70% Thresholds & `json-summary`

- **Decision:** Configure Vitest with `@vitest/coverage-v8`, `text` + `json-summary` reporters, and `70%` minimum thresholds across `lines`, `statements`, `functions`, and `branches`.
- **Rationale:** Directly satisfies Gate 04's machine-readable `coverage/coverage-summary.json` contract from Day 1.

## ADR-005: ESLint 9 Flat Config + Prettier with LF Line Endings

- **Decision:** Use ESLint 9 flat config (`@eslint/js` + `typescript-eslint` strict/stylistic) and Prettier 3 with `"endOfLine": "lf"`, paired with `.gitattributes` (`* text=auto eol=lf`) and `.prettierignore` (excluding `pnpm-lock.yaml`, `dist/`, `coverage/`, `.donaron/`).
- **Rationale:** Prevents Windows CRLF/LF drift and enforces consistent formatting and type-import hygiene across all packages.

## ADR-006: `strict` Default Workflow with Zero-Token Mechanical Enforcement

- **Decision:** Default workflows to `strict` mode (Gates 01–05, independent reviews, ≥70% coverage) while running all mechanical checks as zero-token local Node scripts; retain `--tier standard` and `--tier quick` only as explicit human CLI flags.
- **Rationale:** Delivers full evidence-based rigor requested by the user while eliminating unnecessary LLM token expenditure on deterministic checks.

## ADR-007: Dual-Harness v1 Scope (Antigravity + Claude Code)

- **Decision:** Target **Antigravity** and **Claude Code** first with honest capability reporting (`NATIVE` / `EMULATED` / `PARTIAL` / `UNSUPPORTED` / `UNVERIFIED`); defer Codex, Cursor, and GitHub Copilot to v2 with zero placeholder stubs.
- **Rationale:** Focuses v1 on the harnesses actually used daily and upholds Architectural Principle #10 (no false compatibility claims).

## ADR-008: Scoped Content Hashing (`planHash` + `codeHash`)

- **Decision:** Bind Gate 01 to `planHash` (planning artifacts) and Gates 02–05 to `codeHash` (git HEAD + source/test tree excluding `.donaron/` and build outputs).
- **Rationale:** Prevents code implementation from invalidating Gate 01 while ensuring any code or test modification invalidates Gates 02–05 until re-verified.

## ADR-009: Hook + Interactive TTY Trust Boundary & Global Safety Guards

- **Decision:** Protect `.donaron/**` and `donaron gate override` via `PreToolUse` hooks + `process.stdin.isTTY` confirmation (Choice 1A). In repos without an active `.donaron` workflow, keep `PreToolUse` global security guards active while keeping `Stop` non-blocking (Choice 2A).
- **Rationale:** Balances strong prompt/agent bypass protection with zero key-management friction and non-intrusive behavior in unrelated repos.
