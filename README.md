# DonAron-plugin

Personal multi-harness AI development workflow and fail-closed gate enforcement system for **Antigravity** and **Claude Code**, targeting **Node.js + React** codebases.

## Implementation Status

Documentation explicitly separates implemented behavior from planned phases:

| Phase       | Scope                                                                                                                                     | Status          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Phase 1** | pnpm TypeScript ESM monorepo foundation, 5-module boundaries, build/lint/format/test/coverage toolchain, architecture & decision log      | **Implemented** |
| **Phase 2** | Universal manifest v1 schema (Ajv), path-safe loaders, deterministic fail-closed policy engine, secret-redacting logger (`@donaron/core`) | Planned         |
| **Phase 3** | Scoped `planHash`/`codeHash` Evidence Store, Gates 01–05, `strict` default workflow state machine (`@donaron/gates`)                      | Planned         |
| **Phase 4** | Harness adapter contract + Antigravity and Claude Code exporters & hook payload translators (`@donaron/adapters`)                         | Planned         |
| **Phase 5** | Full `donaron` CLI (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`, `hook`) (`@donaron/cli`)                                 | Planned         |
| **Phase 6** | Flagship Node + React plugin bundle (`plugins/donaron-dev`) + live Antigravity smoke verification                                         | Planned         |
| **Phase 7** | Security hardening, self-gated Gates 01–05 verification, and complete reference docs                                                      | Planned         |

## Workspace Layout

```text
donaron-plugin/
├── packages/
│   ├── core/             # @donaron/core — zero internal dependencies
│   ├── gates/            # @donaron/gates — depends on @donaron/core
│   └── adapters/         # @donaron/adapters — depends on @donaron/core, @donaron/gates
├── apps/
│   └── cli/              # @donaron/cli — thin CLI & hook bridge entrypoint
├── plugins/
│   └── donaron-dev/      # Personal Node + React plugin source bundle (Phase 6)
├── tests/
│   └── foundation/       # Phase 1 repo hygiene & build boundary checks
└── docs/
    ├── architecture.md
    ├── decisions.md
    └── superpowers/
        ├── specs/2026-11-19-donaron-plugin-design.md
        └── plans/2026-11-19-phase-1-foundation.md
```

## Prerequisites & Local Commands

- **Node.js:** `>=24.0.0` (verified on `v24.18.0`)
- **pnpm:** `10.x` (pinned to `pnpm@10.34.9`)

```bash
pnpm install        # install & link workspace dependencies
pnpm build          # compile TypeScript project references (ESM .js + .d.ts)
pnpm lint           # run ESLint 9 flat config across all packages
pnpm format:check   # verify Prettier formatting (LF line endings)
pnpm test           # run Vitest unit & foundation tests
pnpm test:coverage  # run tests with v8 coverage (minimum 70% lines/stmts/funcs/branches)
pnpm check          # run build + lint + format:check + test:coverage
pnpm clean          # remove dist/, coverage/, and *.tsbuildinfo artifacts
```

## Design & Architecture

- [System Architecture](docs/architecture.md)
- [Architecture Decision Log](docs/decisions.md)
- [Approved System Design Document](docs/superpowers/specs/2026-11-19-donaron-plugin-design.md)
