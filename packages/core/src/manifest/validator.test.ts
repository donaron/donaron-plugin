import { describe, expect, it } from 'vitest';
import type { DonAronManifest } from '../types.js';
import {
  SUPPORTED_MANIFEST_VERSION,
  isCompatibleWithCoreVersion,
  validateManifest,
} from './validator.js';

function createMinimalManifest(): DonAronManifest {
  return {
    manifestVersion: '1',
    id: 'donaron-dev',
    name: 'donaron-dev',
    version: '0.1.0',
    description: 'Flagship DonAron Node + React workflow plugin.',
    compatibility: {
      donaronPlugin: '^0.1.0',
    },
    permissions: ['fs:read'],
    capabilities: {
      skills: ['skills/planning/SKILL.md'],
    },
  };
}

function createFullManifest(): DonAronManifest {
  return {
    $schema: 'https://donaron.dev/schemas/donaron-plugin.v1.schema.json',
    manifestVersion: '1',
    id: 'org.donaron.dev-pack_1',
    name: 'donaron-dev',
    displayName: 'DonAron Dev Pack',
    version: '1.2.3-rc.1+build.42',
    description: 'Complete workflow plugin with skills, agents, rules, hooks, tools, and policies.',
    author: {
      name: 'DonAron Team',
      url: 'https://example.com/donaron',
    },
    license: 'MIT',
    homepage: 'https://example.com/donaron-dev',
    repository: {
      type: 'git',
      url: 'https://github.com/example/donaron-dev.git',
    },
    logo: 'assets/logo.svg',
    suggestedPrompts: [
      'Plan a new feature strictly',
      'Run pre-test review',
      'Verify coverage gates',
    ],
    compatibility: {
      donaronPlugin: '>=0.1.0 <2.0.0',
      harnesses: {
        antigravity: '>=1.0.0',
        'claude-code': '^1.0.0',
      },
    },
    permissions: ['fs:read', 'fs:write', 'cmd:exec', 'net:outbound', 'env:read'],
    capabilities: {
      skills: ['skills/node-react-planning/SKILL.md', './skills/node-react-implement/SKILL.md'],
      agents: ['agents/reviewer.md'],
      rules: ['rules/security.md'],
      hooks: ['hooks/hooks.json'],
      tools: ['tools/mcp.json'],
      policies: ['policies/default.json'],
    },
    dependencies: [
      {
        id: 'base-utils',
        versionRange: '^1.0.0',
      },
    ],
  };
}

describe('validateManifest', () => {
  it('exports SUPPORTED_MANIFEST_VERSION as "1"', () => {
    expect(SUPPORTED_MANIFEST_VERSION).toBe('1');
  });

  it('accepts a valid minimal manifest', () => {
    const manifest = createMinimalManifest();
    const result = validateManifest(manifest);

    expect(result).toEqual({ ok: true, value: manifest });
  });

  it('accepts a valid full manifest with string author and repository variants', () => {
    const full = createFullManifest();
    expect(validateManifest(full)).toEqual({ ok: true, value: full });

    const stringVariants: DonAronManifest = {
      ...full,
      author: 'DonAron Maintainer',
      repository: 'https://github.com/example/donaron-dev',
      logo: 'assets/icon.webp',
      permissions: [],
    };
    expect(validateManifest(stringVariants)).toEqual({ ok: true, value: stringVariants });
  });

  it('accepts safe relative paths that contain double dots inside a segment name', () => {
    const manifest: DonAronManifest = {
      ...createMinimalManifest(),
      capabilities: {
        skills: ['skills/v1..v2/SKILL.md'],
      },
    };

    expect(validateManifest(manifest).ok).toBe(true);
  });

  it('rejects unknown top-level and nested fields', () => {
    const unknownTop = { ...createMinimalManifest(), unexpected: true };
    const topRes = validateManifest(unknownTop);
    expect(topRes.ok).toBe(false);
    if (!topRes.ok) {
      expect(topRes.issues.length).toBeGreaterThan(0);
    }

    const unknownCompat = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '^0.1.0', unknownFlag: 'x' },
    };
    expect(validateManifest(unknownCompat).ok).toBe(false);

    const unknownCaps = {
      ...createMinimalManifest(),
      capabilities: { unknownCap: ['foo.md'] },
    };
    expect(validateManifest(unknownCaps).ok).toBe(false);

    const unknownDep = {
      ...createMinimalManifest(),
      dependencies: [{ id: 'base-utils', versionRange: '^1.0.0', extra: 1 }],
    };
    expect(validateManifest(unknownDep).ok).toBe(false);

    const unknownAuthor = {
      ...createMinimalManifest(),
      author: { name: 'Alice', email: 'alice@example.com' },
    };
    expect(validateManifest(unknownAuthor).ok).toBe(false);

    const unknownRepo = {
      ...createMinimalManifest(),
      repository: { type: 'git', url: 'https://github.com/a/b', branch: 'main' },
    };
    expect(validateManifest(unknownRepo).ok).toBe(false);
  });

  it('rejects unsupported manifestVersion values', () => {
    const v2 = { ...createMinimalManifest(), manifestVersion: '2' };
    const result = validateManifest(v2);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes('manifestVersion'))).toBe(true);
    }
  });

  it('rejects invalid plugin ids and empty/whitespace-only required strings', () => {
    for (const badId of ['a', 'BadId', '-leading-dash', 'has space', 'a'.repeat(129)]) {
      expect(validateManifest({ ...createMinimalManifest(), id: badId }).ok).toBe(false);
    }

    for (const blank of ['', '   ', '\t\n']) {
      expect(validateManifest({ ...createMinimalManifest(), name: blank }).ok).toBe(false);
      expect(validateManifest({ ...createMinimalManifest(), description: blank }).ok).toBe(false);
    }
  });

  it('rejects invalid semver versions and invalid semver ranges', () => {
    const badVersion = validateManifest({ ...createMinimalManifest(), version: 'not-semver' });
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) {
      expect(badVersion.issues.some((issue) => issue.path === '/version')).toBe(true);
    }

    for (const badRange of ['???', '   ', '1.2.3.4']) {
      const badCompat = validateManifest({
        ...createMinimalManifest(),
        compatibility: { donaronPlugin: badRange },
      });
      expect(badCompat.ok).toBe(false);
      if (!badCompat.ok) {
        expect(
          badCompat.issues.some((issue) => issue.path === '/compatibility/donaronPlugin'),
        ).toBe(true);
      }

      const badDep = validateManifest({
        ...createMinimalManifest(),
        dependencies: [{ id: 'other-plugin', versionRange: badRange }],
      });
      expect(badDep.ok).toBe(false);
      if (!badDep.ok) {
        expect(badDep.issues.some((issue) => issue.path === '/dependencies/0/versionRange')).toBe(
          true,
        );
      }
    }
  });

  it('rejects invalid or duplicate permissions', () => {
    expect(validateManifest({ ...createMinimalManifest(), permissions: ['fs:admin'] }).ok).toBe(
      false,
    );
    expect(
      validateManifest({ ...createMinimalManifest(), permissions: ['fs:read', 'fs:read'] }).ok,
    ).toBe(false);
  });

  it('rejects more than 3 suggestedPrompts or empty suggestedPrompts items', () => {
    expect(
      validateManifest({
        ...createMinimalManifest(),
        suggestedPrompts: ['One', 'Two', 'Three', 'Four'],
      }).ok,
    ).toBe(false);

    expect(
      validateManifest({
        ...createMinimalManifest(),
        suggestedPrompts: ['Valid', '   '],
      }).ok,
    ).toBe(false);
  });

  it('rejects non-HTTPS homepage, repository, and author urls', () => {
    expect(
      validateManifest({ ...createMinimalManifest(), homepage: 'http://example.com' }).ok,
    ).toBe(false);
    expect(validateManifest({ ...createMinimalManifest(), homepage: 'https://' }).ok).toBe(false);
    expect(validateManifest({ ...createMinimalManifest(), homepage: 'not-a-url' }).ok).toBe(false);

    expect(
      validateManifest({ ...createMinimalManifest(), repository: 'http://github.com/a/b' }).ok,
    ).toBe(false);
    expect(
      validateManifest({
        ...createMinimalManifest(),
        repository: { type: 'svn', url: 'https://github.com/a/b' },
      }).ok,
    ).toBe(false);
    expect(
      validateManifest({
        ...createMinimalManifest(),
        repository: { type: 'git', url: 'git://github.com/a/b.git' },
      }).ok,
    ).toBe(false);
    expect(
      validateManifest({
        ...createMinimalManifest(),
        author: { name: 'Alice', url: 'http://example.com' },
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid logo extensions, remote logo URLs, and unsafe logo paths', () => {
    for (const badLogo of [
      'assets/logo.gif',
      'assets/logo.PNG',
      'https://example.com/logo.png',
      '../logo.png',
      '/assets/logo.svg',
      'C:\\assets\\logo.png',
    ]) {
      expect(validateManifest({ ...createMinimalManifest(), logo: badLogo }).ok).toBe(false);
    }

    for (const goodLogo of ['logo.png', 'assets/logo.svg', 'img/a.jpg', 'img/b.jpeg', 'c.webp']) {
      expect(validateManifest({ ...createMinimalManifest(), logo: goodLogo }).ok).toBe(true);
    }
  });

  it('rejects absolute, drive-prefixed, null-byte, newline, and traversal capability paths', () => {
    const unsafePaths = [
      '../evil.md',
      '..\\evil.md',
      'skills/../../evil.md',
      'skills/..',
      '..',
      '/etc/passwd',
      '\\Windows\\System32\\cmd.exe',
      'C:\\evil.md',
      'c:/evil.md',
      'skills/foo\0bar.md',
      'skills/foo\n/../bar.md',
      'https://example.com/SKILL.md',
      '',
      '   ',
    ];

    for (const unsafePath of unsafePaths) {
      const result = validateManifest({
        ...createMinimalManifest(),
        capabilities: { skills: [unsafePath] },
      });
      expect(result.ok, `Expected unsafe path to fail: ${JSON.stringify(unsafePath)}`).toBe(false);
    }
  });

  it('fails gracefully without throwing for non-object, null, undefined, and array inputs', () => {
    for (const raw of [null, undefined, 'string', 42, true, [], {}]) {
      const result = validateManifest(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) {
          expect(issue.code.length).toBeGreaterThan(0);
          expect(issue.path.length).toBeGreaterThan(0);
          expect(issue.message.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('isCompatibleWithCoreVersion', () => {
  it('returns true when coreVersion satisfies compatibility.donaronPlugin', () => {
    const manifest: DonAronManifest = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '^1.0.0' },
    };

    expect(isCompatibleWithCoreVersion(manifest, '1.2.0')).toBe(true);
  });

  it('returns false when coreVersion does not satisfy compatibility.donaronPlugin', () => {
    const manifest: DonAronManifest = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '^2.0.0' },
    };

    expect(isCompatibleWithCoreVersion(manifest, '1.2.0')).toBe(false);
  });

  it('returns false without throwing for empty or invalid coreVersion or range', () => {
    const manifest: DonAronManifest = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '^1.0.0' },
    };

    expect(isCompatibleWithCoreVersion(manifest, '')).toBe(false);
    expect(isCompatibleWithCoreVersion(manifest, '   ')).toBe(false);
    expect(isCompatibleWithCoreVersion(manifest, 'not-semver')).toBe(false);

    const invalidRangeManifest: DonAronManifest = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '???' },
    };
    expect(isCompatibleWithCoreVersion(invalidRangeManifest, '1.2.0')).toBe(false);

    const emptyRangeManifest: DonAronManifest = {
      ...createMinimalManifest(),
      compatibility: { donaronPlugin: '   ' },
    };
    expect(isCompatibleWithCoreVersion(emptyRangeManifest, '1.2.0')).toBe(false);
  });
});
