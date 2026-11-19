import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeCodeHash, computePlanHash } from '../hashing/scoped-hash.js';
import { EvidenceStore } from '../store/evidence-store.js';
import { evaluateGate01Planning } from './gate01-planning.js';
import { evaluateGate02Pretest, type PretestCheckRunner } from './gate02-pretest.js';
import {
  detectAiApplication,
  evaluateGate03Security,
  parseDependencyAuditJson,
  PINNED_OWASP_LLM_TOP_10_VERSION,
  PINNED_OWASP_TOP_10_VERSION,
  scanWorkspaceForSecrets,
} from './gate03-security.js';
import { evaluateGate04Testing, vitestRunnerParser } from './gate04-testing.js';
import { evaluateGate05Signoff } from './gate05-signoff.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-gates-eval-')));
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

const COMPLETE_PLAN_MD = `# Feature Plan

## Requirements
- User authentication via token

## Specification
- Strictly validate JWT claims

## Architecture
- Stateless verification middleware

## Task Plan
- Task 1: Add middleware
- Task 2: Add unit tests

## Acceptance Criteria
- 100% pass on auth tests
`;

describe('Gate 01 (Planning Document Review) & Gate 02 (Pre-Test Code Review)', () => {
  it('Gate 01 passes when all 5 sections exist and both intake-reviewer and solutions-architect approve current planHash', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g1',
      tier: 'strict',
      taskDescription: 'Auth feature',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    expect(planHashRes.ok).toBe(true);
    if (!planHashRes.ok) return;

    // Only intake-reviewer approved so far -> FAIL
    store.recordReview({
      gateId: 'GATE_01',
      runId: 'run-g1',
      role: 'intake-reviewer',
      evaluator: { type: 'agent', id: 'intake-1' },
      approved: true,
      summary: 'Requirements complete',
      findings: [],
      planHash: planHashRes.value,
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    const partialDecision = evaluateGate01Planning({
      workspaceRoot: root,
      runId: 'run-g1',
      store,
    });
    expect(partialDecision.decision).toBe('FAIL');

    // Add solutions-architect approval -> PASS
    store.recordReview({
      gateId: 'GATE_01',
      runId: 'run-g1',
      role: 'solutions-architect',
      evaluator: { type: 'agent', id: 'arch-1' },
      approved: true,
      summary: 'Architecture aligned',
      findings: [],
      planHash: planHashRes.value,
      timestamp: '2026-11-19T00:01:00.000Z',
    });

    const passDecision = evaluateGate01Planning({
      workspaceRoot: root,
      runId: 'run-g1',
      store,
    });
    expect(passDecision.decision).toBe('PASS');
    expect(passDecision.planHash).toBe(planHashRes.value);
    expect(store.getLatestGateDecision('run-g1', 'GATE_01')?.decision).toBe('PASS');
  });

  it('Gate 01 passes with a single direct human approval and fails on missing sections or stale planHash', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    // Missing Acceptance Criteria
    writeFileSync(
      join(root, 'docs', 'plan.md'),
      `# Plan\n## Requirements\nReq\n## Specification\nSpec\n## Architecture\nArch\n## Task Plan\nTasks\n`,
      'utf8',
    );

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g1-human',
      tier: 'strict',
      taskDescription: 'Human review flow',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const incompleteHash = computePlanHash(root, ['docs/plan.md']);
    expect(incompleteHash.ok).toBe(true);
    if (!incompleteHash.ok) return;

    store.recordReview({
      gateId: 'GATE_01',
      runId: 'run-g1-human',
      role: 'human',
      evaluator: { type: 'human', id: 'jay-r' },
      approved: true,
      summary: 'Approved by human',
      findings: [],
      planHash: incompleteHash.value,
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    // Missing Acceptance Criteria -> still FAIL even with human review!
    const missingSecDecision = evaluateGate01Planning({
      workspaceRoot: root,
      runId: 'run-g1-human',
      store,
    });
    expect(missingSecDecision.decision).toBe('FAIL');
    expect(missingSecDecision.findings.some((f) => f.message.includes('Acceptance Criteria'))).toBe(
      true,
    );

    // Fix plan file -> now prior human review has stale planHash -> FAIL until re-approved
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    const staleDecision = evaluateGate01Planning({
      workspaceRoot: root,
      runId: 'run-g1-human',
      store,
    });
    expect(staleDecision.decision).toBe('FAIL');

    const newHash = computePlanHash(root, ['docs/plan.md']);
    if (!newHash.ok) return;
    store.recordReview({
      gateId: 'GATE_01',
      runId: 'run-g1-human',
      role: 'human',
      evaluator: { type: 'human', id: 'jay-r' },
      approved: true,
      summary: 'Re-approved complete plan',
      findings: [],
      planHash: newHash.value,
      timestamp: '2026-11-19T00:02:00.000Z',
    });

    const passDecision = evaluateGate01Planning({
      workspaceRoot: root,
      runId: 'run-g1-human',
      store,
    });
    expect(passDecision.decision).toBe('PASS');
  });

  it('Gate 02 passes when typecheck, lint, and fresh independent review pass, and fails closed on runner failure or blocking findings', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1;\n', 'utf8');

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g2',
      tier: 'strict',
      taskDescription: 'Gate 2 test',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    expect(codeHashRes.ok).toBe(true);
    if (!codeHashRes.ok) return;

    store.recordReview({
      gateId: 'GATE_02',
      runId: 'run-g2',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'reviewer-1' },
      approved: true,
      summary: 'Clean implementation',
      findings: [],
      codeHash: codeHashRes.value.codeHash,
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    const failingCompileRunner: PretestCheckRunner = {
      runTypecheck: () => ({ passed: false, output: 'TS2322: Type error' }),
      runLint: () => ({ passed: true, output: '' }),
    };

    expect(
      evaluateGate02Pretest({
        workspaceRoot: root,
        runId: 'run-g2',
        store,
        runner: failingCompileRunner,
      }).decision,
    ).toBe('FAIL');

    const throwingLintRunner: PretestCheckRunner = {
      runTypecheck: () => ({ passed: true, output: '' }),
      runLint: () => {
        throw new Error('ESLint process crashed');
      },
    };

    expect(
      evaluateGate02Pretest({
        workspaceRoot: root,
        runId: 'run-g2',
        store,
        runner: throwingLintRunner,
      }).decision,
    ).toBe('FAIL');

    const passingRunner: PretestCheckRunner = {
      runTypecheck: () => ({ passed: true, output: '0 errors' }),
      runLint: () => ({ passed: true, output: '0 warnings' }),
    };

    const passDecision = evaluateGate02Pretest({
      workspaceRoot: root,
      runId: 'run-g2',
      store,
      runner: passingRunner,
    });
    expect(passDecision.decision).toBe('PASS');
    expect(passDecision.codeHash).toBe(codeHashRes.value.codeHash);
  });

  it('Gate 03 scans secrets without leaking raw values, parses audit JSON, detects AI apps, and enforces pinned OWASP checklists', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { openai: '^4.0.0' } }),
      'utf8',
    );
    const leakedKey = 'sk-ant-api03-secretvalue1234567890abcd';
    writeFileSync(join(root, 'src', 'config.ts'), `export const KEY = "${leakedKey}";\n`, 'utf8');

    expect(detectAiApplication(root)).toBe(true);

    const secretFindings = scanWorkspaceForSecrets(root);
    expect(secretFindings).toHaveLength(1);
    expect(secretFindings[0]?.severity).toBe('critical');
    expect(secretFindings[0]?.file).toBe('src/config.ts');
    expect(secretFindings[0]?.line).toBe(1);
    expect(secretFindings[0]?.message).not.toContain(leakedKey);

    // Audit JSON parsing
    const parsedAudit = parseDependencyAuditJson(
      JSON.stringify({
        metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 2 } },
      }),
    );
    expect(parsedAudit).toEqual({
      ok: true,
      value: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 1,
        lowCount: 2,
      },
    });
    expect(parseDependencyAuditJson('not-json').ok).toBe(false);

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g3',
      tier: 'strict',
      taskDescription: 'Gate 3 test',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    // 1. Leaked secret produces hard FAIL with critical finding
    const secretFailRes = evaluateGate03Security({
      workspaceRoot: root,
      runId: 'run-g3',
      store,
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
    });
    expect(secretFailRes.decision).toBe('FAIL');
    expect(secretFailRes.findings.some((f) => f.severity === 'critical')).toBe(true);

    // 2. Remove leaked secret; unexecuted audit without waiver -> BLOCKED
    writeFileSync(join(root, 'src', 'config.ts'), 'export const KEY = "safe";\n', 'utf8');
    const blockedRes = evaluateGate03Security({
      workspaceRoot: root,
      runId: 'run-g3',
      store,
    });
    expect(blockedRes.decision).toBe('BLOCKED');

    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!codeHashRes.ok) return;

    // Review missing OWASP-LLM-Top-10:2025 -> FAIL
    store.recordReview({
      gateId: 'GATE_03',
      runId: 'run-g3',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'sec-1' },
      approved: true,
      summary: 'Checked web OWASP only',
      findings: [],
      codeHash: codeHashRes.value.codeHash,
      checklistVersions: [PINNED_OWASP_TOP_10_VERSION],
      scope: 'src/**',
      limitations: 'Static review only',
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    const missingLlmDecision = evaluateGate03Security({
      workspaceRoot: root,
      runId: 'run-g3',
      store,
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
    });
    expect(missingLlmDecision.decision).toBe('FAIL');

    // Record review with BOTH pinned checklists + scope + limitations -> PASS
    store.recordReview({
      gateId: 'GATE_03',
      runId: 'run-g3',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'sec-1' },
      approved: true,
      summary: 'Full OWASP + LLM security check passed',
      findings: [],
      codeHash: codeHashRes.value.codeHash,
      checklistVersions: [PINNED_OWASP_TOP_10_VERSION, PINNED_OWASP_LLM_TOP_10_VERSION],
      scope: 'src/**',
      limitations: 'Static review + npm audit',
      timestamp: '2026-11-19T00:01:00.000Z',
    });

    const passDecision = evaluateGate03Security({
      workspaceRoot: root,
      runId: 'run-g3',
      store,
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 1,
        lowCount: 0,
      },
    });
    expect(passDecision.decision).toBe('PASS');
  });

  it('Gate 04 enforces Vitest test execution, rejects skipped/failed/0 tests, and enforces per-package >=70% coverage in monorepos', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'coverage'), { recursive: true });
    mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'gates', 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(
      join(root, 'packages', 'core', 'src', 'index.ts'),
      'export const c = 1;\n',
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'gates', 'src', 'index.ts'),
      'export const g = 1;\n',
      'utf8',
    );

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g4',
      tier: 'strict',
      taskDescription: 'Gate 4 coverage check',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const parsedVitest = vitestRunnerParser.parseTestResults(
      JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 10,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
      }),
    );
    expect(parsedVitest).toEqual({
      ok: true,
      value: { totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 },
    });

    // Aggregate is 85%, packages/core is 95%, but packages/gates branches is 65% (<70%) -> FAIL!
    writeFileSync(
      join(root, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { total: 100, covered: 85, pct: 85 },
          statements: { total: 100, covered: 85, pct: 85 },
          functions: { total: 20, covered: 18, pct: 90 },
          branches: { total: 40, covered: 34, pct: 85 },
        },
        [join(root, 'packages', 'core', 'src', 'index.ts')]: {
          lines: { total: 50, covered: 48, pct: 96 },
          statements: { total: 50, covered: 48, pct: 96 },
          functions: { total: 10, covered: 10, pct: 100 },
          branches: { total: 20, covered: 19, pct: 95 },
        },
        [join(root, 'packages', 'gates', 'src', 'index.ts')]: {
          lines: { total: 50, covered: 40, pct: 80 },
          statements: { total: 50, covered: 40, pct: 80 },
          functions: { total: 10, covered: 8, pct: 80 },
          branches: { total: 20, covered: 13, pct: 65 },
        },
      }),
      'utf8',
    );

    const perPkgFail = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'run-g4',
      store,
      testRun: { totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 },
      requiredPackages: ['packages/core', 'packages/gates'],
    });
    expect(perPkgFail.decision).toBe('FAIL');
    expect(
      perPkgFail.findings.some(
        (f) =>
          f.ruleId === 'PACKAGE_COVERAGE_BELOW_THRESHOLD' && f.message.includes('packages/gates'),
      ),
    ).toBe(true);

    // Raise packages/gates branches to 15/20 (75%) -> PASS!
    writeFileSync(
      join(root, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { total: 100, covered: 88, pct: 88 },
          statements: { total: 100, covered: 88, pct: 88 },
          functions: { total: 20, covered: 18, pct: 90 },
          branches: { total: 40, covered: 34, pct: 85 },
        },
        [join(root, 'packages', 'core', 'src', 'index.ts')]: {
          lines: { total: 50, covered: 48, pct: 96 },
          statements: { total: 50, covered: 48, pct: 96 },
          functions: { total: 10, covered: 10, pct: 100 },
          branches: { total: 20, covered: 19, pct: 95 },
        },
        [join(root, 'packages', 'gates', 'src', 'index.ts')]: {
          lines: { total: 50, covered: 40, pct: 80 },
          statements: { total: 50, covered: 40, pct: 80 },
          functions: { total: 10, covered: 8, pct: 80 },
          branches: { total: 20, covered: 15, pct: 75 },
        },
      }),
      'utf8',
    );

    // Skipped tests without allowSkippedTests -> FAIL
    expect(
      evaluateGate04Testing({
        workspaceRoot: root,
        runId: 'run-g4',
        store,
        testRun: { totalTests: 10, passedTests: 9, failedTests: 0, skippedTests: 1 },
        requiredPackages: ['packages/core', 'packages/gates'],
      }).decision,
    ).toBe('FAIL');

    const passG4 = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'run-g4',
      store,
      testRun: { totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 },
      requiredPackages: ['packages/core', 'packages/gates'],
    });
    expect(passG4.decision).toBe('PASS');
  });

  it('Gate 05 verifies fresh PASS evidence for Gates 01-04 and independent code-reviewer sign-off, failing closed if post-review edits make prior gates stale', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 1;\n', 'utf8');

    const store = new EvidenceStore(root);
    store.initRun({
      runId: 'run-g5',
      tier: 'strict',
      taskDescription: 'Gate 5 end-to-end check',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    const codeHashRes = computeCodeHash(root, { planFiles: ['docs/plan.md'] });
    if (!planHashRes.ok || !codeHashRes.ok) return;
    const planHash = planHashRes.value;
    const codeHash = codeHashRes.value.codeHash;

    for (const gateId of ['GATE_01', 'GATE_02', 'GATE_03', 'GATE_04'] as const) {
      store.recordGateDecision({
        gateId,
        gateVersion: '1.0.0',
        runId: 'run-g5',
        ...(gateId === 'GATE_01' ? { planHash } : { codeHash }),
        evaluator: { type: 'deterministic', id: gateId },
        checks: [],
        evidenceRefs: [],
        findings: [],
        decision: 'PASS',
        timestamp: '2026-11-19T00:00:00.000Z',
      });
    }

    store.recordReview({
      gateId: 'GATE_05',
      runId: 'run-g5',
      role: 'code-reviewer',
      evaluator: { type: 'agent', id: 'final-reviewer' },
      approved: true,
      summary: 'All gates verified and code approved',
      findings: [],
      codeHash,
      timestamp: '2026-11-19T00:05:00.000Z',
    });

    const passG5 = evaluateGate05Signoff({
      workspaceRoot: root,
      runId: 'run-g5',
      store,
    });
    expect(passG5.decision).toBe('PASS');

    // Modify source file after Gates 02-04 passed -> Gates 02-04 & review become STALE -> FAIL!
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 2;\n', 'utf8');
    const staleG5 = evaluateGate05Signoff({
      workspaceRoot: root,
      runId: 'run-g5',
      store,
    });
    expect(staleG5.decision).toBe('FAIL');
    expect(staleG5.findings.some((f) => f.ruleId === 'PRIOR_GATE_NOT_FRESH')).toBe(true);
  });

  it('covers fail-closed edge cases across Gates 01-05 (missing run state, .donaronignore, .env detection, audit formats, disk testResults, and malformed coverage)', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 1;\n', 'utf8');

    const store = new EvidenceStore(root);
    const dummyRunner: PretestCheckRunner = {
      runTypecheck: () => {
        throw new Error('tsc crashed');
      },
      runLint: () => ({ passed: false, output: 'lint fail' }),
    };

    // Missing run state fails closed across all 5 gates
    expect(
      evaluateGate01Planning({ workspaceRoot: root, runId: 'missing-run', store }).decision,
    ).toBe('FAIL');
    expect(
      evaluateGate02Pretest({
        workspaceRoot: root,
        runId: 'missing-run',
        store,
        runner: dummyRunner,
      }).decision,
    ).toBe('FAIL');
    expect(
      evaluateGate03Security({ workspaceRoot: root, runId: 'missing-run', store }).decision,
    ).toBe('FAIL');
    expect(
      evaluateGate04Testing({ workspaceRoot: root, runId: 'missing-run', store }).decision,
    ).toBe('FAIL');
    expect(
      evaluateGate05Signoff({ workspaceRoot: root, runId: 'missing-run', store }).decision,
    ).toBe('FAIL');

    store.initRun({
      runId: 'run-edges',
      tier: 'strict',
      taskDescription: 'Edge cases',
      planFiles: ['docs/plan.md'],
      actorId: 'user-1',
    });

    // Gate 02 with throwing typecheck and missing review
    const g2Throw = evaluateGate02Pretest({
      workspaceRoot: root,
      runId: 'run-edges',
      store,
      runner: dummyRunner,
    });
    expect(g2Throw.decision).toBe('FAIL');
    expect(g2Throw.findings.some((f) => f.ruleId === 'PRETEST_REVIEW_REQUIRED')).toBe(true);

    // Gate 03: .donaronignore, unignored .env vs gitignored .env, and .donaron/config.json aiApplication
    writeFileSync(join(root, '.env'), 'SECRET=1\n', 'utf8');
    writeFileSync(join(root, '.donaronignore'), '# comment\nignored-dir/\n', 'utf8');
    mkdirSync(join(root, 'ignored-dir'), { recursive: true });
    writeFileSync(
      join(root, 'ignored-dir', 'skip.ts'),
      'const k = "AKIA1234567890ABCDEF";\n',
      'utf8',
    );
    const envFindings = scanWorkspaceForSecrets(root);
    expect(envFindings.some((f) => f.ruleId === 'SECRET_ENV_FILE')).toBe(true);
    expect(envFindings.some((f) => f.file?.includes('ignored-dir'))).toBe(false);

    writeFileSync(join(root, '.gitignore'), '.env*\n', 'utf8');
    expect(scanWorkspaceForSecrets(root).some((f) => f.ruleId === 'SECRET_ENV_FILE')).toBe(false);

    expect(detectAiApplication(root)).toBe(false);
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ dependencies: { '@ai-sdk/openai': '^1.0.0' } }),
      'utf8',
    );
    expect(detectAiApplication(root)).toBe(true);
    writeFileSync(
      join(root, '.donaron', 'config.json'),
      JSON.stringify({ aiApplication: false }),
      'utf8',
    );
    expect(detectAiApplication(root)).toBe(false);

    // parseDependencyAuditJson alternative formats & errors
    expect(parseDependencyAuditJson('[]').ok).toBe(false);
    expect(parseDependencyAuditJson('{}').ok).toBe(false);
    const vulnMapParsed = parseDependencyAuditJson(
      JSON.stringify({
        vulnerabilities: {
          pkgA: { severity: 'critical' },
          pkgB: { severity: 'high' },
          pkgC: { severity: 'moderate' },
          pkgD: { severity: 'low' },
        },
      }),
    );
    expect(vulnMapParsed).toEqual({
      ok: true,
      value: {
        executed: true,
        criticalCount: 1,
        highCount: 1,
        moderateCount: 1,
        lowCount: 1,
      },
    });

    // Gate 03 with invalid auditReportJson, valid auditReportJson with critical/high vulns, and offline waiver
    expect(
      evaluateGate03Security({
        workspaceRoot: root,
        runId: 'run-edges',
        store,
        auditReportJson: 'not-valid-json',
        requireOwaspReview: false,
      }).decision,
    ).toBe('FAIL');

    expect(
      evaluateGate03Security({
        workspaceRoot: root,
        runId: 'run-edges',
        store,
        auditReportJson: JSON.stringify({
          vulnerabilities: { a: { severity: 'critical' }, b: { severity: 'high' } },
        }),
        requireOwaspReview: false,
      }).decision,
    ).toBe('FAIL');

    expect(
      evaluateGate03Security({
        workspaceRoot: root,
        runId: 'run-edges',
        store,
        auditSummary: {
          executed: false,
          offlineWaiverReason: 'Air-gapped CI runner waiver',
          criticalCount: 0,
          highCount: 0,
          moderateCount: 0,
          lowCount: 0,
        },
        requireOwaspReview: false,
      }).decision,
    ).toBe('PASS');

    // Gate 04: vitestRunnerParser errors, reading testResultsPath from disk, 0 tests, failed tests, missing/malformed coverage, aggregate below threshold, missing requiredPackage
    expect(vitestRunnerParser.parseTestResults('bad-json').ok).toBe(false);
    expect(vitestRunnerParser.parseTestResults('[]').ok).toBe(false);
    expect(vitestRunnerParser.parseTestResults('{}').ok).toBe(false);

    // Missing testResultsPath & missing coverageSummaryPath
    const g4MissingFiles = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'run-edges',
      store,
      testResultsPath: 'coverage/missing-tests.json',
      coverageSummaryPath: 'coverage/missing-cov.json',
    });
    expect(g4MissingFiles.decision).toBe('FAIL');
    expect(g4MissingFiles.findings.some((f) => f.ruleId === 'TEST_RESULTS_MISSING')).toBe(true);
    expect(g4MissingFiles.findings.some((f) => f.ruleId === 'COVERAGE_REPORT_MISSING')).toBe(true);

    // Malformed testResultsPath and malformed coverageSummaryPath on disk
    writeFileSync(join(root, 'coverage', 'test-results.json'), 'not-json', 'utf8');
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), '{"total": {}}', 'utf8');
    const g4Malformed = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'run-edges',
      store,
    });
    expect(g4Malformed.decision).toBe('FAIL');
    expect(g4Malformed.findings.some((f) => f.ruleId === 'TEST_RESULTS_INVALID_JSON')).toBe(true);
    expect(g4Malformed.findings.some((f) => f.ruleId === 'COVERAGE_REPORT_MALFORMED')).toBe(true);

    // Valid test-results.json on disk with 0 tests & failures, plus aggregate coverage <70% and missing required package
    writeFileSync(
      join(root, 'coverage', 'test-results.json'),
      JSON.stringify({
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 2,
      }),
      'utf8',
    );
    writeFileSync(
      join(root, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { total: 100, covered: 50, pct: 50 },
          statements: { total: 100, covered: 50, pct: 50 },
          functions: { total: 10, covered: 5, pct: 50 },
          branches: { total: 10, covered: 5, pct: 50 },
        },
      }),
      'utf8',
    );
    const g4Below = evaluateGate04Testing({
      workspaceRoot: root,
      runId: 'run-edges',
      store,
      requiredPackages: ['packages/nonexistent'],
    });
    expect(g4Below.decision).toBe('FAIL');
    expect(g4Below.findings.some((f) => f.ruleId === 'ZERO_TESTS_EXECUTED')).toBe(true);
    expect(g4Below.findings.some((f) => f.ruleId === 'TEST_FAILURES_PRESENT')).toBe(true);
    expect(g4Below.findings.some((f) => f.ruleId === 'COVERAGE_BELOW_THRESHOLD')).toBe(true);
    expect(g4Below.findings.some((f) => f.ruleId === 'PACKAGE_COVERAGE_MISSING')).toBe(true);
  });
});
