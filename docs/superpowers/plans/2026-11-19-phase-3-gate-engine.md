# DonAron-plugin Phase 3 — Gate Engine, Scoped Evidence Store & Strict Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify `@donaron/gates` — orthogonal `planHash`/`codeHash` fingerprinting, immutable Evidence Store with redacted JSONL audit trail, anti-self-approval review enforcement, all five mandatory gates (Gates 01–05), the `strict`-by-default workflow orchestrator state machine with bounded rework, interactive TTY human overrides, and `Stop`-hook gate evaluation — at ≥70% test coverage across all metrics.

**Architecture:** All Phase 3 code lives inside `packages/gates` and depends only on `@donaron/core` (`workspace:*`) and Node.js built-ins (zero new external npm dependencies). Modules split cleanly by responsibility (`types.ts`, `hashing/`, `store/`, `evaluators/`, `orchestrator/`) and re-export through `packages/gates/src/index.ts` while preserving Phase 1's `DONARON_GATES_VERSION` and `getGatesModuleInfo()`. Work executes on branch `phase-3/gate-engine` cut from `phase-2/core-engine` (`23fa0e2`).

**Tech Stack:** TypeScript 5.8 (strict ESM / `NodeNext`), Node.js `>=24.0.0`, `@donaron/core` (`redactObject`, `redactSecrets`, `ValidationResult`, `ValidationIssue`), Vitest + `@vitest/coverage-v8`, ESLint 9 (`strictTypeChecked`), Prettier.

**Spec:** [2026-11-19-donaron-plugin-design.md](../specs/2026-11-19-donaron-plugin-design.md) (§5, §6.3, §7 Phase 3) and [DONARON-PLUGIN-SPEC.md](file:///c:/Users/USER/Downloads/DONARON-PLUGIN-SPEC.md) (§12, §13, §16, §17, §18)

## Global Constraints

- Repository root: `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`; work on branch `phase-3/gate-engine` branched from `phase-2/core-engine` (`23fa0e2`)
- Dependency boundary: `@donaron/gates` depends only on `@donaron/core` (`workspace:*`) and Node.js built-ins; zero new external npm packages and zero dependencies on `@donaron/adapters` or `@donaron/cli`
- Preserve existing `@donaron/gates` exports (`DONARON_GATES_VERSION`, `getGatesModuleInfo`) so `@donaron/adapters` and `@donaron/cli` remain 100% green
- Orthogonal scoped hashes: `planHash` covers declared planning artifacts; `codeHash` covers `git rev-parse HEAD` (when available) + workspace source/test files excluding `.git/`, `.donaron/`, `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, and declared `planFiles` so writing `.donaron/` evidence or editing code never invalidates Gate 01 (`planHash`), while any code/test edit invalidates Gates 02–05 (`codeHash`)
- Fail-closed gate evaluation: missing evidence, missing coverage reports, 0 executed tests, unexpected skipped tests, coverage <70% (aggregate or per-package), self-approval attempts, or unhandled evaluator errors always produce `FAIL` or `BLOCKED` — never `PASS`
- Choice 1A override boundary: `overrideGate` requires `actorType: 'human'`, `isInteractiveTty: true`, `confirmed: true`, non-empty `approver`, and `reason` (≥10 chars), and is **strictly forbidden** on Gate 03 `critical` security findings
- Choice 2A & interactive `Stop` hook boundary: `evaluateStopHookGate` allows stopping when no active `.donaron` workflow exists in `workspaceRoot`, when `continuationActive === true`, when `terminationReason !== 'NO_TOOL_CALL'`, or when in interactive/waiting/terminal states (`INTAKE`..`GATE_01`, `RESEARCH`, `NEEDS_HUMAN_APPROVAL`, `BLOCKED`, `COMPLETED`, `REJECTED`, `CANCELLED`); blocks stopping (`decision: 'continue'`) only in `IMPLEMENTATION`..`GATE_05` when required gates lack fresh `PASS` evidence
- Phase 3 green bar: `pnpm run clean && pnpm run check` exits 0 with ≥70% lines, statements, functions, and branches across both the monorepo and `packages/gates/src/**`

## Review Focus

1. **Evidence writes or planning edits cross-contaminating `codeHash` and `planHash`:** Writing `.donaron/runs/<runId>/evidence/*.json` must never alter `codeHash` or `planHash`, and editing source code during `IMPLEMENTATION` must not alter `planHash` — pinned by Task 1 & Task 2 orthogonality tests.
2. **Self-approval or unauthorized role approval at Gates 01, 02, 03, and 05:** Submitting a review where `evaluator.id` matches an author/implementer of that revision (or where `developer` tries to sign off Gate 05 instead of `code-reviewer`/`human`) must fail closed with `SELF_APPROVAL_FORBIDDEN` / `UNAUTHORIZED_REVIEWER_ROLE` — pinned by Task 2, Task 3, Task 5, and Task 6 tests.
3. **Stale Gate 02/03 evidence surviving test modifications during `TESTING`:** Modifying any test or source file after Gate 02/03 passed changes `codeHash`; Gate 05 must reject stale Gate 02/03 records and the orchestrator must route back to re-verify Gate 02/03 — pinned by Task 5 & Task 6 stale-hash tests.
4. **Monorepo per-package <70% coverage masked by >70% aggregate total in Gate 04:** Gate 04 must check both aggregate total AND each configured workspace package prefix in `coverage-summary.json`, failing closed if any single package drops below 70% on lines, statements, functions, or branches — pinned by Task 5 monorepo coverage tests.
5. **Non-TTY / agent override spoofing, overriding critical Gate 03 secrets/CVEs, or infinite `Stop` hook continuation loops:** `overrideGate` must reject non-human, non-TTY, or critical-security overrides, and `evaluateStopHookGate` must yield when `continuationActive: true` or outside active implementation states — pinned by Task 6 orchestrator & security tests.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── packages/gates/
│   └── src/
│       ├── index.ts                                  # public barrel exporting gates APIs + getGatesModuleInfo
│       ├── types.ts                                  # GateId, GateDecisionRecord, WorkflowState, WorkflowTier, etc.
│       ├── hashing/
│       │   ├── scoped-hash.ts                        # computePlanHash, computeCodeHash, computeWorkspaceHashes
│       │   └── scoped-hash.test.ts
│       ├── store/
│       │   ├── evidence-store.ts                     # EvidenceStore: runs, evidence records, freshness, reviews, audit.jsonl
│       │   └── evidence-store.test.ts
│       ├── evaluators/
│       │   ├── gate01-planning.ts                    # Gate 01: planning sections + intake-reviewer/solutions-architect/human
│       │   ├── gate02-pretest.ts                     # Gate 02: zero-token compile/lint + independent reviewer
│       │   ├── gate03-security.ts                    # Gate 03: secret scan + audit parser + pinned OWASP 2021 / LLM 2025
│       │   ├── gate04-testing.ts                     # Gate 04: TestRunnerParser + Vitest JSON & per-package >=70% coverage
│       │   ├── gate05-signoff.ts                     # Gate 05: fresh Gates 01-04 verification + independent code-reviewer
│       │   └── evaluators.test.ts
│       ├── orchestrator/
│       │   ├── workflow-orchestrator.ts              # strict/standard/quick state machine, rework, overrideGate, evaluateStopHookGate
│       │   └── workflow-orchestrator.test.ts
│       └── __tests__/
│           └── gate-security.test.ts                 # dedicated Phase 3 bypass, staleness & self-approval security suite
└── docs/
    ├── gates-and-workflows.md
    └── superpowers/plans/2026-11-19-phase-3-gate-engine.md
```

---

### Task 1: Branch Setup, Gate & Workflow Types, and Orthogonal Scoped Hashing (`planHash` + `codeHash`)

**Files:**

- Create: `packages/gates/src/types.ts`
- Create: `packages/gates/src/hashing/scoped-hash.ts`
- Test: `packages/gates/src/hashing/scoped-hash.test.ts`

**Interfaces:**

- Consumes: `ValidationIssue`, `ValidationResult` from `@donaron/core`
- Produces (`packages/gates/src/types.ts`):

  ```ts
  export type GateId = 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_04' | 'GATE_05';
  export type GateDecisionStatus =
    | 'PASS'
    | 'FAIL'
    | 'NEEDS_HUMAN_APPROVAL'
    | 'BLOCKED'
    | 'NOT_APPLICABLE';
  export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
  export type WorkflowTier = 'strict' | 'standard' | 'quick';
  export type WorkflowState =
    | 'INTAKE'
    | 'REQUIREMENTS_REVIEW'
    | 'ARCHITECTURE'
    | 'PLANNING'
    | 'GATE_01'
    | 'RESEARCH'
    | 'IMPLEMENTATION'
    | 'PRE_TEST_REVIEW'
    | 'GATE_02'
    | 'SECURITY_REVIEW'
    | 'GATE_03'
    | 'TESTING'
    | 'GATE_04'
    | 'FINAL_REVIEW'
    | 'GATE_05'
    | 'COMPLETED'
    | 'REJECTED'
    | 'BLOCKED'
    | 'CANCELLED'
    | 'NEEDS_HUMAN_APPROVAL';

  export interface GateEvaluator {
    readonly type: 'deterministic' | 'agent' | 'human';
    readonly id: string;
  }

  export interface GateCheckResult {
    readonly name: string;
    readonly passed: boolean;
    readonly summary: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }

  export interface GateFinding {
    readonly id: string;
    readonly severity: FindingSeverity;
    readonly message: string;
    readonly file?: string;
    readonly line?: number;
    readonly ruleId?: string;
  }

  export interface HumanApprovalRecord {
    readonly approver: string;
    readonly reason: string;
    readonly timestamp: string;
    readonly isOverride: boolean;
  }

  export interface GateDecisionRecord {
    readonly gateId: GateId;
    readonly gateVersion: string;
    readonly runId: string;
    readonly planHash?: string;
    readonly codeHash?: string;
    readonly evaluator: GateEvaluator;
    readonly checks: readonly GateCheckResult[];
    readonly evidenceRefs: readonly string[];
    readonly findings: readonly GateFinding[];
    readonly decision: GateDecisionStatus;
    readonly timestamp: string;
    readonly humanApproval?: HumanApprovalRecord;
  }

  export interface AgentReviewRecord {
    readonly gateId: 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05';
    readonly runId: string;
    readonly role:
      | 'intake-reviewer'
      | 'solutions-architect'
      | 'reviewer'
      | 'code-reviewer'
      | 'human';
    readonly evaluator: GateEvaluator;
    readonly approved: boolean;
    readonly summary: string;
    readonly findings: readonly GateFinding[];
    readonly planHash?: string;
    readonly codeHash?: string;
    readonly checklistVersions?: readonly string[];
    readonly scope?: string;
    readonly limitations?: string;
    readonly timestamp: string;
  }

  export interface WorkspaceHashes {
    readonly planHash: string;
    readonly codeHash: string;
    readonly gitHead: string;
  }
  ```

- Produces (`packages/gates/src/hashing/scoped-hash.ts`):

  ```ts
  export interface CodeHashOptions {
    readonly planFiles?: readonly string[];
    readonly extraExcludeDirs?: readonly string[];
  }
  export function computePlanHash(
    workspaceRoot: string,
    planFiles: readonly string[],
  ): ValidationResult<string>;
  export function computeCodeHash(
    workspaceRoot: string,
    options?: CodeHashOptions,
  ): ValidationResult<{ readonly codeHash: string; readonly gitHead: string }>;
  export function computeWorkspaceHashes(
    workspaceRoot: string,
    planFiles: readonly string[],
    options?: CodeHashOptions,
  ): ValidationResult<WorkspaceHashes>;
  ```

- [ ] **Step 1: Create branch `phase-3/gate-engine` from `phase-2/core-engine`**

Run (sandbox): `git checkout -b phase-3/gate-engine` inside `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`.

- [ ] **Step 2: Write `packages/gates/src/types.ts` and failing `scoped-hash.test.ts` (Review Focus #1)**

Create `packages/gates/src/types.ts`.
Create `packages/gates/src/hashing/scoped-hash.test.ts` testing:

- `computePlanHash` returns deterministic `sha256:<64-hex>` independent of `planFiles` array ordering or `\` vs `/` slashes; fails when `planFiles` is empty, missing on disk, empty file, or escapes `workspaceRoot` via `../` or symlink.
- `computeCodeHash` hashes source & test files + git HEAD (or `'no-git-head'` in non-git temp dir) while ignoring `.donaron/`, `.git/`, `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, and declared `planFiles`.
- **Orthogonality (Review Focus #1):**
  - Writing/modifying files under `.donaron/runs/run-1/evidence.json` changes NEITHER `planHash` NOR `codeHash`.
  - Modifying `src/app.ts` or `tests/app.test.ts` changes `codeHash` while leaving `planHash` identical.
  - Modifying `docs/plan.md` (when listed in `planFiles`) changes `planHash` while leaving `codeHash` identical.

- [ ] **Step 3: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/hashing/scoped-hash.test.ts`
Expected: FAIL because `scoped-hash.ts` does not exist.

- [ ] **Step 4: Implement `packages/gates/src/hashing/scoped-hash.ts`**

Use `@donaron/core`'s `resolveSafePluginPath` for safe path resolution inside `workspaceRoot`, `crypto.createHash('sha256')`, and safe `spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })` fallback (`'no-git-head'`).

- [ ] **Step 5: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/gates/src/hashing/scoped-hash.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(gates): add gate domain types and orthogonal planHash/codeHash fingerprinting"`

---

### Task 2: Immutable Evidence Store, Freshness Checker, Anti-Self-Approval Ledger & Redacted Audit Log

**Files:**

- Create: `packages/gates/src/store/evidence-store.ts`
- Test: `packages/gates/src/store/evidence-store.test.ts`

**Interfaces:**

- Consumes: `GateId`, `GateDecisionRecord`, `AgentReviewRecord`, `WorkspaceHashes`, `WorkflowState`, `WorkflowTier` from `../types.js`; `redactObject`, `redactSecrets`, `ValidationResult` from `@donaron/core`
- Produces (`packages/gates/src/store/evidence-store.ts`):

  ```ts
  export type EvidenceFreshness = 'FRESH' | 'STALE' | 'MISSING' | 'FAILED';

  export interface WorkflowRunState {
    readonly runId: string;
    readonly tier: WorkflowTier;
    readonly state: WorkflowState;
    readonly taskDescription: string;
    readonly planFiles: readonly string[];
    readonly planAuthorIds: readonly string[];
    readonly implementerIds: readonly string[];
    readonly retryCounts: Readonly<Record<GateId, number>>;
    readonly maxRetries: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }

  export interface AuditLogEntry {
    readonly timestamp: string;
    readonly runId: string;
    readonly eventType:
      | 'WORKFLOW_STARTED'
      | 'STATE_TRANSITION'
      | 'AUTHOR_REGISTERED'
      | 'REVIEW_RECORDED'
      | 'REVIEW_REJECTED'
      | 'GATE_EVALUATED'
      | 'GATE_OVERRIDDEN';
    readonly actorId: string;
    readonly details: Readonly<Record<string, unknown>>;
  }

  export function evaluateRecordFreshness(
    record: GateDecisionRecord | undefined,
    hashes: WorkspaceHashes,
  ): EvidenceFreshness;

  export class EvidenceStore {
    constructor(workspaceRoot: string);
    initRun(params: {
      readonly runId: string;
      readonly tier: WorkflowTier;
      readonly taskDescription: string;
      readonly planFiles: readonly string[];
      readonly maxRetries?: number;
      readonly actorId: string;
    }): ValidationResult<WorkflowRunState>;
    loadRunState(runId: string): ValidationResult<WorkflowRunState>;
    saveRunState(
      state: WorkflowRunState,
      actorId: string,
      reason: string,
    ): ValidationResult<WorkflowRunState>;
    registerArtifactAuthor(
      runId: string,
      kind: 'plan' | 'code',
      actorId: string,
    ): ValidationResult<WorkflowRunState>;
    recordReview(review: AgentReviewRecord): ValidationResult<AgentReviewRecord>;
    listReviews(runId: string, gateId?: GateId): readonly AgentReviewRecord[];
    recordGateDecision(record: GateDecisionRecord): ValidationResult<string>; // returns relative evidence path
    getLatestGateDecision(runId: string, gateId: GateId): GateDecisionRecord | undefined;
    listGateDecisions(runId: string, gateId?: GateId): readonly GateDecisionRecord[];
    readAuditLog(runId: string): readonly AuditLogEntry[];
  }
  ```

- [ ] **Step 1: Write failing `evidence-store.test.ts` (Review Focus #1 & #2)**

Create `packages/gates/src/store/evidence-store.test.ts` testing:

- `initRun` creates `.donaron/runs/<runId>/state.json` and appends `WORKFLOW_STARTED` to `audit.jsonl`.
- `recordGateDecision` writes immutable sequentially numbered files (`evidence/GATE_01-001.json`, `evidence/GATE_01-002.json`), preserving rework history so `listGateDecisions` returns all attempts while `getLatestGateDecision` returns the most recent.
- `evaluateRecordFreshness`:
  - `GATE_01` is `FRESH` when `record.planHash === hashes.planHash` (even if `codeHash` changed!), `STALE` when `planHash` differs.
  - `GATE_02`..`GATE_04` are `FRESH` when `record.codeHash === hashes.codeHash`, `STALE` when `codeHash` differs.
  - `GATE_05` requires BOTH `planHash` and `codeHash` to match.
- **Anti-self-approval (Review Focus #2):**
  - After `registerArtifactAuthor(runId, 'plan', 'planner-1')`, calling `recordReview` for `GATE_01` with `evaluator.id === 'planner-1'` fails with code `'SELF_APPROVAL_FORBIDDEN'` and logs `REVIEW_REJECTED` to `audit.jsonl`.
  - After `registerArtifactAuthor(runId, 'code', 'developer-1')`, calling `recordReview` for `GATE_02`, `GATE_03`, or `GATE_05` with `evaluator.id === 'developer-1'` fails with `'SELF_APPROVAL_FORBIDDEN'`.
  - Role check: `recordReview` rejects `role: 'reviewer'` on `GATE_05` (which requires `'code-reviewer'` or `'human'`) with `'UNAUTHORIZED_REVIEWER_ROLE'`.
- **Audit secret redaction:** Any secret token (`sk-ant-...`, `ghp_...`, `password`) inside `taskDescription` or audit `details` is scrubbed to `[REDACTED]` in `audit.jsonl` on disk.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/store/evidence-store.test.ts`
Expected: FAIL because `evidence-store.ts` does not exist.

- [ ] **Step 3: Implement `packages/gates/src/store/evidence-store.ts`**

Store files safely under `<workspaceRoot>/.donaron/runs/<runId>/`, enforce anti-self-approval and per-gate role allowlists in `recordReview`, and pass all persisted audit entries through `@donaron/core`'s `redactObject` / `redactSecrets`.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/gates/src/store/evidence-store.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(gates): add immutable evidence store, freshness checks, and anti-self-approval ledger"`

---

### Task 3: Gate 01 (Planning Document Review) & Gate 02 (Pre-Test Code Review) Evaluators

**Files:**

- Create: `packages/gates/src/evaluators/gate01-planning.ts`
- Create: `packages/gates/src/evaluators/gate02-pretest.ts`
- Test: `packages/gates/src/evaluators/evaluators.test.ts` (part 1: Gates 01 & 02)

**Interfaces:**

- Consumes: `EvidenceStore`, `computePlanHash`, `computeCodeHash`, `GateDecisionRecord`, `GateCheckResult`, `GateFinding`
- Produces:

  ```ts
  export interface Gate01Input {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly store: EvidenceStore;
  }
  export function evaluateGate01Planning(input: Gate01Input): GateDecisionRecord;

  export interface PretestCheckRunner {
    runTypecheck(workspaceRoot: string): { readonly passed: boolean; readonly output: string };
    runLint(workspaceRoot: string): { readonly passed: boolean; readonly output: string };
  }
  export interface Gate02Input {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly store: EvidenceStore;
    readonly runner: PretestCheckRunner;
  }
  export function evaluateGate02Pretest(input: Gate02Input): GateDecisionRecord;
  ```

- [ ] **Step 1: Write failing tests for Gate 01 and Gate 02 in `evaluators.test.ts`**

Test Gate 01:

- Passes (`decision: 'PASS'`) when all declared `planFiles` exist with non-empty sections for `Requirements`, `Specification`, `Architecture`, `Task Plan`, and `Acceptance Criteria`, AND fresh (`planHash`-matching) approved review records exist from BOTH `intake-reviewer` and `solutions-architect` (OR a single `human` review record).
- Fails (`decision: 'FAIL'`) when a required planning section is missing or empty, when only `intake-reviewer` approved without `solutions-architect`, when review `planHash` is stale (plan file edited after review), or when review has any `critical`/`high` finding.

Test Gate 02:

- Passes (`decision: 'PASS'`) when `runner.runTypecheck` and `runner.runLint` both pass AND a fresh (`codeHash`-matching) approved review from `reviewer`, `code-reviewer`, or `human` exists with zero `critical`/`high` findings.
- Fails (`decision: 'FAIL'`) when typecheck fails, lint fails, review is missing/stale (`codeHash` mismatch), or review contains a `high`/`critical` finding.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts`
Expected: FAIL because `gate01-planning.ts` and `gate02-pretest.ts` do not exist.

- [ ] **Step 3: Implement `gate01-planning.ts` and `gate02-pretest.ts`**

Persist every generated `GateDecisionRecord` into `input.store.recordGateDecision(record)` and return it; fail closed (`FAIL`) if run state or hashes cannot be computed.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(gates): add Gate 01 planning and Gate 02 pre-test code review evaluators"`

---

### Task 4: Gate 03 (Security Review — Secret Scanner, Audit Parser & Pinned OWASP Checklists)

**Files:**

- Create: `packages/gates/src/evaluators/gate03-security.ts`
- Modify: `packages/gates/src/evaluators/evaluators.test.ts` (add Gate 03 tests)

**Interfaces:**

- Consumes: `EvidenceStore`, `computeCodeHash`, `GateDecisionRecord`, `GateFinding`
- Produces (`packages/gates/src/evaluators/gate03-security.ts`):

  ```ts
  export const PINNED_OWASP_TOP_10_VERSION = 'OWASP-Top-10:2021';
  export const PINNED_OWASP_LLM_TOP_10_VERSION = 'OWASP-LLM-Top-10:2025';

  export interface DependencyAuditSummary {
    readonly executed: boolean;
    readonly offlineWaiverReason?: string;
    readonly criticalCount: number;
    readonly highCount: number;
    readonly moderateCount: number;
    readonly lowCount: number;
  }

  export interface Gate03Input {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly store: EvidenceStore;
    readonly auditReportJson?: string;
    readonly auditSummary?: DependencyAuditSummary;
    readonly forceAiChecklist?: boolean;
    readonly requireOwaspReview?: boolean; // defaults to true in strict mode, false in standard/quick auto-only checks
  }

  export function scanWorkspaceForSecrets(workspaceRoot: string): readonly GateFinding[];
  export function detectAiApplication(workspaceRoot: string): boolean;
  export function parseDependencyAuditJson(
    rawJson: string,
  ): ValidationResult<DependencyAuditSummary>;
  export function evaluateGate03Security(input: Gate03Input): GateDecisionRecord;
  ```

- [ ] **Step 1: Write failing tests for Gate 03 in `evaluators.test.ts`**

Test Gate 03:

- `scanWorkspaceForSecrets` detects hardcoded OpenAI/Anthropic (`sk-...`/`sk-ant-...`), AWS (`AKIA...`), GitHub (`ghp_...`), Google (`AIza...`), PEM private keys, and tracked `.env` files (while ignoring `.env.example`, `.donaron/`, `node_modules/`, `dist/`, `coverage/`) and emits `severity: 'critical'` findings with file & line number.
- `detectAiApplication` returns `true` when `package.json` depends on `openai`, `@anthropic-ai/sdk`, `@google/genai`, `ai`, `@ai-sdk/*`, or `langchain`, and `false` otherwise.
- `parseDependencyAuditJson` parses both npm/pnpm `metadata.vulnerabilities` format (`{ metadata: { vulnerabilities: { critical, high, moderate, low } } }`) and advisories map format; returns validation error on malformed JSON.
- `evaluateGate03Security`:
  - Passes (`PASS`) when 0 secrets found, 0 `critical`/`high` dependency vulnerabilities (moderate/low logged as warnings), AND fresh (`codeHash`-matching) OWASP review from `reviewer`/`code-reviewer`/`human` includes `OWASP-Top-10:2021` (plus `OWASP-LLM-Top-10:2025` when `detectAiApplication` or `forceAiChecklist` is true) and non-empty `scope` and `limitations` fields.
  - Fails (`FAIL`) with `critical` finding when any secret or `critical` CVE is present.
  - Fails (`FAIL`) with `high` finding when `highCount > 0`.
  - Returns `BLOCKED` when dependency audit was not executed (`executed: false`) and no `offlineWaiverReason` is provided.
  - Fails (`FAIL`) when OWASP review omits required `OWASP-LLM-Top-10:2025` on an AI repo or omits `scope`/`limitations`.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts`
Expected: FAIL because `gate03-security.ts` does not exist.

- [ ] **Step 3: Implement `packages/gates/src/evaluators/gate03-security.ts`**

Implement deterministic workspace secret scanner (ignoring binary files, `.donaron/`, `node_modules/`, `dist/`, `coverage/`, `.git/`, `.env.example`, and optional `.donaronignore` lines), dependency audit JSON parser, AI SDK detector, and pinned OWASP checklist verification. Persist decision via `store.recordGateDecision`.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(gates): add Gate 03 security evaluator with secret scanner, audit parser, and OWASP checks"`

---

### Task 5: Gate 04 (Testing & Per-Package ≥70% Coverage) & Gate 05 (Final Sign-Off) Evaluators

**Files:**

- Create: `packages/gates/src/evaluators/gate04-testing.ts`
- Create: `packages/gates/src/evaluators/gate05-signoff.ts`
- Modify: `packages/gates/src/evaluators/evaluators.test.ts` (add Gate 04 & Gate 05 tests)

**Interfaces:**

- Consumes: `EvidenceStore`, `computePlanHash`, `computeCodeHash`, `computeWorkspaceHashes`, `evaluateRecordFreshness`, `GateDecisionRecord`
- Produces (`gate04-testing.ts` & `gate05-signoff.ts`):

  ```ts
  export interface CoverageThresholds {
    readonly lines: number;
    readonly statements: number;
    readonly functions: number;
    readonly branches: number;
  }

  export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
    lines: 70,
    statements: 70,
    functions: 70,
    branches: 70,
  };

  export interface ParsedTestRun {
    readonly totalTests: number;
    readonly passedTests: number;
    readonly failedTests: number;
    readonly skippedTests: number;
  }

  export interface TestRunnerParser {
    readonly name: string;
    parseTestResults(rawJson: string): ValidationResult<ParsedTestRun>;
  }

  export const vitestRunnerParser: TestRunnerParser;

  export interface Gate04Input {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly store: EvidenceStore;
    readonly testResultsPath?: string; // defaults to "coverage/test-results.json" if testRun not passed
    readonly testRun?: ParsedTestRun;
    readonly coverageSummaryPath?: string; // defaults to "coverage/coverage-summary.json"
    readonly thresholds?: CoverageThresholds;
    readonly requiredPackages?: readonly string[]; // e.g. ["packages/core", "packages/gates"]
    readonly allowSkippedTests?: boolean;
    readonly parser?: TestRunnerParser;
  }

  export function evaluateGate04Testing(input: Gate04Input): GateDecisionRecord;

  export interface Gate05Input {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly store: EvidenceStore;
  }

  export function evaluateGate05Signoff(input: Gate05Input): GateDecisionRecord;
  ```

- [ ] **Step 1: Write failing tests for Gate 04 and Gate 05 in `evaluators.test.ts` (Review Focus #3 & #4)**

Test Gate 04:

- Passes (`PASS`) when `totalTests > 0`, `failedTests === 0`, `skippedTests === 0`, and `coverage-summary.json` meets ≥70% across `lines`, `statements`, `functions`, and `branches` both globally and across every package in `requiredPackages`.
- **Monorepo per-package check (Review Focus #4):** Fails (`FAIL`) when `total` is 85% across all 4 metrics, `packages/core` is 95%, but `packages/gates` has 65% branch coverage!
- Fails closed (`FAIL`) when `coverage-summary.json` is missing, malformed, has 0 tests, has failed tests, or has skipped tests (when `allowSkippedTests` is false/omitted).
- `vitestRunnerParser.parseTestResults` parses Vitest JSON reporter output (`numTotalTests`, `numPassedTests`, `numFailedTests`, `numPendingTests` + `numTodoTests`).

Test Gate 05:

- Passes (`PASS`) in `strict` mode only when Gate 01 has fresh `PASS` (`planHash` matches), Gates 02, 03, and 04 all have fresh `PASS` (`codeHash` matches), AND a fresh (`codeHash`-matching) independent `code-reviewer` (or `human`) review record exists with zero `critical`/`high` findings.
- **Stale evidence rejection (Review Focus #3):** Fails (`FAIL`) if a source or test file was edited after Gate 02, 03, or 04 passed (causing `codeHash` mismatch), or if a plan file was edited after Gate 01 passed (`planHash` mismatch).

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts`
Expected: FAIL because `gate04-testing.ts` and `gate05-signoff.ts` do not exist.

- [ ] **Step 3: Implement `gate04-testing.ts` and `gate05-signoff.ts`**

In `gate04-testing.ts`, parse `coverage-summary.json`, verify `total` metrics ≥ thresholds, and for each `pkgPrefix` in `requiredPackages` aggregate `covered / total` across all file entries matching `<pkgPrefix>/src/` (failing closed if a required package has 0 matched files or <threshold on any of the 4 metrics). In `gate05-signoff.ts`, check freshness of required prior gates for the run's `tier` (`strict`: 01–04; `standard`: 01, 03, 04; `quick`: 03, 04) + independent `code-reviewer`/`human` sign-off.

- [ ] **Step 4: Verify green and commit**

Run: `.\node_modules\.bin\vitest.cmd run packages/gates/src/evaluators/evaluators.test.ts` and `tsc --build && tsc -p tsconfig.typecheck.json --noEmit && eslint . && prettier --check .`
Commit: `git add -A && git commit -m "feat(gates): add Gate 04 per-package coverage evaluator and Gate 05 final sign-off"`

---

### Task 6: Workflow Orchestrator State Machine, TTY Overrides, `Stop` Hook Helper, Barrel Exports, Security Suite & Phase 3 Docs

**Files:**

- Create: `packages/gates/src/orchestrator/workflow-orchestrator.ts`
- Test: `packages/gates/src/orchestrator/workflow-orchestrator.test.ts`
- Test: `packages/gates/src/__tests__/gate-security.test.ts`
- Modify: `packages/gates/src/index.ts`
- Create: `docs/gates-and-workflows.md`
- Create: `docs/superpowers/plans/2026-11-19-phase-3-gate-engine.md` (copied from this plan)
- Modify: `README.md` (mark Phase 3 Implemented)

**Interfaces:**

- Produces (`packages/gates/src/orchestrator/workflow-orchestrator.ts`):

  ```ts
  export interface StartWorkflowOptions {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly taskDescription: string;
    readonly planFiles: readonly string[];
    readonly actorType: 'agent' | 'human';
    readonly actorId: string;
    readonly tier?: WorkflowTier; // defaults to 'strict'; non-'strict' requires actorType === 'human'
    readonly maxRetries?: number; // defaults to 3
  }

  export interface OverrideGateOptions {
    readonly workspaceRoot: string;
    readonly runId: string;
    readonly gateId: GateId;
    readonly actorType: 'agent' | 'human';
    readonly approver: string;
    readonly reason: string;
    readonly isInteractiveTty: boolean;
    readonly confirmed: boolean;
  }

  export interface StopHookGateContext {
    readonly workspaceRoot: string;
    readonly runId?: string;
    readonly terminationReason: string;
    readonly continuationActive: boolean;
  }

  export interface StopHookGateDecision {
    readonly decision: 'allow_stop' | 'continue';
    readonly reason?: string;
  }

  export class WorkflowOrchestrator {
    readonly store: EvidenceStore;
    constructor(workspaceRoot: string);
    startWorkflow(options: StartWorkflowOptions): ValidationResult<WorkflowRunState>;
    transitionState(
      runId: string,
      targetState: WorkflowState,
      actorId: string,
    ): ValidationResult<WorkflowRunState>;
    handleGateResult(
      runId: string,
      record: GateDecisionRecord,
      actorId: string,
    ): ValidationResult<WorkflowRunState>;
    overrideGate(options: OverrideGateOptions): ValidationResult<GateDecisionRecord>;
    evaluateStopHookGate(context: StopHookGateContext): StopHookGateDecision;
  }
  ```

- [ ] **Step 1: Write failing `workflow-orchestrator.test.ts` and `gate-security.test.ts` (Review Focus #2, #3, #5)**

Test in `workflow-orchestrator.test.ts`:

- `startWorkflow` defaults to `tier: 'strict'`, initializes at `'INTAKE'` (or `'IMPLEMENTATION'` for `quick`), writes `.donaron/active-run.json` pointer, and rejects an `'agent'` attempting to start with `tier: 'standard'` or `'quick'` (`TIER_DOWNGRADE_FORBIDDEN`).
- Legal transitions in `strict` mode: blocks `PLANNING -> IMPLEMENTATION` or `GATE_01 -> IMPLEMENTATION` until `GATE_01` has fresh `PASS` evidence (`planHash` match); blocks progression past `GATE_02`, `GATE_03`, `GATE_04`, `GATE_05` without fresh `PASS` evidence (`codeHash` match); reaches `COMPLETED` only after `GATE_05` passes.
- **Test-modification rework routing (Review Focus #3):** If tests or code are modified during `TESTING` (changing `codeHash` after `GATE_02`/`GATE_03` passed), attempting to transition to `GATE_04` or `FINAL_REVIEW` detects stale `GATE_02`/`GATE_03` evidence and routes back to `'PRE_TEST_REVIEW'`.
- **Bounded rework & retry cap:** Failed `GATE_01` routes back to `'PLANNING'`; failed `GATE_02`..`GATE_05` routes back to `'IMPLEMENTATION'` and increments `retryCounts[gateId]`; on the 3rd failure (`maxRetries: 3`), transitions state to `'NEEDS_HUMAN_APPROVAL'` / `'BLOCKED'`.
- **TTY-gated `overrideGate` (Review Focus #5):**
  - Succeeds for `actorType: 'human'`, `isInteractiveTty: true`, `confirmed: true`, valid `approver` & `reason` (≥10 chars) on a `high` Gate 03 finding or Gate 01/02/04/05 failure, writing an override `PASS` record + audit entry.
  - Rejects `actorType: 'agent'`, `isInteractiveTty: false`, `confirmed: false`, short reason, or any Gate 03 failure containing a `critical` finding (`CRITICAL_SECURITY_NON_OVERRIDABLE`).
- **`evaluateStopHookGate` (Choice 2A & Review Focus #5):**
  - Returns `{ decision: 'allow_stop' }` when no `.donaron/active-run.json` exists in `workspaceRoot`.
  - Returns `{ decision: 'allow_stop' }` when `continuationActive === true`, when `terminationReason !== 'NO_TOOL_CALL'`, or when state is `'INTAKE' | 'PLANNING' | 'GATE_01' | 'NEEDS_HUMAN_APPROVAL' | 'BLOCKED' | 'COMPLETED'`.
  - Returns `{ decision: 'continue', reason: ... }` when state is in `'IMPLEMENTATION'..'GATE_05'` and required gates lack fresh `PASS` evidence.

Test in `packages/gates/src/__tests__/gate-security.test.ts` (importing exclusively through `../index.js` public barrel):

- End-to-end bypass attempts (unapproved `IMPLEMENTATION` transition, self-approval at Gates 01/02/05, stale `codeHash` after post-review edit, agent override attempt, critical secret override attempt, fabricated 0-test or <70% per-package coverage attempt) all fail closed.

- [ ] **Step 2: Run vitest to confirm RED**

Run (sandbox): `.\node_modules\.bin\vitest.cmd run packages/gates/src/orchestrator/workflow-orchestrator.test.ts packages/gates/src/__tests__/gate-security.test.ts`
Expected: FAIL because `workflow-orchestrator.ts` and barrel exports do not exist.

- [ ] **Step 3: Implement `workflow-orchestrator.ts`, update `packages/gates/src/index.ts`, and author Phase 3 docs**

- Implement `packages/gates/src/orchestrator/workflow-orchestrator.ts`.
- Update `packages/gates/src/index.ts` re-exporting all Phase 3 types, hashing functions, `EvidenceStore`, all 5 gate evaluators, and `WorkflowOrchestrator` while preserving `DONARON_GATES_VERSION` and `getGatesModuleInfo()`.
- Author `docs/gates-and-workflows.md`, copy this plan to `docs/superpowers/plans/2026-11-19-phase-3-gate-engine.md`, and update `README.md` status table (Phases 1–3 Implemented, Phases 4–7 Planned).

- [ ] **Step 4: Run complete Phase 3 clean green-bar check**

Run: `pnpm run clean && pnpm run check`
And verify `coverage/coverage-summary.json` reports ≥70% across `lines`, `statements`, `functions`, and `branches` both overall and across `packages/gates/src/**`.
Expected: Exit `0`, all tests green, zero lint/typecheck/Prettier errors.

- [ ] **Step 5: Commit Task 6**

Run: `git add -A && git commit -m "feat(gates): add strict workflow orchestrator, TTY override, Stop hook guard, and Phase 3 docs"`
Expected: clean working tree on `phase-3/gate-engine`.
