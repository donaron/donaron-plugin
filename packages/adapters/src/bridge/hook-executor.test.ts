import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computePlanHash, WorkflowOrchestrator } from '@donaron/gates';
import { afterEach, describe, expect, it } from 'vitest';
import { executeNormalizedHook } from './hook-executor.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-hook-exec-')));
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

describe('executeNormalizedHook', () => {
  it('handles SessionStart quietly when no workflow is active and injects workflow context when active', () => {
    const root = createTempWorkspace();
    const noRunDecision = executeNormalizedHook({
      harnessId: 'antigravity',
      event: 'SessionStart',
      workspaceRoot: root,
    });
    expect(noRunDecision.decision).toBe('allow');
    expect(noRunDecision.systemMessage).toBeUndefined();

    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    const orchestrator = new WorkflowOrchestrator(root);
    orchestrator.startWorkflow({
      runId: 'run-session-1',
      taskDescription: 'Implement authentication module',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'user-1',
    });

    const activeDecision = executeNormalizedHook({
      harnessId: 'antigravity',
      event: 'SessionStart',
      workspaceRoot: root,
    });
    expect(activeDecision.decision).toBe('allow');
    expect(activeDecision.systemMessage).toContain('run-session-1');
    expect(activeDecision.systemMessage).toContain('strict');
    expect(activeDecision.systemMessage).toContain('INTAKE');
  });

  it('enforces Choice 1A and Choice 2A PreToolUse policy guards and fails closed on missing workspace or toolCall', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

    // Fail-closed when workspaceRoot is blank or toolCall is missing
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: '   ',
        toolCall: { name: 'read_file', args: { Path: 'src/index.ts' } },
      }).decision,
    ).toBe('deny');

    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
      }).decision,
    ).toBe('deny');

    // Choice 1A: writing or deleting inside .donaron/** is DENIED
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'write_file',
          args: { Path: join(root, '.donaron', 'runs', 'r1', 'state.json'), Content: '{}' },
        },
      }).decision,
    ).toBe('deny');

    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'delete_file',
          args: { Path: join(root, '.donaron') },
        },
      }).decision,
    ).toBe('deny');

    // Choice 1A: running donaron gate override from an agent tool call is DENIED
    expect(
      executeNormalizedHook({
        harnessId: 'claude-code',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'Bash',
          args: { command: 'donaron gate override GATE_02 --reason "bypass" --approver bot' },
        },
      }).decision,
    ).toBe('deny');

    // Choice 2A: even without an active .donaron workflow, reading .env or destructive commands are DENIED
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'read_file',
          args: { Path: join(root, '.env') },
        },
      }).decision,
    ).toBe('deny');

    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'rm -rf /' },
        },
      }).decision,
    ).toBe('deny');

    // git push --force is DENIED, while regular git push requires approval ('ask')
    expect(
      executeNormalizedHook({
        harnessId: 'claude-code',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'Bash',
          args: { command: 'git push --force origin main' },
        },
      }).decision,
    ).toBe('deny');

    expect(
      executeNormalizedHook({
        harnessId: 'claude-code',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'Bash',
          args: { command: 'git push origin main' },
        },
      }).decision,
    ).toBe('ask');

    // Safe workspace file writes and test commands are ALLOWED
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'edit_file',
          args: { Path: join(root, 'src', 'index.ts') },
        },
      }).decision,
    ).toBe('allow');

    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'pnpm test' },
        },
      }).decision,
    ).toBe('allow');

    // Non-file/non-command tool calls (e.g. ask_question / task list) are allowed
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PreToolUse',
        workspaceRoot: root,
        toolCall: {
          name: 'ask_question',
          args: { questions: [] },
        },
      }).decision,
    ).toBe('allow');
  });

  it('handles PostToolUse and Stop hook gate enforcement (Choice 2A, active workflow block_stop, and continuationActive loop guard)', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'PostToolUse',
        workspaceRoot: root,
      }).decision,
    ).toBe('allow');

    // Choice 2A: Stop allows stopping when no active workflow exists
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'Stop',
        workspaceRoot: root,
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }).decision,
    ).toBe('allow_stop');

    const orchestrator = new WorkflowOrchestrator(root);
    orchestrator.startWorkflow({
      runId: 'run-stop-hook',
      taskDescription: 'Stop hook test',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'u',
    });
    const planHashRes = computePlanHash(root, ['docs/plan.md']);
    if (!planHashRes.ok) return;
    orchestrator.store.recordGateDecision({
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'run-stop-hook',
      planHash: planHashRes.value,
      evaluator: { type: 'deterministic', id: 'g1' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    });
    orchestrator.transitionState('run-stop-hook', 'PLANNING', 'u');
    orchestrator.transitionState('run-stop-hook', 'GATE_01', 'u');
    orchestrator.transitionState('run-stop-hook', 'IMPLEMENTATION', 'u');

    // Active IMPLEMENTATION without Gates 02-05 -> block_stop
    const blocked = executeNormalizedHook({
      harnessId: 'antigravity',
      event: 'Stop',
      workspaceRoot: root,
      terminationReason: 'NO_TOOL_CALL',
      continuationActive: false,
    });
    expect(blocked.decision).toBe('block_stop');
    expect(blocked.reason).toContain('GATE_02');

    // continuationActive: true -> allow_stop to prevent infinite loop
    expect(
      executeNormalizedHook({
        harnessId: 'antigravity',
        event: 'Stop',
        workspaceRoot: root,
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: true,
      }).decision,
    ).toBe('allow_stop');
  });
});
