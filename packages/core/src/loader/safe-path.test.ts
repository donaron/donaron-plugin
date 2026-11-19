import type * as nodeFs from 'node:fs';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSafePluginPath } from './safe-path.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
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

describe('resolveSafePluginPath', () => {
  it('resolves normal nested paths and normalizes Windows separators and dot segments to POSIX', () => {
    const pluginRoot = createTempDir('donaron-safe-path-');
    mkdirSync(join(pluginRoot, 'skills', 'my-skill'), { recursive: true });
    mkdirSync(join(pluginRoot, 'rules'), { recursive: true });
    const skillPath = join(pluginRoot, 'skills', 'my-skill', 'SKILL.md');
    const rulePath = join(pluginRoot, 'rules', 'security.md');
    writeFileSync(skillPath, '# Skill\n', 'utf8');
    writeFileSync(rulePath, '# Security\n', 'utf8');

    const skillResult = resolveSafePluginPath(pluginRoot, 'skills/my-skill/SKILL.md', {
      mustExist: true,
    });
    expect(skillResult).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(skillPath),
        relativePosixPath: 'skills/my-skill/SKILL.md',
      },
    });

    const winSepResult = resolveSafePluginPath(pluginRoot, 'rules\\security.md', {
      mustExist: true,
    });
    expect(winSepResult).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(rulePath),
        relativePosixPath: 'rules/security.md',
      },
    });

    const dotPrefixResult = resolveSafePluginPath(pluginRoot, './skills//my-skill/./SKILL.md');
    expect(dotPrefixResult).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(skillPath),
        relativePosixPath: 'skills/my-skill/SKILL.md',
      },
    });

    const rootDotResult = resolveSafePluginPath(pluginRoot, '.', { mustExist: true });
    expect(rootDotResult).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(pluginRoot),
        relativePosixPath: '.',
      },
    });
  });

  it('allows safe segment names containing double dots that are not traversal segments', () => {
    const pluginRoot = createTempDir('donaron-safe-dots-');
    const targetDir = join(pluginRoot, 'skills', 'v1..v2');
    mkdirSync(targetDir, { recursive: true });
    const filePath = join(targetDir, 'SKILL.md');
    writeFileSync(filePath, '# v1..v2\n', 'utf8');

    const result = resolveSafePluginPath(pluginRoot, 'skills/v1..v2/SKILL.md', { mustExist: true });
    expect(result).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(filePath),
        relativePosixPath: 'skills/v1..v2/SKILL.md',
      },
    });
  });

  it('rejects traversal, null bytes, empty strings, absolute paths, drive paths, and UNC paths', () => {
    const pluginRoot = createTempDir('donaron-unsafe-path-');

    const unsafeInputs = [
      '../outside.txt',
      '..\\outside.txt',
      'skills/../../outside.txt',
      'skills\\..\\..\\outside.txt',
      '..',
      'skills/..',
      'foo\0bar',
      'skills/foo\nbar.md',
      '',
      '   ',
      '\t\n',
      '/etc/passwd',
      '\\Windows\\System32\\cmd.exe',
      'C:\\Windows\\win.ini',
      'c:/Windows/win.ini',
      'C:foo.txt',
      '\\\\server\\share\\file.txt',
      '//server/share/file.txt',
      'file.txt:Zone.Identifier',
      'https://example.com/SKILL.md',
    ];

    for (const input of unsafeInputs) {
      const result = resolveSafePluginPath(pluginRoot, input);
      expect(result.ok, `Expected rejection for ${JSON.stringify(input)}`).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) {
          expect(issue.code.length).toBeGreaterThan(0);
          expect(issue.message.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('returns ROOT_NOT_FOUND when pluginRoot is empty or missing and rejects non-directory roots', () => {
    const baseDir = createTempDir('donaron-root-check-');
    const missingRoot = join(baseDir, 'does-not-exist');

    const emptyRootResult = resolveSafePluginPath('   ', 'skills/a/SKILL.md');
    expect(emptyRootResult.ok).toBe(false);
    if (!emptyRootResult.ok) {
      expect(emptyRootResult.issues[0]?.code).toBe('ROOT_NOT_FOUND');
    }

    const missingResult = resolveSafePluginPath(missingRoot, 'skills/a/SKILL.md');
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.issues[0]?.code).toBe('ROOT_NOT_FOUND');
    }

    const fileRoot = join(baseDir, 'not-a-dir.txt');
    writeFileSync(fileRoot, 'hello', 'utf8');
    const fileResult = resolveSafePluginPath(fileRoot, 'SKILL.md');
    expect(fileResult.ok).toBe(false);
    if (!fileResult.ok) {
      expect(fileResult.issues[0]?.code).toBe('ROOT_NOT_DIRECTORY');
    }
  });

  it('enforces mustExist: true with PATH_NOT_FOUND while allowing non-existent paths when mustExist is false', () => {
    const pluginRoot = createTempDir('donaron-exist-check-');
    mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
    writeFileSync(join(pluginRoot, 'file.txt'), 'content', 'utf8');

    const missingStrict = resolveSafePluginPath(pluginRoot, 'skills/missing/SKILL.md', {
      mustExist: true,
    });
    expect(missingStrict.ok).toBe(false);
    if (!missingStrict.ok) {
      expect(missingStrict.issues[0]?.code).toBe('PATH_NOT_FOUND');
    }

    const underFileStrict = resolveSafePluginPath(pluginRoot, 'file.txt/sub.md', {
      mustExist: true,
    });
    expect(underFileStrict.ok).toBe(false);
    if (!underFileStrict.ok) {
      expect(underFileStrict.issues[0]?.code).toBe('PATH_NOT_FOUND');
    }

    const missingPermissive = resolveSafePluginPath(pluginRoot, 'skills/future/nested/SKILL.md', {
      mustExist: false,
    });
    expect(missingPermissive).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(pluginRoot, 'skills', 'future', 'nested', 'SKILL.md'),
        relativePosixPath: 'skills/future/nested/SKILL.md',
      },
    });
  });

  it('handles Windows root case differences without false negatives', () => {
    const pluginRoot = createTempDir('donaron-case-');
    const filePath = join(pluginRoot, 'README.md');
    writeFileSync(filePath, '# Plugin\n', 'utf8');

    const firstChar = pluginRoot.slice(0, 1);
    const toggledFirst =
      firstChar === firstChar.toLowerCase() ? firstChar.toUpperCase() : firstChar.toLowerCase();
    const toggledRoot =
      process.platform === 'win32' ? `${toggledFirst}${pluginRoot.slice(1)}` : pluginRoot;

    const result = resolveSafePluginPath(toggledRoot, 'README.md', { mustExist: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relativePosixPath).toBe('README.md');
    }
  });

  it('rejects real symlink/junction escapes including sibling-prefix directories and non-existent targets', () => {
    const workspace = createTempDir('donaron-symlink-');
    const pluginRoot = join(workspace, 'plugin');
    const outsideDir = join(workspace, 'outside');
    const siblingPrefixDir = join(workspace, 'plugin-sibling');
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(siblingPrefixDir, { recursive: true });
    writeFileSync(join(outsideDir, 'secret.txt'), 'TOP_SECRET', 'utf8');
    writeFileSync(join(siblingPrefixDir, 'secret.txt'), 'SIBLING_SECRET', 'utf8');

    const escapeLink = join(pluginRoot, 'escape');
    symlinkSync(resolve(outsideDir), escapeLink, 'junction');

    const siblingLink = join(pluginRoot, 'sibling');
    symlinkSync(resolve(siblingPrefixDir), siblingLink, 'junction');

    const existingEscape = resolveSafePluginPath(pluginRoot, 'escape/secret.txt', {
      mustExist: true,
    });
    expect(existingEscape.ok).toBe(false);

    const siblingEscape = resolveSafePluginPath(pluginRoot, 'sibling/secret.txt', {
      mustExist: true,
    });
    expect(siblingEscape.ok).toBe(false);

    const missingEscape = resolveSafePluginPath(pluginRoot, 'escape/nonexistent.txt', {
      mustExist: false,
    });
    expect(missingEscape.ok).toBe(false);

    const nestedMissingEscape = resolveSafePluginPath(
      pluginRoot,
      'escape/deep/nested/nonexistent.txt',
      { mustExist: false },
    );
    expect(nestedMissingEscape.ok).toBe(false);

    const brokenOutsideTarget = join(workspace, 'outside-missing');
    const brokenEscapeLink = join(pluginRoot, 'broken-escape');
    symlinkSync(resolve(brokenOutsideTarget), brokenEscapeLink, 'junction');

    const brokenEscape = resolveSafePluginPath(pluginRoot, 'broken-escape/file.txt', {
      mustExist: false,
    });
    expect(brokenEscape.ok).toBe(false);
  });

  it('allows internal symlinks/junctions whose resolved targets stay inside pluginRoot', () => {
    const workspace = createTempDir('donaron-internal-link-');
    const pluginRoot = join(workspace, 'plugin');
    const realSkills = join(pluginRoot, 'real-skills');
    mkdirSync(realSkills, { recursive: true });
    const targetFile = join(realSkills, 'SKILL.md');
    writeFileSync(targetFile, '# Internal\n', 'utf8');

    const aliasLink = join(pluginRoot, 'alias-skills');
    symlinkSync(resolve(realSkills), aliasLink, 'junction');

    const result = resolveSafePluginPath(pluginRoot, 'alias-skills/SKILL.md', { mustExist: true });
    expect(result).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(targetFile),
        relativePosixPath: 'real-skills/SKILL.md',
      },
    });

    const brokenInternalLink = join(pluginRoot, 'broken-internal');
    symlinkSync(resolve(join(pluginRoot, 'future-dir')), brokenInternalLink, 'junction');

    const brokenInternalMissing = resolveSafePluginPath(pluginRoot, 'broken-internal/file.txt', {
      mustExist: true,
    });
    expect(brokenInternalMissing.ok).toBe(false);
    if (!brokenInternalMissing.ok) {
      expect(brokenInternalMissing.issues[0]?.code).toBe('PATH_NOT_FOUND');
    }

    const brokenInternalPermissive = resolveSafePluginPath(pluginRoot, 'broken-internal/file.txt', {
      mustExist: false,
    });
    expect(brokenInternalPermissive).toEqual({
      ok: true,
      value: {
        absolutePath: resolve(pluginRoot, 'future-dir', 'file.txt'),
        relativePosixPath: 'future-dir/file.txt',
      },
    });
  });

  it('rejects a broken symlink inside an escaping parent symlink/junction even if its target points inside pluginRoot', () => {
    const workspace = createTempDir('donaron-broken-escape-parent-');
    const pluginRoot = join(workspace, 'plugin');
    const outsideDir = join(workspace, 'outside');
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    symlinkSync(resolve(outsideDir), join(pluginRoot, 'escape'), 'junction');
    symlinkSync(resolve(pluginRoot, 'anything'), join(outsideDir, 'broken'), 'junction');

    const directBroken = resolveSafePluginPath(pluginRoot, 'escape/broken', { mustExist: false });
    expect(directBroken.ok).toBe(false);
    if (!directBroken.ok) {
      expect(directBroken.issues[0]?.code).toBe('SYMLINK_ESCAPE');
    }

    const nestedBroken = resolveSafePluginPath(pluginRoot, 'escape/broken/file.txt', {
      mustExist: false,
    });
    expect(nestedBroken.ok).toBe(false);
    if (!nestedBroken.ok) {
      expect(nestedBroken.issues[0]?.code).toBe('SYMLINK_ESCAPE');
    }
  });

  it('resolves broken relative symlink targets and cycle keys against the canonical parent directory', async () => {
    const workspace = createTempDir('donaron-broken-canonical-parent-');
    const pluginRoot = join(workspace, 'plugin');
    const nestedParent = join(pluginRoot, 'a', 'b');
    const topDir = join(pluginRoot, 'top');
    mkdirSync(nestedParent, { recursive: true });
    mkdirSync(topDir, { recursive: true });

    symlinkSync(resolve(topDir), join(nestedParent, 'sub'), 'junction');
    symlinkSync(resolve(topDir, 'placeholder-a'), join(topDir, 'broken'), 'junction');
    symlinkSync(resolve(topDir, 'placeholder-b'), join(topDir, 'cycle'), 'junction');

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actualFs = await vi.importActual<typeof nodeFs>('node:fs');
      return {
        ...actualFs,
        readlinkSync: (targetPath: Parameters<typeof actualFs.readlinkSync>[0]) => {
          if (typeof targetPath === 'string' && basename(targetPath) === 'broken') {
            return '../../outside';
          }
          if (typeof targetPath === 'string' && basename(targetPath) === 'cycle') {
            return '../a/b/sub/cycle';
          }
          return actualFs.readlinkSync(targetPath);
        },
      };
    });

    try {
      const { resolveSafePluginPath: resolveWithCanonicalCheck } = await import('./safe-path.js');

      const escapeResult = resolveWithCanonicalCheck(pluginRoot, 'a/b/sub/broken', {
        mustExist: false,
      });
      expect(escapeResult.ok).toBe(false);
      if (!escapeResult.ok) {
        expect(escapeResult.issues[0]?.code).toBe('SYMLINK_ESCAPE');
      }

      const cycleResult = resolveWithCanonicalCheck(pluginRoot, 'a/b/sub/cycle', {
        mustExist: false,
      });
      expect(cycleResult.ok).toBe(false);
      if (!cycleResult.ok) {
        expect(cycleResult.issues[0]?.code).toBe('SYMLINK_ESCAPE');
      }
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('rejects broken symlink targets whose .. segments traverse through intermediate escaping or root symlinks', async () => {
    const workspace = createTempDir('donaron-broken-dotdot-');
    const pluginRoot = join(workspace, 'plugin');
    const outsideDeep = join(workspace, 'outside', 'a', 'b');
    const internalDeep = join(pluginRoot, 'real', 'a', 'b');
    mkdirSync(join(pluginRoot, 'sub'), { recursive: true });
    mkdirSync(outsideDeep, { recursive: true });
    mkdirSync(internalDeep, { recursive: true });

    symlinkSync(resolve(outsideDeep), join(pluginRoot, 'sub', 'escape'), 'junction');
    symlinkSync(
      resolve(join(workspace, 'outside', 'missing', 'b')),
      join(pluginRoot, 'sub', 'broken-escape'),
      'junction',
    );
    symlinkSync(resolve(pluginRoot), join(pluginRoot, 'sub', 'to-root'), 'junction');
    symlinkSync(resolve(internalDeep), join(pluginRoot, 'sub', 'internal'), 'junction');

    symlinkSync(resolve(pluginRoot, 'p-rel'), join(pluginRoot, 'broken-rel-escape'), 'junction');
    symlinkSync(resolve(pluginRoot, 'p-brk'), join(pluginRoot, 'broken-nested-escape'), 'junction');
    symlinkSync(
      resolve(pluginRoot, 'p-anch'),
      join(pluginRoot, 'broken-anchored-escape'),
      'junction',
    );
    symlinkSync(resolve(pluginRoot, 'p-root'), join(pluginRoot, 'broken-root-dotdot'), 'junction');
    symlinkSync(
      resolve(pluginRoot, 'p-int'),
      join(pluginRoot, 'broken-internal-dotdot'),
      'junction',
    );

    const sep = process.platform === 'win32' ? '\\' : '/';
    const anchoredTarget = `${pluginRoot}${sep}sub${sep}escape${sep}..${sep}pwn.txt`;

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actualFs = await vi.importActual<typeof nodeFs>('node:fs');
      return {
        ...actualFs,
        readlinkSync: (targetPath: Parameters<typeof actualFs.readlinkSync>[0]) => {
          if (typeof targetPath === 'string') {
            const name = basename(targetPath);
            if (name === 'broken-rel-escape') {
              return 'sub/escape/../pwn.txt';
            }
            if (name === 'broken-nested-escape') {
              return 'sub/broken-escape/../pwn.txt';
            }
            if (name === 'broken-anchored-escape') {
              return anchoredTarget;
            }
            if (name === 'broken-root-dotdot') {
              return 'sub/to-root/../outside.txt';
            }
            if (name === 'broken-internal-dotdot') {
              return 'sub/internal/../c.txt';
            }
          }
          return actualFs.readlinkSync(targetPath);
        },
      };
    });

    try {
      const { resolveSafePluginPath: resolveWithDotDotCheck } = await import('./safe-path.js');

      for (const relPath of [
        'broken-rel-escape',
        'broken-nested-escape',
        'broken-anchored-escape',
        'broken-root-dotdot',
      ]) {
        const res = resolveWithDotDotCheck(pluginRoot, relPath, { mustExist: false });
        expect(res.ok, `Expected SYMLINK_ESCAPE for ${relPath}`).toBe(false);
        if (!res.ok) {
          expect(res.issues[0]?.code).toBe('SYMLINK_ESCAPE');
        }
      }

      const internalOk = resolveWithDotDotCheck(pluginRoot, 'broken-internal-dotdot', {
        mustExist: false,
      });
      expect(internalOk).toEqual({
        ok: true,
        value: {
          absolutePath: resolve(pluginRoot, 'real', 'a', 'c.txt'),
          relativePosixPath: 'real/a/c.txt',
        },
      });
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
