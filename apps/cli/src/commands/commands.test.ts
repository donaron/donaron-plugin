import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
