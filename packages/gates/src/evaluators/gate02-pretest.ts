import { computeCodeHash } from '../hashing/scoped-hash.js';
import type { EvidenceStore } from '../store/evidence-store.js';
import type { GateCheckResult, GateDecisionRecord, GateFinding } from '../types.js';

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

export function evaluateGate02Pretest(input: Gate02Input): GateDecisionRecord {
  const now = new Date().toISOString();
  const stateResult = input.store.loadRunState(input.runId);
  if (!stateResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_02',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate02-pretest' },
      checks: [{ name: 'run-state', passed: false, summary: 'Workflow run state not found.' }],
      evidenceRefs: [],
      findings: stateResult.issues.map((i, idx) => ({
        id: `gate02-state-${String(idx + 1)}`,
        severity: 'critical',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const state = stateResult.value;
  const codeHashResult = computeCodeHash(input.workspaceRoot, { planFiles: state.planFiles });
  if (!codeHashResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_02',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate02-pretest' },
      checks: [{ name: 'code-hash', passed: false, summary: 'Failed to compute codeHash.' }],
      evidenceRefs: [],
      findings: codeHashResult.issues.map((i, idx) => ({
        id: `gate02-hash-${String(idx + 1)}`,
        severity: 'high',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const { codeHash } = codeHashResult.value;
  const checks: GateCheckResult[] = [];
  const findings: GateFinding[] = [];

  let typecheckRes: { readonly passed: boolean; readonly output: string };
  try {
    typecheckRes = input.runner.runTypecheck(input.workspaceRoot);
  } catch (error: unknown) {
    typecheckRes = {
      passed: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push({
    name: 'typecheck',
    passed: typecheckRes.passed,
    summary: typecheckRes.passed ? 'Compilation / typecheck passed.' : 'Typecheck failed.',
    details: { output: typecheckRes.output },
  });
  if (!typecheckRes.passed) {
    findings.push({
      id: 'gate02-typecheck-failed',
      severity: 'high',
      message: `Compilation / typecheck failed: ${typecheckRes.output}`,
      ruleId: 'TYPECHECK_FAILED',
    });
  }

  let lintRes: { readonly passed: boolean; readonly output: string };
  try {
    lintRes = input.runner.runLint(input.workspaceRoot);
  } catch (error: unknown) {
    lintRes = {
      passed: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push({
    name: 'lint',
    passed: lintRes.passed,
    summary: lintRes.passed ? 'Linter check passed.' : 'Linter check failed.',
    details: { output: lintRes.output },
  });
  if (!lintRes.passed) {
    findings.push({
      id: 'gate02-lint-failed',
      severity: 'high',
      message: `Linter check failed: ${lintRes.output}`,
      ruleId: 'LINT_FAILED',
    });
  }

  const freshReviews = input.store
    .listReviews(input.runId, 'GATE_02')
    .filter((r) => r.codeHash === codeHash);
  const latestReview = freshReviews[freshReviews.length - 1];

  if (latestReview !== undefined) {
    for (const f of latestReview.findings) {
      findings.push(f);
    }
  }

  const reviewPassed =
    latestReview !== undefined &&
    latestReview.approved &&
    !latestReview.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

  checks.push({
    name: 'pretest-code-review',
    passed: reviewPassed,
    summary: reviewPassed
      ? `Independent pre-test code review approved by ${latestReview.evaluator.id}.`
      : 'Missing or unapproved fresh pre-test code review for current codeHash.',
  });

  if (!reviewPassed) {
    findings.push({
      id: 'gate02-missing-review',
      severity: 'high',
      message: 'Gate 02 requires a fresh approved pre-test code review for current codeHash.',
      ruleId: 'PRETEST_REVIEW_REQUIRED',
    });
  }

  const hasBlockingFinding = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const allChecksPassed = checks.every((c) => c.passed);

  const record: GateDecisionRecord = {
    gateId: 'GATE_02',
    gateVersion: '1.0.0',
    runId: input.runId,
    codeHash,
    evaluator: { type: 'deterministic', id: 'gate02-pretest' },
    checks,
    evidenceRefs: [],
    findings,
    decision: allChecksPassed && !hasBlockingFinding ? 'PASS' : 'FAIL',
    timestamp: now,
  };

  input.store.recordGateDecision(record);
  return record;
}
