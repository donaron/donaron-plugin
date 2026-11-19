# Contributing to `donaron-plugin`

## Development Workflow

1. **Install & Build:**
   ```bash
   pnpm install
   pnpm run build
   ```
2. **Strict TDD:** Every new feature or bug fix requires a failing test first (RED -> GREEN -> REFACTOR).
3. **Full Verification Gate:**
   ```bash
   pnpm run clean && pnpm run check
   ```
   All of `tsc --build`, `tsc -p tsconfig.typecheck.json --noEmit`, `eslint .` (`strictTypeChecked`), `prettier --check .`, and `vitest run --coverage` (≥ 70% across lines, statements, functions, and branches) must pass with zero errors.

## Module Boundaries

- `packages/core` (`@donaron/core`): Zero internal `@donaron/*` or harness SDK dependencies.
- `packages/gates` (`@donaron/gates`): Depends only on `@donaron/core`.
- `packages/adapters` (`@donaron/adapters`): Depends only on `@donaron/core` and `@donaron/gates`.
- `apps/cli` (`@donaron/cli`): Thin CLI & hook bridge over the three core packages.
- `plugins/donaron-dev`: Declarative personal Node.js + React plugin bundle.
