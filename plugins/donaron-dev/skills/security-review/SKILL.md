---
name: security-review
description: Audit Node.js + React codebases against pinned OWASP Top 10:2021 and OWASP LLM Top 10 v2025 checklists.
purpose: Perform independent Gate 03 security verification with secret scanning, audit review, and explicit scope/limitations.
activation: During SECURITY_REVIEW after Gate 02 pre-test review passes.
inputs:
  - Target code diff, dependency audit output, and AI SDK detection result
outputs:
  - Gate 03 security review record citing OWASP-Top-10:2021 (and OWASP-LLM-Top-10:2025 if applicable)
constraints:
  - Never expose raw secrets in logs or findings
  - Never allow critical security findings to be overridden
completionCriteria:
  - Zero leaked secrets, zero critical/high dependency CVEs, and pinned OWASP review recorded
references:
  - references/owasp-checklists.md
version: '0.1.0'
---

# Security Review (Gate 03)

Audit the codebase using [the pinned OWASP checklists](references/owasp-checklists.md) and record findings via `donaron workflow record-review --gate GATE_03 --checklists ... --scope ... --limitations ...`.
