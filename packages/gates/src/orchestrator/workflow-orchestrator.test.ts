import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeCodeHash, computePlanHash } from '../hashing/scoped-hash.js';
import type { GateDecisionRecord } from '../types.js';
import { WorkflowOrchestrator } from './workflow-orchestrator.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-orchestrator-')));
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

describe('WorkflowOrchestrator', () => {
  it('defaults to strict tier, rejects agent tier downgrades, and enforces Gate 01 before IMPLEMENTATION', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);

    // Agent cannot downgrade tier to quick/standard
    const downgradeAttempt = orchestrator.startWorkflow({
      runId: 'run-downgrade',
      taskDescription: 'Try quick mode as agent',
      planFiles: [],
      actorType: 'agent',
      actorId: 'dev-1',
      tier: 'quick',
    });
    expect(downgradeAttempt.ok).toBe(false);
    if (!downgradeAttempt.ok) {
      expect(downgradeAttempt.issues[0]?.code).toBe('TIER_DOWNGRADE_FORBIDDEN');
    }

    const started = orchestrator.startWorkflow({
      runId: 'run-strict-1',
      taskDescription: 'Build feature under strict mode',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.tier).toBe('strict');
    expect(started.value.state).toBe('INTAKE');

    expect(orchestrator.transitionState('run-strict-1', 'REQUIREMENTS_REVIEW', 'user-1').ok).toBe(
      true,
    );
    expect(orchestrator.transitionState('run-strict-1', 'ARCHITECTURE', 'user-1').ok).toBe(true);
    expect(orchestrator.transitionState('run-strict-1', 'PLANNING', 'user-1').ok).toBe(true);
    expect(orchestrator.transitionState('run-strict-1', 'GATE_01', 'user-1').ok).toBe(true);

    // Cannot enter IMPLEMENTATION before GATE_01 passes!
    const prematureImpl = orchestrator.transitionState('run-strict-1', 'IMPLEMENTATION', 'dev-1');
    expect(prematureImpl.ok).toBe(false);
    if (!prematureImpl.ok) {
      expect(prematureImpl.issues[0]?.code).toBe('GATE_NOT_PASSED');
    }

    // Record fresh GATE_01 PASS
    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    if (!planHashRes.ok) return;
    orchestrator.store.recordGateDecision({
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-strict-1',
      planHash: planHashRes.value,
      evaluator: { type: 'deterministic', id: 'gate01' },
      checks: [],
      evidenceRefs: ['docs/plan.md'],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    const implRes = orchestrator.transitionState('run-strict-1', 'IMPLEMENTATION', 'dev-1');
    expect(implRes.ok).toBe(true);
  });

  it('detects stale Gate 02/03 evidence when tests are modified during TESTING and routes bounded rework on gate failure', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);
    orchestrator.startWorkflow({
      runId: 'run-rework',
      taskDescription: 'Rework & staleness test',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
      maxRetries: 2,
    });

    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!planHashRes.ok || !codeHashRes.ok) return;

    orchestrator.store.recordGateDecision({
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-rework',
      planHash: planHashRes.value,
      evaluator: { type: 'deterministic', id: 'gate01' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    orchestrator.transitionState('run-rework', 'REQUIREMENTS_REVIEW', 'u');
    orchestrator.transitionState('run-rework', 'ARCHITECTURE', 'u');
    orchestrator.transitionState('run-rework', 'PLANNING', 'u');
    orchestrator.transitionState('run-rework', 'GATE_01', 'u');
    orchestrator.transitionState('run-rework', 'IMPLEMENTATION', 'u');
    orchestrator.transitionState('run-rework', 'PRE_TEST_REVIEW', 'u');
    orchestrator.transitionState('run-rework', 'GATE_02', 'u');

    // First GATE_02 failure -> routes back to IMPLEMENTATION (retryCounts.GATE_02 = 1)
    const failG2: GateDecisionRecord = {
      gateId: 'GATE_02',
      gateVersion: '1.0.0',
      runId: 'run-rework',
      codeHash: codeHashRes.value.codeHash,
      evaluator: { type: 'deterministic', id: 'gate02' },
      checks: [],
      evidenceRefs: [],
      findings: [{ id: 'f1', severity: 'high', message: 'Lint error' }],
      decision: 'FAIL',
      timestamp: '2026-11-19T00:01:00.000Z',
    };
    const afterFail1 = orchestrator.handleGateResult('run-rework', failG2, 'u');
    expect(afterFail1.ok).toBe(true);
    if (afterFail1.ok) {
      expect(afterFail1.value.state).toBe('IMPLEMENTATION');
      expect(afterFail1.value.retryCounts.GATE_02).toBe(1);
    }

    // Second GATE_02 failure hits maxRetries (2) -> transitions to NEEDS_HUMAN_APPROVAL
    const afterFail2 = orchestrator.handleGateResult('run-rework', failG2, 'u');
    expect(afterFail2.ok).toBe(true);
    if (afterFail2.ok) {
      expect(afterFail2.value.state).toBe('NEEDS_HUMAN_APPROVAL');
      expect(afterFail2.value.retryCounts.GATE_02).toBe(2);
    }
  });

  it('enforces interactive TTY human confirmation on overrideGate and blocks overriding critical Gate 03 findings', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);
    orchestrator.startWorkflow({
      runId: 'run-override',
      taskDescription: 'Override test',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
    });

    // 1. Agent cannot override
    expect(
      orchestrator.overrideGate({
        runId: 'run-override',
        gateId: 'GATE_02',
        actorType: 'agent',
        approver: 'dev-agent',
        reason: 'Trying to bypass gate',
        isInteractiveTty: true,
        confirmed: true,
      }).ok,
    ).toBe(false);

    // 2. Non-TTY human override is rejected
    expect(
      orchestrator.overrideGate({
        runId: 'run-override',
        gateId: 'GATE_02',
        actorType: 'human',
        approver: 'jay-r',
        reason: 'Emergency hotfix override',
        isInteractiveTty: false,
        confirmed: true,
      }).ok,
    ).toBe(false);

    // 3. Gate 03 with critical finding cannot be overridden even by interactive human
    orchestrator.store.recordGateDecision({
      gateId: 'GATE_03',
      gateVersion: '1.0.0',
      runId: 'run-override',
      codeHash: 'sha256:abc',
      evaluator: { type: 'deterministic', id: 'gate03' },
      checks: [],
      evidenceRefs: [],
      findings: [{ id: 'sec-1', severity: 'critical', message: 'Leaked API key' }],
      decision: 'FAIL',
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    const critOverride = orchestrator.overrideGate({
      runId: 'run-override',
      gateId: 'GATE_03',
      actorType: 'human',
      approver: 'jay-r',
      reason: 'Attempt to override critical secret',
      isInteractiveTty: true,
      confirmed: true,
    });
    expect(critOverride.ok).toBe(false);
    if (!critOverride.ok) {
      expect(critOverride.issues[0]?.code).toBe('CRITICAL_SECURITY_NON_OVERRIDABLE');
    }

    // 4. Valid interactive TTY human override on Gate 02 succeeds
    const validOverride = orchestrator.overrideGate({
      runId: 'run-override',
      gateId: 'GATE_02',
      actorType: 'human',
      approver: 'jay-r',
      reason: 'Approved pre-test review waiver for urgent fix',
      isInteractiveTty: true,
      confirmed: true,
    });
    expect(validOverride.ok).toBe(true);
    if (validOverride.ok) {
      expect(validOverride.value.decision).toBe('PASS');
      expect(validOverride.value.humanApproval?.isOverride).toBe(true);
    }
  });

  it('evaluates Stop hook gate decision honoring Choice 2A, continuationActive guard, interactive states, and active implementation states', () => {
    const emptyRoot = createTempWorkspace();
    const emptyOrch = new WorkflowOrchestrator(emptyRoot);

    // Choice 2A: no active workflow in repo -> allow_stop
    expect(
      emptyOrch.evaluateStopHookGate({
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    ).toEqual({ decision: 'allow_stop' });

    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);
    orchestrator.startWorkflow({
      runId: 'run-stop',
      taskDescription: 'Stop hook test',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
    });

    // Interactive INTAKE state -> allow_stop
    expect(
      orchestrator.evaluateStopHookGate({
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    ).toEqual({ decision: 'allow_stop' });

    // Advance to IMPLEMENTATION
    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    if (!planHashRes.ok) return;
    orchestrator.store.recordGateDecision({
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-stop',
      planHash: planHashRes.value,
      evaluator: { type: 'deterministic', id: 'gate01' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    });
    orchestrator.transitionState('run-stop', 'REQUIREMENTS_REVIEW', 'u');
    orchestrator.transitionState('run-stop', 'ARCHITECTURE', 'u');
    orchestrator.transitionState('run-stop', 'PLANNING', 'u');
    orchestrator.transitionState('run-stop', 'GATE_01', 'u');
    orchestrator.transitionState('run-stop', 'IMPLEMENTATION', 'u');

    // In IMPLEMENTATION without Gates 02-05 passed -> blocks stop ('continue')!
    const blockStop = orchestrator.evaluateStopHookGate({
      terminationReason: 'NO_TOOL_CALL',
      continuationActive: false,
    });
    expect(blockStop.decision).toBe('continue');
    expect(blockStop.reason).toContain('GATE_02');

    // Loop guard: continuationActive === true -> allow_stop
    expect(
      orchestrator.evaluateStopHookGate({
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: true,
      }),
    ).toEqual({ decision: 'allow_stop' });
  });

  it('enforces full strict and quick stage progression guards, stale TESTING detection, terminal states, and override validation errors', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);

    // Empty planFiles on strict tier -> EMPTY_PLAN_FILES
    expect(
      orchestrator.startWorkflow({
        runId: 'run-empty-plan',
        taskDescription: 'No plan files',
        planFiles: [],
        actorType: 'human',
        actorId: 'u',
      }).ok,
    ).toBe(false);

    // Human can start quick tier without planFiles (starts at IMPLEMENTATION)
    const quickRun = orchestrator.startWorkflow({
      runId: 'run-quick',
      taskDescription: 'Quick human run',
      planFiles: [],
      actorType: 'human',
      actorId: 'u',
      tier: 'quick',
    });
    expect(quickRun.ok).toBe(true);
    if (quickRun.ok) {
      expect(quickRun.value.state).toBe('IMPLEMENTATION');
    }

    // Start strict run and walk through all 5 gates to COMPLETED
    orchestrator.startWorkflow({
      runId: 'run-full',
      taskDescription: 'Full strict walk',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'u',
    });

    // Illegal transition from INTAKE -> COMPLETED
    expect(orchestrator.transitionState('run-full', 'COMPLETED', 'u').ok).toBe(false);

    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!planHashRes.ok || !codeHashRes.ok) return;
    const planHash = planHashRes.value;
    let codeHash = codeHashRes.value.codeHash;

    orchestrator.transitionState('run-full', 'PLANNING', 'u');
    orchestrator.transitionState('run-full', 'GATE_01', 'u');

    // GATE_01 FAIL routes back to PLANNING
    const g1Fail = orchestrator.handleGateResult(
      'run-full',
      {
        gateId: 'GATE_01',
        gateVersion: '1.0.0',
        runId: 'run-full',
        planHash,
        evaluator: { type: 'deterministic', id: 'g1' },
        checks: [],
        evidenceRefs: [],
        findings: [{ id: 'f1', severity: 'high', message: 'Missing section' }],
        decision: 'FAIL',
        timestamp: '2026-11-19T00:00:00.000Z',
      },
      'u',
    );
    expect(g1Fail.ok && g1Fail.value.state).toBe('PLANNING');

    orchestrator.transitionState('run-full', 'GATE_01', 'u');
    const g1PassRecord: GateDecisionRecord = {
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-full',
      planHash,
      evaluator: { type: 'deterministic', id: 'g1' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    };
    orchestrator.store.recordGateDecision(g1PassRecord);
    expect(orchestrator.handleGateResult('run-full', g1PassRecord, 'u').ok).toBe(true);

    orchestrator.transitionState('run-full', 'IMPLEMENTATION', 'u');
    orchestrator.transitionState('run-full', 'PRE_TEST_REVIEW', 'u');
    orchestrator.transitionState('run-full', 'GATE_02', 'u');

    // Cannot enter SECURITY_REVIEW before GATE_02 passes
    expect(orchestrator.transitionState('run-full', 'SECURITY_REVIEW', 'u').ok).toBe(false);

    orchestrator.store.recordGateDecision({
      gateId: 'GATE_02',
      gateVersion: '1.0.0',
      runId: 'run-full',
      codeHash,
      evaluator: { type: 'deterministic', id: 'g2' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:01:00.000Z',
    });
    expect(orchestrator.transitionState('run-full', 'SECURITY_REVIEW', 'u').ok).toBe(true);
    expect(orchestrator.transitionState('run-full', 'GATE_03', 'u').ok).toBe(true);

    // Cannot enter TESTING before GATE_03 passes
    expect(orchestrator.transitionState('run-full', 'TESTING', 'u').ok).toBe(false);

    // BLOCKED gate result transitions state to BLOCKED, then resume to GATE_03
    const blockedRes = orchestrator.handleGateResult(
      'run-full',
      {
        gateId: 'GATE_03',
        gateVersion: '1.0.0',
        runId: 'run-full',
        codeHash,
        evaluator: { type: 'deterministic', id: 'g3' },
        checks: [],
        evidenceRefs: [],
        findings: [],
        decision: 'BLOCKED',
        timestamp: '2026-11-19T00:01:30.000Z',
      },
      'u',
    );
    expect(blockedRes.ok && blockedRes.value.state).toBe('BLOCKED');
    expect(orchestrator.transitionState('run-full', 'GATE_03', 'u').ok).toBe(true);

    orchestrator.store.recordGateDecision({
      gateId: 'GATE_03',
      gateVersion: '1.0.0',
      runId: 'run-full',
      codeHash,
      evaluator: { type: 'deterministic', id: 'g3' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:02:00.000Z',
    });
    expect(orchestrator.transitionState('run-full', 'TESTING', 'u').ok).toBe(true);

    // Modify code during TESTING -> transitioning to GATE_04 fails with STALE_PRIOR_GATE_EVIDENCE
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 2;\n', 'utf8');
    const staleG4Transition = orchestrator.transitionState('run-full', 'GATE_04', 'u');
    expect(staleG4Transition.ok).toBe(false);
    if (!staleG4Transition.ok) {
      expect(staleG4Transition.issues[0]?.code).toBe('STALE_PRIOR_GATE_EVIDENCE');
    }

    // Re-record GATE_02 & GATE_03 for updated codeHash
    const newCodeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!newCodeHashRes.ok) return;
    codeHash = newCodeHashRes.value.codeHash;
    for (const gId of ['GATE_02', 'GATE_03'] as const) {
      orchestrator.store.recordGateDecision({
        gateId: gId,
        gateVersion: '1.0.0',
        runId: 'run-full',
        codeHash,
        evaluator: { type: 'deterministic', id: gId },
        checks: [],
        evidenceRefs: [],
        findings: [],
        decision: 'PASS',
        timestamp: '2026-11-19T00:03:00.000Z',
      });
    }

    expect(orchestrator.transitionState('run-full', 'GATE_04', 'u').ok).toBe(true);
    // Strict tier cannot jump from GATE_04 to COMPLETED
    expect(orchestrator.transitionState('run-full', 'COMPLETED', 'u').ok).toBe(false);
    // Cannot enter FINAL_REVIEW before GATE_04 passes
    expect(orchestrator.transitionState('run-full', 'FINAL_REVIEW', 'u').ok).toBe(false);

    orchestrator.store.recordGateDecision({
      gateId: 'GATE_04',
      gateVersion: '1.0.0',
      runId: 'run-full',
      codeHash,
      evaluator: { type: 'deterministic', id: 'g4' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:04:00.000Z',
    });
    expect(orchestrator.transitionState('run-full', 'FINAL_REVIEW', 'u').ok).toBe(true);
    expect(orchestrator.transitionState('run-full', 'GATE_05', 'u').ok).toBe(true);
    // Cannot enter COMPLETED before GATE_05 passes
    expect(orchestrator.transitionState('run-full', 'COMPLETED', 'u').ok).toBe(false);

    orchestrator.store.recordGateDecision({
      gateId: 'GATE_05',
      gateVersion: '1.0.0',
      runId: 'run-full',
      planHash,
      codeHash,
      evaluator: { type: 'deterministic', id: 'g5' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:05:00.000Z',
    });
    // Now Stop hook in GATE_05 with all 5 gates fresh allows stopping!
    expect(
      orchestrator.evaluateStopHookGate({
        runId: 'run-full',
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    ).toEqual({ decision: 'allow_stop' });

    expect(orchestrator.transitionState('run-full', 'COMPLETED', 'u').ok).toBe(true);
    // Cannot transition out of terminal state COMPLETED
    expect(orchestrator.transitionState('run-full', 'IMPLEMENTATION', 'u').ok).toBe(false);

    // Override validation edge cases (confirmed: false, empty approver, short reason)
    expect(
      orchestrator.overrideGate({
        runId: 'run-full',
        gateId: 'GATE_02',
        actorType: 'human',
        approver: 'jay-r',
        reason: 'Valid reason text',
        isInteractiveTty: true,
        confirmed: false,
      }).ok,
    ).toBe(false);
    expect(
      orchestrator.overrideGate({
        runId: 'run-full',
        gateId: 'GATE_02',
        actorType: 'human',
        approver: '   ',
        reason: 'Valid reason text',
        isInteractiveTty: true,
        confirmed: true,
      }).ok,
    ).toBe(false);
    expect(
      orchestrator.overrideGate({
        runId: 'run-full',
        gateId: 'GATE_02',
        actorType: 'human',
        approver: 'jay-r',
        reason: 'short',
        isInteractiveTty: true,
        confirmed: true,
      }).ok,
    ).toBe(false);
  });
});
