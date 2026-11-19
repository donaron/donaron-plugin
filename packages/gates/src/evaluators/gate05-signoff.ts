import { computeCodeHash, computePlanHash } from '../hashing/scoped-hash.js';
import { evaluateRecordFreshness, type EvidenceStore } from '../store/evidence-store.js';
import type { GateCheckResult, GateDecisionRecord, GateFinding, GateId } from '../types.js';

export interface Gate05Input {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly store: EvidenceStore;
}

const REQUIRED_PRIOR_GATES_BY_TIER: Readonly<
  Record<'strict' | 'standard' | 'quick', readonly GateId[]>
> = {
  strict: ['GATE_01', 'GATE_02', 'GATE_03', 'GATE_04'],
  standard: ['GATE_01', 'GATE_03', 'GATE_04'],
  quick: ['GATE_03', 'GATE_04'],
};

export function evaluateGate05Signoff(input: Gate05Input): GateDecisionRecord {
  const now = new Date().toISOString();
  const stateResult = input.store.loadRunState(input.runId);
  if (!stateResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_05',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate05-signoff' },
      checks: [{ name: 'run-state', passed: false, summary: 'Workflow run state not found.' }],
      evidenceRefs: [],
      findings: stateResult.issues.map((i, idx) => ({
        id: `gate05-state-${String(idx + 1)}`,
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
      gateId: 'GATE_05',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate05-signoff' },
      checks: [{ name: 'code-hash', passed: false, summary: 'Failed to compute codeHash.' }],
      evidenceRefs: [],
      findings: codeHashResult.issues.map((i, idx) => ({
        id: `gate05-codehash-${String(idx + 1)}`,
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

  let planHash: string | undefined;
  if (state.tier !== 'quick') {
    const planHashResult = computePlanHash(input.workspaceRoot, state.planFiles);
    if (!planHashResult.ok) {
      const failRecord: GateDecisionRecord = {
        gateId: 'GATE_05',
        gateVersion: '1.0.0',
        runId: input.runId,
        codeHash: codeHashResult.value.codeHash,
        evaluator: { type: 'deterministic', id: 'gate05-signoff' },
        checks: [{ name: 'plan-hash', passed: false, summary: 'Failed to compute planHash.' }],
        evidenceRefs: [],
        findings: planHashResult.issues.map((i, idx) => ({
          id: `gate05-planhash-${String(idx + 1)}`,
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
    planHash = planHashResult.value;
  }

  const { codeHash } = codeHashResult.value;
  const checks: GateCheckResult[] = [];
  const findings: GateFinding[] = [];
  const requiredPriorGates = REQUIRED_PRIOR_GATES_BY_TIER[state.tier];

  for (const priorGateId of requiredPriorGates) {
    const latestPrior = input.store.getLatestGateDecision(input.runId, priorGateId);
    const freshness = evaluateRecordFreshness(latestPrior, {
      ...(planHash !== undefined ? { planHash } : {}),
      codeHash,
    });
    const isFresh = freshness === 'FRESH';
    checks.push({
      name: `prior-gate:${priorGateId}`,
      passed: isFresh,
      summary: isFresh
        ? `Prior gate ${priorGateId} has fresh PASS evidence.`
        : `Prior gate ${priorGateId} is ${freshness} against current workspace hashes.`,
    });
    if (!isFresh) {
      findings.push({
        id: `gate05-prior-${priorGateId.toLowerCase()}`,
        severity: 'high',
        message: `Required prior gate ${priorGateId} is ${freshness} (must be FRESH PASS for current revision).`,
        ruleId: 'PRIOR_GATE_NOT_FRESH',
      });
    }
  }

  const freshReviews = input.store
    .listReviews(input.runId, 'GATE_05')
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
    name: 'final-code-review-signoff',
    passed: reviewPassed,
    summary: reviewPassed
      ? `Final code review sign-off approved by ${latestReview.evaluator.id}.`
      : 'Missing or unapproved fresh final code review sign-off for current codeHash.',
  });

  if (!reviewPassed) {
    findings.push({
      id: 'gate05-missing-signoff',
      severity: 'high',
      message:
        'Gate 05 requires a fresh approved sign-off from code-reviewer (or human) for current codeHash.',
      ruleId: 'FINAL_REVIEW_SIGNOFF_REQUIRED',
    });
  }

  const hasBlockingFinding = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const allChecksPassed = checks.every((c) => c.passed);

  const record: GateDecisionRecord = {
    gateId: 'GATE_05',
    gateVersion: '1.0.0',
    runId: input.runId,
    ...(planHash !== undefined ? { planHash } : {}),
    codeHash,
    evaluator: { type: 'deterministic', id: 'gate05-signoff' },
    checks,
    evidenceRefs: [],
    findings,
    decision: allChecksPassed && !hasBlockingFinding ? 'PASS' : 'FAIL',
    timestamp: now,
  };

  input.store.recordGateDecision(record);
  return record;
}
