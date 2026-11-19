import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DONARON_CLI_VERSION, getCliInfo, runCli } from './index.js';

const CLI_DIST = resolve(import.meta.dirname, '../dist/cli.js');

describe('@donaron/cli baseline', () => {
  it('resolves all three downstream workspace modules in getCliInfo()', () => {
    const info = getCliInfo();
    expect(info.name).toBe('@donaron/cli');
    expect(info.version).toBe(DONARON_CLI_VERSION);
    expect(info.modules.map((m) => m.name)).toEqual([
      '@donaron/core',
      '@donaron/gates',
      '@donaron/adapters',
    ]);
  });

  it('prints version for --version and -v', () => {
    expect(runCli(['--version'])).toEqual({
      exitCode: 0,
      stdout: `donaron ${DONARON_CLI_VERSION}\n`,
      stderr: '',
    });
    expect(runCli(['-v'])).toEqual({
      exitCode: 0,
      stdout: `donaron ${DONARON_CLI_VERSION}\n`,
      stderr: '',
    });
  });

  it('prints baseline usage for --help, -h, and empty args', () => {
    for (const argv of [['--help'], ['-h'], []]) {
      const result = runCli(argv);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('donaron');
      expect(result.stderr).toBe('');
    }
  });

  it('returns exitCode 1 and error message on unknown arguments', () => {
    const result = runCli(['--unknown']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--unknown');
  });

  it('executes compiled dist/cli.js directly with Node ESM resolution', () => {
    expect(existsSync(CLI_DIST)).toBe(true);
    const proc = spawnSync(process.execPath, [CLI_DIST, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toBe(`donaron ${DONARON_CLI_VERSION}\n`);
    expect(proc.stderr).toBe('');
  });
});
