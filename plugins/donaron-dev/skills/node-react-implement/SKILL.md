---
name: node-react-implement
description: Implement Node.js TypeScript and React features strictly using TDD.
purpose: Deliver clean, strictly typed Node.js and React modules without scope creep or self-certification.
activation: During IMPLEMENTATION after Gate 01 has fresh PASS evidence.
inputs:
  - Approved Gate 01 planning artifact and target task brief
outputs:
  - Tested ESM TypeScript / React code changes passing typecheck and lint
constraints:
  - Write a failing test before production code (TDD RED -> GREEN)
  - Never modify .donaron/** evidence files directly
completionCriteria:
  - Zero TypeScript errors, zero ESLint errors, and independent Gate 02 review recorded
references:
  - references/node-react-patterns.md
  - references/stack-commands.md
version: '0.2.0'
---

# Feature Implementation (Multi-Stack)

Implement each scoped task via TDD (RED -> GREEN -> REFACTOR). Consult [stack commands](references/stack-commands.md) and [Node + React patterns](references/node-react-patterns.md), then run `donaron gate run 02`.
