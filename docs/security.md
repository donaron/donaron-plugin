# DonAron Security Architecture & Trust Boundaries

This document states the security guarantees, fail-closed enforcement controls, and honest trust boundaries of `donaron-plugin`.

---

## 1. Honest Trust Boundary Statement

- **Node.js is not an OS/container sandbox:** DonAron runs locally on your machine with your user account's Node.js permissions. It enforces deterministic policy and gate controls at the AI harness lifecycle boundary (`PreToolUse`, `Stop`) and CLI boundary (`donaron`), not kernel-level syscall isolation.
- **Choice 1A (Trust Boundary):** DonAron enforces workflow and evidence integrity via `PreToolUse` hook guards + interactive human terminal confirmation (`process.stdin.isTTY`) + immutable `.donaron/runs/<runId>/audit.jsonl` trails (no local cryptographic signing key management in v1).

---

## 2. Fail-Closed Policy Engine (`@donaron/core`)

- Evaluates built-in `DEFAULT_SECURITY_POLICIES` plus optional `.donaron/policy.json` with strict precedence `DENY > REQUIRE_APPROVAL > ALLOW`.
- Fails closed (`DENY`, `failedClosed: true`) on malformed regexes, malformed `.donaron/policy.json`, missing workspace roots on write/delete checks, or escaping symlinks/NTFS junctions.
- **Built-in Guards Active in All Repositories (Choice 2A):**
  - Blocks agent writes/deletions inside `.donaron` and `.donaron/**`.
  - Blocks agent shell invocations of `donaron gate override`.
  - Blocks reading/writing/deleting `.env` (except `.env.example`), `*.pem`, `*.key`, `id_rsa`, `id_ed25519`.
  - Blocks destructive shell commands (`rm -rf /`, `git push --force`, `git reset --hard`, `DROP TABLE`, pipe-to-shell).
  - Blocks file writes/deletions that escape the active workspace root (including symlink and broken `..` traversal escapes).

---

## 3. Gate Integrity & Anti-Bypass Controls (`@donaron/gates`)

- **Orthogonal Scoped Fingerprinting:** `planHash` scopes Gate 01; `codeHash` scopes Gates 02–05. Writing `.donaron/` evidence mutates neither hash; editing code or tests immediately invalidates Gates 02–05 (`STALE`).
- **Anti-Self-Approval:** `EvidenceStore.recordReview` normalizes actor IDs (case-insensitive, trimmed) and blocks registered `plan` or `code` authors from approving their own work (`SELF_APPROVAL_FORBIDDEN`).
- **Pinned OWASP Checklists & Secret Scanning (Gate 03):**
  - Scans workspace files for AWS, GitHub, OpenAI/Anthropic, Google API keys, PEM blocks, and unignored `.env` files without leaking raw secret values.
  - Enforces `OWASP-Top-10:2021` (plus `OWASP-LLM-Top-10:2025` for AI/LLM repositories).
  - **Hard Non-Overridable Invariant:** Gate 03 `critical` security findings can **never** be overridden (`CRITICAL_SECURITY_NON_OVERRIDABLE`), even by an interactive human TTY.
- **Secret Redaction:** `redactObject` and `redactSecrets` scrub credentials (`*token*`, `*secret*`, `*password*`, `*key*`, `authorization`, `cookie`, Bearer/JWT/API key patterns, including objects with custom `toJSON()`) before persisting state, evidence, or `audit.jsonl`.
