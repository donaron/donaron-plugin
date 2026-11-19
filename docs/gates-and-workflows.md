# DonAron Gates and Workflows (`@donaron/gates`)

This document specifies the deterministic gate evaluation engine, orthogonal scoped fingerprinting, immutable `.donaron/` evidence ledger, and strict 5-gate workflow orchestrator implemented in `@donaron/gates` (`packages/gates`).

---

## 1. Implementation Status: Implemented vs. Planned

| Capability                                                                                                                                   | Status                    | Location / Target Phase                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| Orthogonal scoped hashing (`computePlanHash`, `computeCodeHash`, `computeWorkspaceHashes`)                                                   | **Implemented (Phase 3)** | `packages/gates/src/hashing/scoped-hash.ts`                |
| Immutable `.donaron/` `EvidenceStore`, `evaluateRecordFreshness` & anti-self-approval ledger                                                 | **Implemented (Phase 3)** | `packages/gates/src/store/evidence-store.ts`               |
| Gate 01 — Planning Document Review Evaluator (`evaluateGate01Planning`)                                                                      | **Implemented (Phase 3)** | `packages/gates/src/evaluators/gate01-planning.ts`         |
| Gate 02 — Pre-Test Code Review Evaluator (`evaluateGate02Pretest`)                                                                           | **Implemented (Phase 3)** | `packages/gates/src/evaluators/gate02-pretest.ts`          |
| Gate 03 — Security Review Evaluator (`evaluateGate03Security`, `scanWorkspaceForSecrets`, `parseDependencyAuditJson`, `detectAiApplication`) | **Implemented (Phase 3)** | `packages/gates/src/evaluators/gate03-security.ts`         |
| Gate 04 — Testing & Per-Package ≥70% Coverage Evaluator (`evaluateGate04Testing`, `vitestRunnerParser`)                                      | **Implemented (Phase 3)** | `packages/gates/src/evaluators/gate04-testing.ts`          |
| Gate 05 — Final Code Review Sign-Off Evaluator (`evaluateGate05Signoff`)                                                                     | **Implemented (Phase 3)** | `packages/gates/src/evaluators/gate05-signoff.ts`          |
| Strict 5-Gate `WorkflowOrchestrator` (`startWorkflow`, `transitionState`, `handleGateResult`, `overrideGate`, `evaluateStopHookGate`)        | **Implemented (Phase 3)** | `packages/gates/src/orchestrator/workflow-orchestrator.ts` |
| Antigravity & Claude Code native exporters & hook payload translators                                                                        | **Planned (Phase 4)**     | `packages/adapters`                                        |
| `donaron` CLI (`workflow`, `gate`, `hook`, `export`, `doctor`, `plugin`)                                                                     | **Planned (Phase 5)**     | `apps/cli`                                                 |
| Flagship personal Node.js + React plugin (`plugins/donaron-dev`)                                                                             | **Planned (Phase 6)**     | `plugins/donaron-dev`                                      |
| Self-gated verification & full installation/CLI documentation                                                                                | **Planned (Phase 7)**     | `docs/`                                                    |

---

## 2. Orthogonal Scoped Fingerprinting (`planHash` vs. `codeHash`)

A naive repository hash causes an infinite stale-evidence loop: writing gate evidence into `.donaron/` or editing implementation code after Gate 01 would invalidate Gate 01 planning evidence. `@donaron/gates` solves this with two orthogonal SHA-256 digests (`computePlanHash`, `computeCodeHash`, and `computeWorkspaceHashes` in `packages/gates/src/hashing/scoped-hash.ts`):

1. **`planHash` (Scopes `GATE_01` and `GATE_05`):**
   - Computed deterministically over the sorted list of declared `planFiles` (e.g., `docs/plan.md`).
   - Normalizes `CRLF` (`\r\n`) line endings to `LF` (`\n`) before hashing so Windows and POSIX checkouts produce identical `sha256:<64-hex>` digests.
   - Fails closed if `planFiles` is empty, escapes `workspaceRoot` (via `resolveSafePluginPath`), or references missing, empty, or non-regular files.
2. **`codeHash` (Scopes `GATE_02`, `GATE_03`, `GATE_04`, and `GATE_05`):**
   - Hashes the trimmed `git rev-parse HEAD` commit SHA (or `'no-git-head'` when not in a committed git tree) together with every regular file in the workspace (`CRLF` normalized to `LF` for UTF-8 text files; raw bytes for binary files).
   - Explicitly **excludes**:
     - `.git/**`
     - `.donaron/**` (writing evidence, reviews, or workflow state never mutates `codeHash` or `planHash`)
     - `node_modules/**`, `dist/**`, `coverage/**`, `.turbo/**`, `.next/**`, `build/**`
     - `*.tsbuildinfo`
     - All declared `planFiles` (updating plan files does not alter `codeHash`, and editing source/test files does not alter `planHash`)
   - Fails closed if any workspace entry is a symlink or NTFS junction escaping `workspaceRoot`.

---

## 3. Immutable Evidence Store & Anti-Self-Approval Ledger

`EvidenceStore` (`packages/gates/src/store/evidence-store.ts`) manages `.donaron/` state inside the target repository:

```text
.donaron/
├── active-run.json
└── runs/
    └── <runId>/
        ├── state.json
        ├── audit.jsonl
        ├── evidence/
        │   ├── GATE_01-001.json
        │   ├── GATE_02-001.json
        │   ├── GATE_03-001.json
        │   ├── GATE_04-001.json
        │   └── GATE_05-001.json
        └── reviews/
            ├── review-001.json
            └── review-002.json
```

### Key Integrity Guarantees

- **Path Traversal Prevention:** `runId` is validated against `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/` and every read/write resolves through `resolveSafePluginPath`.
- **Immutable Numbered Decision History (`recordGateDecision`):** Gate evaluations write sequentially numbered immutable files (`evidence/GATE_01-001.json`, `evidence/GATE_01-002.json`, etc.) so rework history is preserved (`listGateDecisions`) while `getLatestGateDecision` returns the most recent decision for a gate.
- **Automatic Secret Redaction:** Every workflow state, review artifact, gate decision record, and `audit.jsonl` record is passed through `redactObject` / `redactSecrets` from `@donaron/core` before hitting disk. Raw credentials (`sk-ant-...`, `AKIA...`, `ghp_...`, bearer tokens, private keys) are scrubbed to `[REDACTED]`.
- **Role Allowlist & Anti-Self-Approval (`registerArtifactAuthor` & `recordReview`):**
  - `registerArtifactAuthor(runId, 'plan' | 'code', actorId)` records authors on `planAuthorIds` and `implementerIds`.
  - Each gate enforces an explicit allowed reviewer role list:
    - `GATE_01`: `intake-reviewer`, `solutions-architect`, `human`
    - `GATE_02`: `reviewer`, `code-reviewer`, `human`
    - `GATE_03`: `reviewer`, `code-reviewer`, `human`
    - `GATE_05`: `code-reviewer`, `human`
  - If `review.evaluator.id` matches a registered plan author (for `GATE_01`) or code implementer (for `GATE_02`, `GATE_03`, `GATE_05`), `recordReview` fails closed with `SELF_APPROVAL_FORBIDDEN` and logs `REVIEW_REJECTED` to `audit.jsonl`.
  - If `review.role` is not permitted for the target gate (e.g., `role: 'reviewer'` attempting to sign off `GATE_05`), `recordReview` fails closed with `UNAUTHORIZED_REVIEWER_ROLE` and logs `REVIEW_REJECTED`.
- **Scoped Freshness Verification (`evaluateRecordFreshness`):**
  - Returns `'MISSING'` when no record exists, or `'FAILED'` when `record.decision !== 'PASS'`.
  - `GATE_01` is `'FRESH'` when `record.planHash === hashes.planHash` (even after implementation edits change `codeHash`), and `'STALE'` when `planHash` differs.
  - `GATE_02`, `GATE_03`, and `GATE_04` are `'FRESH'` when `record.codeHash === hashes.codeHash`, and `'STALE'` when `codeHash` differs.
  - `GATE_05` requires **both** `record.planHash === hashes.planHash` and `record.codeHash === hashes.codeHash`.

---

## 4. The 5 Mandatory Gates (`strict` Mode)

### Gate 01 — Planning Document Review (`evaluateGate01Planning`)

- Verifies every declared `planFile` exists inside `workspaceRoot` and contains non-empty content under all 5 mandatory markdown headings (case-insensitive `#`–`######`):
  1. `Requirements`
  2. `Specification`
  3. `Architecture`
  4. `Task Plan`
  5. `Acceptance Criteria`
- Verifies fresh (`planHash`-matching) approved review records with zero `critical`/`high` findings from **both** `intake-reviewer` and `solutions-architect` (or a single `human` review record).

### Gate 02 — Pre-Test Code Review (`evaluateGate02Pretest`)

- Executes zero-token deterministic `runner.runTypecheck(workspaceRoot)` and `runner.runLint(workspaceRoot)` checks via `PretestCheckRunner`.
- Fails closed (`FAIL`) if either check fails or throws.
- Verifies a fresh (`codeHash`-matching) approved review from `reviewer`, `code-reviewer`, or `human` with zero `critical`/`high` findings.

### Gate 03 — Security Review (`evaluateGate03Security`)

- **Deterministic Workspace Secret Scanner (`scanWorkspaceForSecrets`):** Scans workspace files (respecting `.donaronignore` and skipping `.git/`, `.donaron/`, `node_modules/`, `dist/`, `coverage/`, and `.env.example`) for tracked `.env` files, OpenAI/Anthropic keys (`sk-...`, `sk-ant-...`), AWS access keys (`AKIA...`), GitHub tokens (`ghp_...`, `github_pat_...`), Google API keys (`AIza...`), and PEM private keys. Any match emits a `critical` finding without leaking the raw secret value.
- **Dependency Audit Parser (`parseDependencyAuditJson`):** Parses npm/pnpm audit JSON (`metadata.vulnerabilities` or `advisories` map). Fails closed (`FAIL`) on malformed JSON or any `critical`/`high` vulnerability (`moderate`/`low` vulnerabilities are logged as non-blocking findings). Returns `BLOCKED` if no audit was executed and no `offlineWaiverReason` was supplied.
- **Pinned OWASP Checklists:**
  - Requires fresh (`codeHash`-matching) review citing `OWASP-Top-10:2021` (`PINNED_OWASP_TOP_10_VERSION`) with non-empty `scope` and `limitations`.
  - When `detectAiApplication(workspaceRoot)` or `forceAiChecklist` is `true` (detecting `openai`, `@anthropic-ai/sdk`, `@google/genai`, `ai`, `@ai-sdk/*`, `langchain`, etc. in `package.json`), additionally requires `OWASP-LLM-Top-10:2025` (`PINNED_OWASP_LLM_TOP_10_VERSION`).

### Gate 04 — Testing & Per-Package Coverage (`evaluateGate04Testing`)

- Parses test execution results via `TestRunnerParser` (default `vitestRunnerParser` reading `coverage/test-results.json` or an explicit `testRun`). Fails closed (`FAIL`) if `totalTests <= 0`, `failedTests > 0`, or `skippedTests > 0` (when `allowSkippedTests` is not enabled).
- Parses Istanbul/Vitest `coverage/coverage-summary.json`:
  - Enforces aggregate `total` `lines`, `statements`, `functions`, and `branches` ≥ `DEFAULT_COVERAGE_THRESHOLDS` (70% across all four metrics).
  - **Per-Package Monorepo Enforcement (`requiredPackages`):** For each required package prefix (e.g., `packages/core`, `packages/gates`), aggregates `covered / total` across all file entries under `<pkgPrefix>/src/` and fails closed if any package has 0 matched files or drops below 70% on any metric.

### Gate 05 — Final Code Review Sign-Off (`evaluateGate05Signoff`)

- Re-computes live `WorkspaceHashes` (`planHash` + `codeHash`) and verifies `evaluateRecordFreshness` is `'FRESH'` for every prior gate required by the run's `tier`:
  - `strict`: `GATE_01`, `GATE_02`, `GATE_03`, `GATE_04`
  - `standard`: `GATE_01`, `GATE_03`, `GATE_04`
  - `quick`: `GATE_03`, `GATE_04`
- Fails closed (`FAIL`) if any required prior gate is `MISSING`, `STALE`, or `FAILED`.
- Verifies a fresh (`codeHash`-matching) approved review from `code-reviewer` or `human` with zero `critical`/`high` findings.

---

## 5. Strict Workflow Orchestrator, Bounded Rework & `Stop` Hook Guard

`WorkflowOrchestrator` (`packages/gates/src/orchestrator/workflow-orchestrator.ts`) coordinates workflow state transitions:

- **Default `strict` Mode (`startWorkflow`):** Defaults to `tier: 'strict'` (initial state `'INTAKE'`, or `'IMPLEMENTATION'` for human-initiated `'quick'`) and writes `.donaron/active-run.json`. If `actorType === 'agent'` requests `tier: 'standard'` or `'quick'`, `startWorkflow` fails closed with `TIER_DOWNGRADE_FORBIDDEN`.
- **Stage Ordering & Automatic Stale Rewind (`transitionState`):**
  - Blocks entering `'IMPLEMENTATION'` in `strict`/`standard` mode unless `GATE_01` has `'FRESH'` `PASS` evidence (`GATE_01_NOT_FRESH`).
  - If source or test files are modified during `'TESTING'` or `'GATE_04'` (invalidating `codeHash` after `GATE_02` or `GATE_03` passed), `transitionState` detects the stale evidence (`STALE_PRIOR_GATE_EVIDENCE`) and automatically routes the run back to `'PRE_TEST_REVIEW'` (in `strict` mode) or `'SECURITY_REVIEW'` (in `standard`/`quick` mode).
  - Blocks entering `'COMPLETED'` unless all required gates for the tier have `'FRESH'` `PASS` evidence.
- **Bounded Rework & Escalation (`handleGateResult`):**
  - On `PASS`, advances to the next stage (`GATE_01` → `'IMPLEMENTATION'`, `GATE_02` → `'SECURITY_REVIEW'`, `GATE_03` → `'TESTING'`, `GATE_04` → `'FINAL_REVIEW'`, `GATE_05` → `'COMPLETED'`).
  - On `FAIL`, increments `retryCounts[gateId]` and routes back to `'PLANNING'` (for `GATE_01`) or `'IMPLEMENTATION'` (for `GATE_02`..`GATE_05`).
  - Once `retryCounts[gateId] >= maxRetries` (default `3`), transitions the run to `'NEEDS_HUMAN_APPROVAL'` so the agent cannot loop indefinitely.
- **Human-Only Interactive TTY Override (`overrideGate`):**
  - Rejects `actorType !== 'human'` (`AGENT_OVERRIDE_FORBIDDEN`), `!isInteractiveTty` (`NON_TTY_OVERRIDE_FORBIDDEN`), `!confirmed` (`OVERRIDE_NOT_CONFIRMED`), empty `approver`, or `reason.trim().length < 10`.
  - **Hard Security Invariant:** Rejects overriding `GATE_03` when its latest decision contains any `severity: 'critical'` finding (`CRITICAL_SECURITY_NON_OVERRIDABLE`), even from an interactive human TTY.
- **`Stop` Hook Enforcement (`evaluateStopHookGate`):**
  - **Choice 2A:** When no `.donaron/active-run.json` exists in `workspaceRoot`, returns `{ decision: 'allow_stop' }`.
  - **Loop & Termination Guards:** Returns `{ decision: 'allow_stop' }` when `continuationActive === true`, when `terminationReason !== 'NO_TOOL_CALL'`, or when the workflow is in an interactive, waiting, or terminal state (`'INTAKE'`..`'GATE_01'`, `'RESEARCH'`, `'NEEDS_HUMAN_APPROVAL'`, `'BLOCKED'`, `'COMPLETED'`, `'REJECTED'`, `'CANCELLED'`).
  - **Active Implementation Enforcement:** When in `'IMPLEMENTATION'`..`'GATE_05'` and any required gate is not `'FRESH'`, returns `{ decision: 'continue', reason: ... }` naming the exact incomplete gates.
