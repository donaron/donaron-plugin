import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('Phase 1 repository hygiene', () => {
  it('ignores runtime state, secrets, build, and coverage outputs', () => {
    const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf8');
    for (const pattern of ['.donaron/', '.env', '.env.*', 'dist/', 'coverage/', 'node_modules/']) {
      expect(gitignore).toContain(pattern);
    }
  });

  it('enforces ESM and Node >=24.0.0 in root package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      type?: string;
      engines?: { node?: string };
    };
    expect(pkg.type).toBe('module');
    expect(pkg.engines?.node).toBe('>=24.0.0');
  });

  it('declares all three workspace globs in pnpm-workspace.yaml', () => {
    const workspace = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('packages/*');
    expect(workspace).toContain('apps/*');
    expect(workspace).toContain('plugins/*');
  });

  it('enforces LF line endings in .gitattributes and .prettierrc.json', () => {
    const gitattributes = readFileSync(resolve(ROOT, '.gitattributes'), 'utf8');
    const prettier = JSON.parse(readFileSync(resolve(ROOT, '.prettierrc.json'), 'utf8')) as {
      endOfLine?: string;
    };
    expect(gitattributes).toContain('eol=lf');
    expect(prettier.endOfLine).toBe('lf');
  });
});
