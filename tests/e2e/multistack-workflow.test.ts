import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../apps/cli/src/index.js';
import {
  PINNED_OWASP_LLM_TOP_10_VERSION,
  PINNED_OWASP_TOP_10_VERSION,
} from '../../packages/gates/src/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-py-e2e-')));
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

const PLAN_MD = `# Python FastAPI + OpenAI Service Plan

## Requirements
- Build a typed Python AI endpoint with >=80% coverage.

## Specification
- Strictly validated Pydantic schemas and fail-closed error handling.

## Architecture
- FastAPI router + service module.

## Task Plan
1. Implement service & tests
2. Verify Gates 01-05

## Acceptance Criteria
- mypy, ruff, pytest JUnit XML, and LCOV coverage pass.
`;

describe('v0.2.0 Multi-Stack E2E Workflow (Python AI Repo with JUnit XML & LCOV)', () => {
  it('runs a complete strict 5-gate workflow on a Python + OpenAI repository via runCli', () => {
    const repo = createTempDir();
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'coverage'), { recursive: true });
    mkdirSync(join(repo, '.donaron'), { recursive: true });

    writeFileSync(join(repo, 'requirements.txt'), 'fastapi==0.115.0\nopenai>=1.50.0\n', 'utf8');
    writeFileSync(join(repo, 'docs', 'plan.md'), PLAN_MD, 'utf8');
    writeFileSync(
      join(repo, 'src', 'app.py'),
      'def greet(name: str) -> str:\n    return f"Hello {name}"\n',
      'utf8',
    );
    writeFileSync(
      join(repo, '.donaron', 'config.json'),
      JSON.stringify({
        stack: 'python',
        typecheckCommand: 'mypy src',
        lintCommand: 'ruff check .',
        testResultsFormat: 'junit',
        testResultsPath: 'coverage/junit.xml',
        coverageFormat: 'lcov',
        coveragePath: 'coverage/lcov.info',
        minimumCoveragePct: 80,
      }),
      'utf8',
    );
    writeFileSync(
      join(repo, 'coverage', 'junit.xml'),
      '<testsuite name="pytest" tests="8" failures="0" errors="0" skipped="0" />',
      'utf8',
    );
    writeFileSync(
      join(repo, 'coverage', 'lcov.info'),
      ['SF:src/app.py', 'FNF:2', 'FNH:2', 'LF:10', 'LH:9', 'BRF:4', 'BRH:4', 'end_of_record'].join(
        '\n',
      ),
      'utf8',
    );

    const ctx = {
      cwd: repo,
      pretestRunner: {
        runTypecheck: () => ({ passed: true, output: 'Success: no issues found' }),
        runLint: () => ({ passed: true, output: 'All checks passed!' }),
      },
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
    };

    expect(
      runCli(
        [
          'workflow',
          'start',
          '--run-id',
          'py-run-1',
          '--task',
          'Ship Python FastAPI AI service',
          '--plan',
          'docs/plan.md',
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
          'human',
          '--reviewer-id',
          'jay-r',
          '--approved',
          '--summary',
          'Plan approved',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(runCli(['workflow', 'advance', 'PLANNING'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_01'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '01'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'IMPLEMENTATION'], ctx).exitCode).toBe(0);

    // Gate 02
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
          'Python code clean',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(runCli(['workflow', 'advance', 'PRE_TEST_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_02'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '02'], ctx).exitCode).toBe(0);

    // Gate 03 (auto-detects openai in requirements.txt -> requires BOTH OWASP-Top-10:2021 & OWASP-LLM-Top-10:2025)
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
          `${PINNED_OWASP_TOP_10_VERSION},${PINNED_OWASP_LLM_TOP_10_VERSION}`,
          '--scope',
          'src/**',
          '--limitations',
          'Static analysis only',
          '--summary',
          'OWASP + LLM verified',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(runCli(['workflow', 'advance', 'SECURITY_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_03'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '03'], ctx).exitCode).toBe(0);

    // Gate 04 (automatically uses junitRunnerParser + lcov.info + 80% threshold from .donaron/config.json!)
    expect(runCli(['workflow', 'advance', 'TESTING'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_04'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '04'], ctx).exitCode).toBe(0);

    // Gate 05
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
          'Ready for release',
        ],
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(runCli(['workflow', 'advance', 'FINAL_REVIEW'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'GATE_05'], ctx).exitCode).toBe(0);
    expect(runCli(['gate', 'run', '05'], ctx).exitCode).toBe(0);
    expect(runCli(['workflow', 'advance', 'COMPLETED'], ctx).exitCode).toBe(0);
  });
});
