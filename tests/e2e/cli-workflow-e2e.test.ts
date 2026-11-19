import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../apps/cli/src/index.js';
import { PINNED_OWASP_TOP_10_VERSION } from '../../packages/gates/src/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-cli-e2e-')));
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

const CLI_DIST = resolve(import.meta.dirname, '../../apps/cli/dist/cli.js');

const COMPLETE_PLAN_MD = `# Node + React Feature Plan

## Requirements
- Build a typed React dashboard component and Node API service.

## Specification
- Strictly validated inputs and >=70% test coverage.

## Architecture
- React frontend + Node service layer.

## Task Plan
1. Implement component
2. Verify all 5 DonAron gates

## Acceptance Criteria
- Gates 01-05 pass with fresh evidence.
`;

describe('Phase 5 E2E CLI Workflow & Subprocess Hook Bridge on Node + React Fixture Repo', () => {
  it('drives a complete strict 5-gate workflow from INTAKE to COMPLETED on a Node + React repo via runCli', () => {
    const repo = createTempDir();
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'coverage'), { recursive: true });

    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'fixture-node-react-app',
        version: '1.0.0',
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
      }),
      'utf8',
    );
    writeFileSync(join(repo, 'docs', 'plan.md'), COMPLETE_PLAN_MD, 'utf8');
    writeFileSync(
      join(repo, 'src', 'Dashboard.tsx'),
      'export function Dashboard(): string { return "Ready"; }\n',
      'utf8',
    );
    writeFileSync(
      join(repo, 'coverage', 'test-results.json'),
      JSON.stringify({
        numTotalTests: 12,
        numPassedTests: 12,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
      }),
      'utf8',
    );
    writeFileSync(
      join(repo, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { total: 100, covered: 92, pct: 92 },
          statements: { total: 100, covered: 92, pct: 92 },
          functions: { total: 20, covered: 19, pct: 95 },
          branches: { total: 30, covered: 26, pct: 86.67 },
        },
      }),
      'utf8',
    );

    const ctx = {
      cwd: repo,
      pretestRunner: {
        runTypecheck: () => ({ passed: true, output: '0 errors' }),
        runLint: () => ({ passed: true, output: '0 warnings' }),
      },
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
    };

    // 1. Start strict workflow
    expect(
      runCli(
        [
          'workflow',
          'start',
          '--run-id',
          'e2e-run-1',
          '--task',
          'Ship Dashboard component',
          '--plan',
          'docs/plan.md',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);

    // 2. Register authors & record Gate 01 independent reviews
    expect(
      runCli(['workflow', 'register-author', '--kind', 'plan', '--actor-id', 'planner-1'], ctx)
        .exitCode,
    ).toBe(0);
    expect(
      runCli(['workflow', 'register-author', '--kind', 'code', '--actor-id', 'dev-1'], ctx)
        .exitCode,
    ).toBe(0);

    expect(
      runCli(
        [
          'workflow',
          'record-review',
          '--gate',
          'GATE_01',
          '--role',
          'intake-reviewer',
          '--reviewer-id',
          'intake-1',
          '--approved',
          '--summary',
          'Requirements complete',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(
      runCli(
        [
          'workflow',
          'record-review',
          '--gate',
          'GATE_01',
          '--role',
          'solutions-architect',
          '--reviewer-id',
          'arch-1',
          '--approved',
          '--summary',
          'Architecture sound',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);

    expect(runCli(['workflow', 'advance', 'PLANNING'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_01'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '01'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'IMPLEMENTATION'], ctx).exitCode).toBe(0);

    // 3. While in IMPLEMENTATION without Gates 02-05, Stop hook blocks stopping!
    const stopInImpl = runCli(['hook', 'antigravity', 'Stop'], {
      ...ctx,
      stdin: JSON.stringify({
        cwd: repo,
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    });
    expect(stopInImpl.exitCode).toBe(0);
    expect(JSON.parse(stopInImpl.stdout)).toMatchObject({
      decision: 'continue',
    });

    // 4. Record reviews for Gates 02, 03, 05 and run Gates 02-05
    expect(
      runCli(
        [
          'workflow',
          'record-review',
          '--gate',
          'GATE_02',
          '--role',
          'code-reviewer',
          '--reviewer-id',
          'cr-1',
          '--approved',
          '--summary',
          'Pre-test code review passed',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);

    expect(
      runCli(
        [
          'workflow',
          'record-review',
          '--gate',
          'GATE_03',
          '--role',
          'code-reviewer',
          '--reviewer-id',
          'sec-1',
          '--approved',
          '--checklists',
          PINNED_OWASP_TOP_10_VERSION,
          '--scope',
          'src/**',
          '--limitations',
          'Static analysis + dependency audit',
          '--summary',
          'OWASP Top 10:2021 verified',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);

    expect(
      runCli(
        [
          'workflow',
          'record-review',
          '--gate',
          'GATE_05',
          '--role',
          'code-reviewer',
          '--reviewer-id',
          'final-cr-1',
          '--approved',
          '--summary',
          'Final release sign-off',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);

    expect(runCli(['workflow', 'advance', 'PRE_TEST_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_02'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '02'], ctx).exitCode).toBe(0);

    expect(runCli(['workflow', 'advance', 'SECURITY_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_03'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '03'], ctx).exitCode).toBe(0);

    expect(runCli(['workflow', 'advance', 'TESTING'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_04'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '04'], ctx).exitCode).toBe(0);

    expect(runCli(['workflow', 'advance', 'FINAL_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_05'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '05'], ctx).exitCode).toBe(0);

    // 5. Advance to COMPLETED and verify Stop hook allows stopping
    expect(runCli(['workflow', 'advance', 'COMPLETED'], ctx).exitCode).toBe(0);

    const stopCompleted = runCli(['hook', 'antigravity', 'Stop'], {
      ...ctx,
      stdin: JSON.stringify({
        cwd: repo,
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    });
    expect(JSON.parse(stopCompleted.stdout)).toEqual({ decision: '' });
  });

  it('executes compiled dist/cli.js hook bridge in a real Node subprocess and fails closed on malformed stdin or policy violations', () => {
    const repo = createTempDir();
    mkdirSync(join(repo, 'src'), { recursive: true });
    const childEnv = { ...process.env, NODE_V8_COVERAGE: '' };

    // 1. Malformed JSON stdin on PreToolUse fails closed with native deny/block JSON
    const badAgy = spawnSync(process.execPath, [CLI_DIST, 'hook', 'antigravity', 'PreToolUse'], {
      input: '{malformed-json',
      encoding: 'utf8',
      env: childEnv,
    });
    expect(badAgy.status).toBe(0);
    expect(JSON.parse(badAgy.stdout)).toMatchObject({ decision: 'deny' });

    const badCc = spawnSync(process.execPath, [CLI_DIST, 'hook', 'claude-code', 'PreToolUse'], {
      input: '{malformed-json',
      encoding: 'utf8',
      env: childEnv,
    });
    expect(badCc.status).toBe(0);
    expect(JSON.parse(badCc.stdout)).toMatchObject({ decision: 'block' });

    // 2. Choice 1A: writing to .donaron/runs/** via subprocess hook is DENIED
    const writeDonaron = spawnSync(
      process.execPath,
      [CLI_DIST, 'hook', 'antigravity', 'PreToolUse'],
      {
        input: JSON.stringify({
          cwd: repo,
          toolCall: {
            name: 'write_file',
            args: { Path: join(repo, '.donaron', 'runs', 'r1', 'state.json'), Content: '{}' },
          },
        }),
        encoding: 'utf8',
        env: childEnv,
      },
    );
    expect(writeDonaron.status).toBe(0);
    expect(JSON.parse(writeDonaron.stdout)).toMatchObject({ decision: 'deny' });

    // 3. Safe file write inside repo via subprocess hook is ALLOWED
    const safeWrite = spawnSync(process.execPath, [CLI_DIST, 'hook', 'antigravity', 'PreToolUse'], {
      input: JSON.stringify({
        cwd: repo,
        toolCall: {
          name: 'write_file',
          args: { Path: join(repo, 'src', 'App.tsx'), Content: 'export const x = 1;' },
        },
      }),
      encoding: 'utf8',
      env: childEnv,
    });
    expect(safeWrite.status).toBe(0);
    expect(JSON.parse(safeWrite.stdout)).toEqual({ decision: 'allow' });
  });
});
