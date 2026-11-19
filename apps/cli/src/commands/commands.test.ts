import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WorkflowOrchestrator } from '@donaron/gates';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCliError,
  formatCliOutput,
  getBooleanFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCliArgs,
} from '../args.js';
import { handleAdapterCommand, handleDoctorCommand } from './doctor-and-adapter.js';
import { handleExportCommand, handlePluginCommand } from './plugin-and-export.js';
import { handleGateCommand, handleWorkflowCommand } from './workflow-and-gate.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-cli-cmd-')));
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

describe('CLI Arg Parser, Doctor, and Adapter Capabilities Commands', () => {
  it('parses positional arguments, boolean flags, key-value flags, and repeated/csv array flags', () => {
    const parsed = parseCliArgs([
      'workflow',
      'start',
      '--run-id',
      'run-1',
      '--tier=strict',
      '--plan',
      'docs/a.md,docs/b.md',
      '--plan',
      'docs/c.md',
      '--yes',
      '--json',
    ]);

    expect(parsed.positionals).toEqual(['workflow', 'start']);
    expect(parsed.json).toBe(true);
    expect(getBooleanFlag(parsed, 'yes')).toBe(true);
    expect(getBooleanFlag(parsed, 'missing')).toBe(false);
    expect(getStringFlag(parsed, 'run-id')).toBe('run-1');
    expect(getStringFlag(parsed, 'tier')).toBe('strict');
    expect(getStringArrayFlag(parsed, 'plan')).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);

    const formattedJson = formatCliOutput({ ok: true }, 'Human OK', true);
    expect(formattedJson.exitCode).toBe(0);
    expect(JSON.parse(formattedJson.stdout)).toEqual({ ok: true });

    const formattedErr = formatCliError('TEST_ERR', 'Something failed', true, { detail: 1 });
    expect(formattedErr.exitCode).toBe(1);
    expect(JSON.parse(formattedErr.stdout)).toMatchObject({
      ok: false,
      error: { code: 'TEST_ERR', message: 'Something failed' },
    });
  });

  it('runs donaron doctor in both human-readable and --json modes with active workflow detection', () => {
    const root = createTempDir();
    const regPath = join(root, 'registry.json');

    const docHuman = handleDoctorCommand(parseCliArgs(['doctor']), {
      cwd: root,
      registryFilePath: regPath,
    });
    expect(docHuman.exitCode).toBe(0);
    expect(docHuman.stdout).toContain('DonAron Doctor');
    expect(docHuman.stdout).toContain('@donaron/core');

    // Start an active workflow in root and verify doctor --json reports it
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    const orch = new WorkflowOrchestrator(root);
    orch.startWorkflow({
      runId: 'doc-run-1',
      taskDescription: 'Doctor active run test',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'u',
    });

    const docJson = handleDoctorCommand(parseCliArgs(['doctor', '--json']), {
      cwd: root,
      registryFilePath: regPath,
    });
    expect(docJson.exitCode).toBe(0);
    const payload = JSON.parse(docJson.stdout) as {
      ok: boolean;
      activeWorkflow?: { runId: string; tier: string; state: string };
      modules: { name: string }[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.activeWorkflow?.runId).toBe('doc-run-1');
    expect(payload.modules).toHaveLength(3);
  });

  it('runs donaron adapter capabilities for all harnesses, a single harness, and rejects invalid subcommands/harnesses', () => {
    const allHuman = handleAdapterCommand(parseCliArgs(['adapter', 'capabilities']));
    expect(allHuman.exitCode).toBe(0);
    expect(allHuman.stdout).toContain('antigravity');
    expect(allHuman.stdout).toContain('claude-code');
    expect(allHuman.stdout).toContain('UNVERIFIED');

    const singleJson = handleAdapterCommand(
      parseCliArgs(['adapter', 'capabilities', 'antigravity', '--json']),
    );
    expect(singleJson.exitCode).toBe(0);
    const parsedSingle = JSON.parse(singleJson.stdout) as {
      ok: boolean;
      adapters: { harnessId: string; gates: string }[];
    };
    expect(parsedSingle.ok).toBe(true);
    expect(parsedSingle.adapters).toHaveLength(1);
    expect(parsedSingle.adapters[0]?.harnessId).toBe('antigravity');
    expect(parsedSingle.adapters[0]?.gates).toBe('EMULATED');

    const badHarness = handleAdapterCommand(
      parseCliArgs(['adapter', 'capabilities', 'codex', '--json']),
    );
    expect(badHarness.exitCode).toBe(1);

    const badSubcmd = handleAdapterCommand(parseCliArgs(['adapter', 'unknown']));
    expect(badSubcmd.exitCode).toBe(1);
  });

  it('runs donaron plugin validate|info|list|install|uninstall and donaron export with permission confirmation enforcement', () => {
    const sampleDir = resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'tests',
      'fixtures',
      'plugins',
      'valid-sample',
    );
    const invalidDir = resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'tests',
      'fixtures',
      'plugins',
      'invalid-manifest',
    );

    const root = createTempDir();
    const ctx = {
      cwd: root,
      registryFilePath: join(root, 'registry.json'),
      antigravityPluginsDir: join(root, 'agy-plugins'),
      claudePluginsDir: join(root, 'cc-plugins'),
      cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
    };

    // 1. plugin validate
    const valOk = handlePluginCommand(
      parseCliArgs(['plugin', 'validate', sampleDir, '--json']),
      ctx,
    );
    expect(valOk.exitCode).toBe(0);
    expect((JSON.parse(valOk.stdout) as { ok: boolean }).ok).toBe(true);

    const valFail = handlePluginCommand(
      parseCliArgs(['plugin', 'validate', invalidDir, '--json']),
      ctx,
    );
    expect(valFail.exitCode).toBe(1);

    // 2. plugin info
    const infoRes = handlePluginCommand(parseCliArgs(['plugin', 'info', sampleDir, '--json']), ctx);
    expect(infoRes.exitCode).toBe(0);
    const infoPayload = JSON.parse(infoRes.stdout) as {
      ok: boolean;
      name: string;
      permissions: string[];
    };
    expect(infoPayload.ok).toBe(true);
    expect(infoPayload.permissions.length).toBeGreaterThan(0);

    // 3. export --target antigravity|claude-code --out <dir>
    const agyOut = join(root, 'export-agy');
    const expRes = handleExportCommand(
      parseCliArgs(['export', sampleDir, '--target', 'antigravity', '--out', agyOut, '--json']),
      ctx,
    );
    expect(expRes.exitCode).toBe(0);
    expect(existsSync(join(agyOut, 'plugin.json'))).toBe(true);
    expect(existsSync(join(agyOut, 'hooks.json'))).toBe(true);

    // 4. plugin install without --yes or confirmed fails closed when permissions are requested!
    const unconfirmedInstall = handlePluginCommand(
      parseCliArgs(['plugin', 'install', sampleDir, '--target', 'antigravity', '--json']),
      ctx,
    );
    expect(unconfirmedInstall.exitCode).toBe(1);
    expect(unconfirmedInstall.stdout).toContain('INSTALL_CONFIRMATION_REQUIRED');

    // 5. plugin install with --yes --target all succeeds and registers both harnesses
    const installAll = handlePluginCommand(
      parseCliArgs(['plugin', 'install', sampleDir, '--target', 'all', '--yes', '--json']),
      ctx,
    );
    expect(installAll.exitCode).toBe(0);

    const listAll = handlePluginCommand(parseCliArgs(['plugin', 'list', '--json']), ctx);
    expect(listAll.exitCode).toBe(0);
    const listPayload = JSON.parse(listAll.stdout) as {
      ok: boolean;
      installations: { harnessId: string; pluginName: string }[];
    };
    expect(listPayload.installations).toHaveLength(2);

    const pluginName = listPayload.installations[0]?.pluginName ?? 'valid-sample';

    // 6. plugin uninstall <name> --target antigravity
    const uninstRes = handlePluginCommand(
      parseCliArgs(['plugin', 'uninstall', pluginName, '--target', 'antigravity', '--json']),
      ctx,
    );
    expect(uninstRes.exitCode).toBe(0);

    const listAfter = handlePluginCommand(parseCliArgs(['plugin', 'list', '--json']), ctx);
    expect(
      (JSON.parse(listAfter.stdout) as { installations: unknown[] }).installations,
    ).toHaveLength(1);
  });

  it('orchestrates strict 5-gate workflow commands and enforces anti-self-approval, tier downgrade guards, and TTY override guards', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'plan.md'),
      `# Plan\n## Requirements\nR\n## Specification\nS\n## Architecture\nA\n## Task Plan\nT\n## Acceptance Criteria\nC\n`,
      'utf8',
    );
    writeFileSync(join(root, 'src', 'App.tsx'), 'export const App = () => "Hello";\n', 'utf8');

    const ctx = {
      cwd: root,
      pretestRunner: {
        runTypecheck: () => ({ passed: true, output: 'tsc OK' }),
        runLint: () => ({ passed: true, output: 'eslint OK' }),
      },
      auditSummary: {
        executed: true,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
      },
      testRun: {
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
      },
    };

    // 1. Agent cannot start quick tier
    const agentQuick = handleWorkflowCommand(
      parseCliArgs([
        'workflow',
        'start',
        '--run-id',
        'run-bad',
        '--task',
        'Quick bypass',
        '--tier',
        'quick',
        '--actor',
        'agent',
        '--json',
      ]),
      ctx,
    );
    expect(agentQuick.exitCode).toBe(1);
    expect(agentQuick.stdout).toContain('TIER_DOWNGRADE_FORBIDDEN');

    // 2. Start strict workflow
    const started = handleWorkflowCommand(
      parseCliArgs([
        'workflow',
        'start',
        '--run-id',
        'run-cli-1',
        '--task',
        'Build React dashboard',
        '--plan',
        'docs/plan.md',
        '--json',
      ]),
      ctx,
    );
    expect(started.exitCode).toBe(0);

    // 3. Register authors and test anti-self-approval via CLI
    expect(
      handleWorkflowCommand(
        parseCliArgs([
          'workflow',
          'register-author',
          '--kind',
          'plan',
          '--actor-id',
          'planner-1',
          '--json',
        ]),
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(
      handleWorkflowCommand(
        parseCliArgs([
          'workflow',
          'register-author',
          '--kind',
          'code',
          '--actor-id',
          'dev-1',
          '--json',
        ]),
        ctx,
      ).exitCode,
    ).toBe(0);

    const selfReview = handleWorkflowCommand(
      parseCliArgs([
        'workflow',
        'record-review',
        '--gate',
        'GATE_01',
        '--role',
        'intake-reviewer',
        '--reviewer-id',
        'planner-1',
        '--approved',
        '--summary',
        'Self approval attempt',
        '--json',
      ]),
      ctx,
    );
    expect(selfReview.exitCode).toBe(1);
    expect(selfReview.stdout).toContain('SELF_APPROVAL_FORBIDDEN');

    // 4. Record independent reviews for Gate 01 and run Gate 01
    expect(
      handleWorkflowCommand(
        parseCliArgs([
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
          'Intake approved',
        ]),
        ctx,
      ).exitCode,
    ).toBe(0);
    expect(
      handleWorkflowCommand(
        parseCliArgs([
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
          'Architecture approved',
        ]),
        ctx,
      ).exitCode,
    ).toBe(0);

    expect(
      handleWorkflowCommand(parseCliArgs(['workflow', 'advance', 'PLANNING']), ctx).exitCode,
    ).toBe(0);
    expect(
      handleWorkflowCommand(parseCliArgs(['workflow', 'advance', 'GATE_01']), ctx).exitCode,
    ).toBe(0);

    const g1Run = handleGateCommand(parseCliArgs(['gate', 'run', '01', '--json']), ctx);
    expect(g1Run.exitCode).toBe(0);

    expect(
      handleWorkflowCommand(parseCliArgs(['workflow', 'advance', 'IMPLEMENTATION']), ctx).exitCode,
    ).toBe(0);

    // 5. Gate 02 fail -> test non-TTY override rejection -> then TTY human override
    const g2Fail = handleGateCommand(parseCliArgs(['gate', 'run', '02', '--json']), ctx);
    expect(g2Fail.exitCode).toBe(1);

    const nonTtyOverride = handleGateCommand(
      parseCliArgs([
        'gate',
        'override',
        'GATE_02',
        '--reason',
        'Attempt from non-TTY agent',
        '--approver',
        'bot',
        '--yes',
        '--json',
      ]),
      { ...ctx, isInteractiveTty: false },
    );
    expect(nonTtyOverride.exitCode).toBe(1);

    const ttyOverride = handleGateCommand(
      parseCliArgs([
        'gate',
        'override',
        'GATE_02',
        '--reason',
        'Approved pre-test waiver in interactive terminal',
        '--approver',
        'jay-r',
        '--yes',
        '--json',
      ]),
      { ...ctx, isInteractiveTty: true, actorType: 'human' },
    );
    expect(ttyOverride.exitCode).toBe(0);

    // 6. Status commands (workflow status & gate status)
    const wfStatus = handleWorkflowCommand(parseCliArgs(['workflow', 'status', '--json']), ctx);
    expect(wfStatus.exitCode).toBe(0);
    expect((JSON.parse(wfStatus.stdout) as { runId: string }).runId).toBe('run-cli-1');

    const gateStatus = handleGateCommand(parseCliArgs(['gate', 'status', '--json']), ctx);
    expect(gateStatus.exitCode).toBe(0);
  });
});
