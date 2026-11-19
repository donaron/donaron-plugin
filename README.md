# DonAron-plugin

Personal multi-harness AI development workflow and fail-closed gate enforcement system for **Antigravity** and **Claude Code**, targeting **Node.js + React** codebases.

## Implementation Status

Documentation explicitly separates implemented behavior from planned phases:

| Phase       | Scope                                                                                                                                     | Status          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Phase 1** | pnpm TypeScript ESM monorepo foundation, 5-module boundaries, build/lint/format/test/coverage toolchain, architecture & decision log      | **Implemented** |
| **Phase 2** | Universal manifest v1 schema (Ajv), path-safe loaders, deterministic fail-closed policy engine, secret-redacting logger (`@donaron/core`) | **Implemented** |
| **Phase 3** | Scoped `planHash`/`codeHash` Evidence Store, Gates 01–05, `strict` default workflow state machine (`@donaron/gates`)                      | **Implemented** |
| **Phase 4** | Harness adapter contract + Antigravity and Claude Code exporters & hook payload translators (`@donaron/adapters`)                         | **Implemented** |
| **Phase 5** | Full `donaron` CLI (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`, `hook`) (`@donaron/cli`)                                 | **Implemented** |
| **Phase 6** | Flagship Node + React plugin bundle (`plugins/donaron-dev`) + dual export & hook smoke verification                                       | **Implemented** |
| **Phase 7** | Security hardening, self-gated Gates 01–05 verification, and complete reference docs                                                      | Planned         |

## Workspace Layout

```text
donaron-plugin/
├── schemas/
│   └── donaron-plugin.v1.schema.json  # Universal DonAron v1 JSON Schema (Phase 2)
├── packages/
│   ├── core/             # @donaron/core — schema, safe loaders, parsers, policy engine, redacting logger (Implemented)
│   ├── gates/            # @donaron/gates — scoped hashing, evidence store, Gates 01–05, strict orchestrator (Implemented)
│   └── adapters/         # @donaron/adapters — shared contract, Antigravity & Claude Code exporters and hook bridge (Implemented)
├── apps/
│   └── cli/              # @donaron/cli — full donaron CLI & live stdin/stdout hook bridge (Implemented)
├── plugins/
│   └── donaron-dev/      # Personal Node + React plugin source bundle (Implemented)
├── tests/
│   ├── contract/         # Adapter golden export & live hook round-trip contract tests (Phase 4)
│   ├── e2e/              # E2E CLI & subprocess hook bridge tests on Node+React fixture (Phase 5)
│   ├── fixtures/         # Valid & invalid plugin fixtures (Phase 2)
│   └── foundation/       # Phase 1 repo hygiene & build boundary checks
└── docs/
    ├── architecture.md
    ├── decisions.md
    ├── plugin-specification.md
    ├── manifest-schema.md
    ├── gates-and-workflows.md
    ├── harness-adapters.md
    ├── cli-reference.md
    └── superpowers/
        ├── specs/2026-11-19-donaron-plugin-design.md
        └── plans/
            ├── 2026-11-19-phase-1-foundation.md
            ├── 2026-11-19-phase-2-core-engine.md
            ├── 2026-11-19-phase-3-gate-engine.md
            ├── 2026-11-19-phase-4-harness-adapters.md
            ├── 2026-11-19-phase-5-cli-and-hooks.md
            └── 2026-11-19-phase-6-donaron-dev-plugin.md
```

## Prerequisites & Local Commands

- **Node.js:** `>=24.0.0` (verified on `v24.18.0`)
- **pnpm:** `10.x` (pinned to `pnpm@10.34.9`)

```bash
pnpm install        # install & link workspace dependencies
pnpm build          # compile TypeScript project references (ESM .js + .d.ts)
pnpm typecheck      # type-check all source and test TypeScript files (noEmit)
pnpm lint           # run ESLint 9 flat config (strictTypeChecked) across all packages and tests
pnpm format:check   # verify Prettier formatting (LF line endings)
pnpm test           # build workspaces and run Vitest unit & foundation tests
pnpm test:coverage  # build workspaces and run tests with v8 coverage (minimum 70% lines/stmts/funcs/branches)
pnpm check          # run build + typecheck + lint + format:check + test:coverage
pnpm clean          # remove dist/, coverage/, and *.tsbuildinfo artifacts
```

## Design & Architecture

- [System Architecture](docs/architecture.md)
- [Architecture Decision Log](docs/decisions.md)
- [Universal Plugin Specification (v1)](docs/plugin-specification.md)
- [Manifest Schema Reference (v1)](docs/manifest-schema.md)
- [Gates and Workflows (`@donaron/gates`)](docs/gates-and-workflows.md)
- [Harness Adapters (`@donaron/adapters`)](docs/harness-adapters.md)
- [CLI & Hook Bridge Reference (`@donaron/cli`)](docs/cli-reference.md)
- [Approved System Design Document](docs/superpowers/specs/2026-11-19-donaron-plugin-design.md)
- [Phase 2 Core Engine Implementation Plan](docs/superpowers/plans/2026-11-19-phase-2-core-engine.md)
- [Phase 3 Gate Engine Implementation Plan](docs/superpowers/plans/2026-11-19-phase-3-gate-engine.md)
- [Phase 4 Harness Adapters Implementation Plan](docs/superpowers/plans/2026-11-19-phase-4-harness-adapters.md)
- [Phase 5 CLI & Hook Bridge Implementation Plan](docs/superpowers/plans/2026-11-19-phase-5-cli-and-hooks.md)
- [Phase 6 Flagship Plugin Implementation Plan](docs/superpowers/plans/2026-11-19-phase-6-donaron-dev-plugin.md)
