import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computePluginDigest } from './digest.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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

describe('computePluginDigest', () => {
  it('returns sha256:<64-hex> deterministically regardless of input order, separators, or duplicates', () => {
    const pluginRoot = createTempDir('donaron-digest-');
    mkdirSync(join(pluginRoot, 'rules'), { recursive: true });
    mkdirSync(join(pluginRoot, 'skills', 'plan'), { recursive: true });
    const manifestBytes = Buffer.from('{"name":"demo"}\n', 'utf8');
    const ruleBytes = Buffer.from('# Security Rule\n', 'utf8');
    const skillBytes = Buffer.from([0x23, 0x20, 0x00, 0xff, 0x0a]);
    writeFileSync(join(pluginRoot, 'plugin.json'), manifestBytes);
    writeFileSync(join(pluginRoot, 'rules', 'security.md'), ruleBytes);
    writeFileSync(join(pluginRoot, 'skills', 'plan', 'SKILL.md'), skillBytes);

    const expectedHash = createHash('sha256');
    for (const [relPath, bytes] of [
      ['plugin.json', manifestBytes],
      ['rules/security.md', ruleBytes],
      ['skills/plan/SKILL.md', skillBytes],
    ] as const) {
      expectedHash.update(relPath, 'utf8');
      expectedHash.update('\0', 'utf8');
      expectedHash.update(String(bytes.byteLength), 'utf8');
      expectedHash.update('\0', 'utf8');
      expectedHash.update(bytes);
    }
    const expectedDigest = `sha256:${expectedHash.digest('hex')}`;

    const digestForward = computePluginDigest(pluginRoot, [
      'plugin.json',
      'rules/security.md',
      'skills/plan/SKILL.md',
    ]);
    const digestReversedWin = computePluginDigest(pluginRoot, [
      './skills\\plan\\SKILL.md',
      'rules\\security.md',
      'plugin.json',
      'rules/security.md',
    ]);

    expect(digestForward).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestForward).toBe(expectedDigest);
    expect(digestReversedWin).toBe(digestForward);
  });

  it('changes when file content changes', () => {
    const pluginRoot = createTempDir('donaron-digest-content-');
    writeFileSync(join(pluginRoot, 'a.txt'), 'hello', 'utf8');

    const before = computePluginDigest(pluginRoot, ['a.txt']);
    writeFileSync(join(pluginRoot, 'a.txt'), 'hello!', 'utf8');
    const after = computePluginDigest(pluginRoot, ['a.txt']);

    expect(after).not.toBe(before);
  });

  it('changes when relative path changes even with identical contents and boundary splits', () => {
    const rootOne = createTempDir('donaron-digest-path-1-');
    const rootTwo = createTempDir('donaron-digest-path-2-');

    writeFileSync(join(rootOne, 'a.txt'), 'bc', 'utf8');
    writeFileSync(join(rootTwo, 'b.txt'), 'bc', 'utf8');
    expect(computePluginDigest(rootTwo, ['b.txt'])).not.toBe(
      computePluginDigest(rootOne, ['a.txt']),
    );

    const boundaryOne = createTempDir('donaron-digest-boundary-1-');
    const boundaryTwo = createTempDir('donaron-digest-boundary-2-');
    writeFileSync(join(boundaryOne, 'a'), 'bc', 'utf8');
    writeFileSync(join(boundaryTwo, 'ab'), 'c', 'utf8');
    expect(computePluginDigest(boundaryTwo, ['ab'])).not.toBe(
      computePluginDigest(boundaryOne, ['a']),
    );
  });

  it('computes a deterministic digest for an empty file list on an existing root', () => {
    const pluginRoot = createTempDir('donaron-digest-empty-');
    const digest = computePluginDigest(pluginRoot, []);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computePluginDigest(pluginRoot, [])).toBe(digest);
  });

  it('throws descriptive errors for unsafe paths, missing files, external symlinks, and directories', () => {
    const workspace = createTempDir('donaron-digest-err-');
    const pluginRoot = join(workspace, 'plugin');
    const outsideDir = join(workspace, 'outside');
    mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret', 'utf8');
    symlinkSync(resolve(outsideDir), join(pluginRoot, 'escape'), 'junction');

    expect(() => computePluginDigest(pluginRoot, ['../outside/secret.txt'])).toThrow();
    expect(() => computePluginDigest(pluginRoot, ['escape/secret.txt'])).toThrow();
    expect(() => computePluginDigest(pluginRoot, ['missing.txt'])).toThrow();
    expect(() => computePluginDigest(pluginRoot, ['skills'])).toThrow(/regular file/i);
    expect(() => computePluginDigest(join(workspace, 'nonexistent'), [])).toThrow();
  });
});
