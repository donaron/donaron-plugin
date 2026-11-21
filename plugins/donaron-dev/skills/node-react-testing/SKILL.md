---
name: node-react-testing
description: Verify any stack with >=70% per-package coverage using Vitest or JUnit XML + LCOV.
purpose: Enforce Gate 04 testing rigor across unit, component, and integration suites.
activation: During TESTING after Gate 03 security review passes.
inputs:
  - Implementation diff and test plan
outputs:
  - Passing test results (vitest JSON or junit XML) and >=70% coverage (coverage-summary.json or lcov.info)
constraints:
  - Zero skipped or pending tests without explicit human waiver
  - If tests or source files change, re-verify Gate 02 and Gate 03 before Gate 04
completionCriteria:
  - Gate 04 passes with >=70% lines, statements, functions, and branches per package
references:
  - references/vitest-testing-guide.md
version: '0.2.0'
---

# Testing & Coverage (Gate 04 — Multi-Stack)

Execute the project's test & coverage suite (`vitest` / `coverage-summary.json` or `junit` / `lcov.info` configured in `.donaron/config.json`). Follow [the testing guide](references/vitest-testing-guide.md) to ensure zero skipped tests and >= 70% coverage.
