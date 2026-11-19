import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentReviewRecord, GateDecisionRecord } from '../types.js';
import { EvidenceStore, evaluateRecordFreshness } from './evidence-store.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-evidence-store-')));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('EvidenceStore & evaluateRecordFreshness', () => {
  it('initializes workflow run state, sets activeRunId, and rejects invalid runId', () => {
    const root = createTempWorkspace();
    const store = new EvidenceStore(root);

    expect(
      store.initRun({
        runId: '../bad-run',
        tier: 'strict',
        taskDescription: 'Invalid run',
        planFiles: ['docs/plan.md'],
        actorId: 'user-1',
      }).ok,
    ).toBe(false);

    const initResult = store.initRun({
      runId: 'run-001',
      tier: 'strict',
      taskDescription: 'Implement login feature',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) return;

    expect(initResult.value.state).toBe('INTAKE');
    expect(initResult.value.maxRetries).toBe(3);
    expect(store.getActiveRunId()).toBe('run-001');

    const loaded = store.loadRunState('run-001');
    expect(loaded).toEqual(initResult);
  });

  it('stores immutable sequentially numbered gate decision files preserving rework history', () => {
    const root = createTempWorkspace();
    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-002',
      tier: 'strict',
      taskDescription: 'Feature X',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-002',
      planHash: 'sha256:aaa',
      evaluator: { type: 'deterministic', id: 'gate01' },
      checks: [{ name: 'sections', passed: false, summary: 'Missing Acceptance Criteria' }],
      evidenceRefs: ['docs/plan.md'],
      findings: [{ id: 'f1', severity: 'high', message: 'Missing section' }],
      decision: 'FAIL',
      timestamp: '2026-11-19T00:00:00.000Z',
    };

    const passRecord: GateDecisionRecord = {
      ...failRecord,
      planHash: 'sha256:bbb',
      checks: [{ name: 'sections', passed: true, summary: 'All sections present' }],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:05:00.000Z',
    };

    const ref1 = store.recordGateDecision(failRecord);
    const ref2 = store.recordGateDecision(passRecord);
    expect(ref1).toEqual({
      ok: true,
      value: '.donaron/runs/run-002/evidence/GATE_01-001.json',
    });
    expect(ref2).toEqual({
      ok: true,
      value: '.donaron/runs/run-002/evidence/GATE_01-002.json',
    });

    expect(store.listGateDecisions('run-002', 'GATE_01')).toHaveLength(2);
    expect(store.getLatestGateDecision('run-002', 'GATE_01')?.decision).toBe('PASS');
    expect(store.getLatestGateDecision('run-002', 'GATE_01')?.planHash).toBe('sha256:bbb');
  });

  it('evaluates record freshness orthogonally across planHash and codeHash', () => {
    const baseRecord: GateDecisionRecord = {
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-003',
      planHash: 'sha256:plan1',
      evaluator: { type: 'deterministic', id: 'gate01' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    };

    expect(
      evaluateRecordFreshness(undefined, { planHash: 'sha256:plan1', codeHash: 'sha256:code1' }),
    ).toBe('MISSING');
    expect(
      evaluateRecordFreshness(
        { ...baseRecord, decision: 'FAIL' },
        { planHash: 'sha256:plan1', codeHash: 'sha256:code1' },
      ),
    ).toBe('FAILED');

    // GATE_01 stays FRESH when codeHash changes as long as planHash matches
    expect(
      evaluateRecordFreshness(baseRecord, { planHash: 'sha256:plan1', codeHash: 'sha256:code999' }),
    ).toBe('FRESH');
    expect(
      evaluateRecordFreshness(baseRecord, { planHash: 'sha256:plan2', codeHash: 'sha256:code999' }),
    ).toBe('STALE');

    // GATE_02..04 depend on codeHash
    const gate02Record: GateDecisionRecord = {
      ...baseRecord,
      gateId: 'GATE_02',
      codeHash: 'sha256:code1',
    };
    expect(
      evaluateRecordFreshness(gate02Record, {
        planHash: 'sha256:plan999',
        codeHash: 'sha256:code1',
      }),
    ).toBe('FRESH');
    expect(
      evaluateRecordFreshness(gate02Record, { planHash: 'sha256:plan1', codeHash: 'sha256:code2' }),
    ).toBe('STALE');

    // GATE_05 requires BOTH planHash (when present) and codeHash to match
    const gate05Record: GateDecisionRecord = {
      ...baseRecord,
      gateId: 'GATE_05',
      planHash: 'sha256:plan1',
      codeHash: 'sha256:code1',
    };
    expect(
      evaluateRecordFreshness(gate05Record, { planHash: 'sha256:plan1', codeHash: 'sha256:code1' }),
    ).toBe('FRESH');
    expect(
      evaluateRecordFreshness(gate05Record, { planHash: 'sha256:plan2', codeHash: 'sha256:code1' }),
    ).toBe('STALE');
    expect(
      evaluateRecordFreshness(gate05Record, { planHash: 'sha256:plan1', codeHash: 'sha256:code2' }),
    ).toBe('STALE');
  });

  it('enforces anti-self-approval and role allowlists on agent reviews', () => {
    const root = createTempWorkspace();
    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-004',
      tier: 'strict',
      taskDescription: 'Auth workflow',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    store.registerArtifactAuthor('run-004', 'plan', 'planner-agent');
    store.registerArtifactAuthor('run-004', 'code', 'dev-agent');

    // 1. Self-approval on Gate 01 by plan author is rejected
    const selfPlanReview: AgentReviewRecord = {
      gateId: 'GATE_01',
      runId: 'run-004',
      role: 'intake-reviewer',
      evaluator: { type: 'agent', id: 'planner-agent' },
      approved: true,
      summary: 'Looks good to me',
      findings: [],
      planHash: 'sha256:p1',
      timestamp: '2026-11-19T00:00:00.000Z',
    };
    const res1 = store.recordReview(selfPlanReview);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.issues[0]?.code).toBe('SELF_APPROVAL_FORBIDDEN');
    }

    // 2. Self-approval on Gate 02/05 by code implementer is rejected
    const selfCodeReview: AgentReviewRecord = {
      gateId: 'GATE_05',
      runId: 'run-004',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'dev-agent' },
      approved: true,
      summary: 'Self sign-off',
      findings: [],
      codeHash: 'sha256:c1',
      timestamp: '2026-11-19T00:01:00.000Z',
    };
    const res2 = store.recordReview(selfCodeReview);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.issues[0]?.code).toBe('SELF_APPROVAL_FORBIDDEN');
    }

    // 3. Unauthorized role on Gate 05 ('reviewer' instead of 'code-reviewer' or 'human') is rejected
    const wrongRoleReview: AgentReviewRecord = {
      gateId: 'GATE_05',
      runId: 'run-004',
      role: 'reviewer',
      evaluator: { type: 'agent', id: 'independent-reviewer' },
      approved: true,
      summary: 'Wrong role for final gate',
      findings: [],
      codeHash: 'sha256:c1',
      timestamp: '2026-11-19T00:02:00.000Z',
    };
    const res3 = store.recordReview(wrongRoleReview);
    expect(res3.ok).toBe(false);
    if (!res3.ok) {
      expect(res3.issues[0]?.code).toBe('UNAUTHORIZED_REVIEWER_ROLE');
    }

    // 4. Independent code-reviewer succeeds
    const validReview: AgentReviewRecord = {
      ...wrongRoleReview,
      role: 'code-reviewer',
    };
    const res4 = store.recordReview(validReview);
    expect(res4.ok).toBe(true);
    expect(store.listReviews('run-004', 'GATE_05')).toHaveLength(1);
  });

  it('redacts secrets in audit.jsonl before persisting to disk', () => {
    const root = createTempWorkspace();
    const store = new EvidenceStore(root);
    const leakedSecret = 'sk-ant-api03-supersecretvalue1234567890';
    store.initRun({
      runId: 'run-005',
      tier: 'strict',
      taskDescription: `Fix bug with key ${leakedSecret}`,
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const rawAudit = readFileSync(join(root, '.donaron', 'runs', 'run-005', 'audit.jsonl'), 'utf8');
    expect(rawAudit).not.toContain(leakedSecret);
    expect(rawAudit).toContain('[REDACTED]');
    expect(store.readAuditLog('run-005')).toHaveLength(1);
  });
});
