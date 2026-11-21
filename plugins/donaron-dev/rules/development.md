---
id: donaron-development-rules
category: development
scope: repository
priority: 90
---

- Follow strict TDD (RED -> GREEN -> REFACTOR): write a failing test before implementing production code in any language.
- Respect `.donaron/config.json` (or auto-detected stack defaults) for typecheck, lint, test (`vitest` or `junit`), and coverage (`istanbul-summary` or `lcov`) commands.
- Keep modules strictly typed, small, and single-purpose; keep UI components accessible and well-structured.
- Run zero-token deterministic checks before requesting `code-reviewer` or `qa` sign-off, and maintain >= 70% test coverage across lines, statements, functions, and branches (per package in monorepos).
