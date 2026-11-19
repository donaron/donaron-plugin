# Vitest & Coverage Guide (Gate 04)

- Run `vitest run --coverage --reporter=json` to produce `coverage/test-results.json` and `coverage/coverage-summary.json`.
- Gate 04 checks `lines`, `statements`, `functions`, and `branches` >= 70% both globally and per workspace package.
- Any test edit changes `codeHash`, requiring fresh Gate 02 and Gate 03 verification before Gate 05 sign-off.
