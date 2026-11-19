---
id: donaron-security-rules
category: security
scope: repository
priority: 100
---

- Never edit, delete, or tamper with `.donaron/**` workflow state, evidence, or audit files directly; use the `donaron` CLI.
- Never invoke `donaron gate override` as an AI agent; overrides require an interactive human TTY.
- Never read or print `.env` (except `.env.example`), `*.pem`, `*.key`, or SSH private keys, and never commit hardcoded credentials.
- Gate 03 enforces zero leaked secrets, dependency audit checks, and pinned OWASP Top 10:2021 (plus OWASP LLM Top 10 v2025 for AI apps). Critical security findings are strictly non-overridable.
