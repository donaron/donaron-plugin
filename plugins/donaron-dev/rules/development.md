---
id: donaron-development-rules
category: development
scope: repository
priority: 90
---

- Follow strict TDD (RED -> GREEN -> REFACTOR): write a failing test before implementing production code.
- Keep Node.js + TypeScript modules strictly typed (ESM, zero `any` escapes) and React components accessible, small, and single-purpose.
- Run zero-token deterministic checks (`tsc --noEmit`, `eslint`, `prettier`, `vitest run --coverage`) before requesting `code-reviewer` or `qa` sign-off.
- Maintain >= 70% test coverage across lines, statements, functions, and branches (per workspace package in monorepos).
