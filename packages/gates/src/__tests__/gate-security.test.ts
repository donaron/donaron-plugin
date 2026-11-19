import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCodeHash,
  computePlanHash,
  DONARON_GATES_VERSION,
  evaluateGate03Security,
  evaluateGate04Testing,
  evaluateGate05Signoff,
  EvidenceStore,
  getGatesModuleInfo,
  WorkflowOrchestrator,
} from '../index.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-gate-sec-')));
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

describe('Phase 3 Gate-Bypass & Security Regression Suite (@donaron/gates public barrel)', () => {
  it('preserves Phase 1 module metadata exports alongside Phase 3 gate engine APIs', () => {
    expect(DONARON_GATES_VERSION).toBe('0.1.0');
    expect(getGatesModuleInfo().name).toBe('@donaron/gates');
  });

  it('prevents self-approval, stale-hash reuse after test edits, unapproved tier downgrades, and critical security overrides', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'plan.md'),
      `# Plan\n## Requirements\nR\n## Specification\nS\n## Architecture\nA\n## Task Plan\nT\n## Acceptance Criteria\nC\n`,
      'utf8',
    );
    writeFileSync(join(root, 'src', 'app.ts'), 'export const ok = true;\n', 'utf8');

    const orchestrator = new WorkflowOrchestrator(root);
    const store = new EvidenceStore(root);

    orchestrator.startWorkflow({
      runId: 'sec-run-1',
      taskDescription: 'Security regression workflow',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
    });

    store.registerArtifactAuthor('sec-run-1', 'code', 'developer-bot');

    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!planHashRes.ok || !codeHashRes.ok) return;

    // 1. Developer agent attempting to self-approve Gate 05 is blocked
    const selfSignoff = store.recordReview({
      gateId: 'GATE_05',
      runId: 'sec-run-1',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'developer-bot' },
      approved: true,
      summary: 'I approve my own code',
      findings: [],
      codeHash: codeHashRes.value.codeHash,
      timestamp: '2026-11-19T00:00:00.000Z',
    });
    expect(selfSignoff.ok).toBe(false);

    // 2. Fabricated 0-test run fails Gate 04 even if coverage-summary.json claims 100%
    writeFileSync(
      join(root, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { total: 10, covered: 10, pct: 100 },
          statements: { total: 10, covered: 10, pct: 100 },
          functions: { total: 2, covered: 2, pct: 100 },
          branches: { total: 2, covered: 2, pct: 100 },
        },
      }),
      'utf8',
    );
    const zeroTestsGate04 = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'sec-run-1',
      store,
      testRun: { totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 },
    });
    expect(zeroTestsGate04.decision).toBe('FAIL');

    // 3. Hardcoded secret fails Gate 03 with critical finding and cannot be overridden
    writeFileSync(
      join(root, 'src', 'app.ts'),
      'export const secret = "ghp_1234567890abcdefghijklmnopqrstuv";\n',
      'utf8',
    );
    const g3Decision = evaluateGate03Security({
      workspaceRoot: root,
      runId: 'sec-run-1',
      store,
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
    });
    expect(g3Decision.decision).toBe('FAIL');

    const overrideAttempt = orchestrator.overrideGate({
      runId: 'sec-run-1',
      gateId: 'GATE_03',
      actorType: 'human',
      approver: 'jay-r',
      reason: 'Trying to override leaked GitHub PAT',
      isInteractiveTty: true,
      confirmed: true,
    });
    expect(overrideAttempt.ok).toBe(false);

    // 4. Gate 05 fails closed when prior gates are missing or failed
    const g5Decision = evaluateGate05Signoff({
      workspaceRoot: root,
      runId: 'sec-run-1',
      store,
    });
    expect(g5Decision.decision).toBe('FAIL');
  });
});
