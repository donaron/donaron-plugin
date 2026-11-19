---
name: node-react-testing
description: Verify Node.js and React code with Vitest and >=70% per-package coverage.
purpose: Enforce Gate 04 testing rigor across unit, component, and integration suites.
activation: During TESTING after Gate 03 security review passes.
inputs:
  - Implementation diff and test plan
outputs:
  - Passing Vitest JSON results and v8 coverage-summary.json >=70% across all 4 metrics
constraints:
  - Zero skipped or pending tests without explicit human waiver
  - If tests or source files change, re-verify Gate 02 and Gate 03 before Gate 04
completionCriteria:
  - Gate 04 passes with >=70% lines, statements, functions, and branches per package
references:
  - references/vitest-testing-guide.md
version: '0.1.0'
---

# Node.js + React Testing (Gate 04)

Execute Vitest with JSON reporting and v8 coverage. Follow [the Vitest testing guide](references/vitest-testing-guide.md) to ensure zero skipped tests and >= 70% coverage per package.
