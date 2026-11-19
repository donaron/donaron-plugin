import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('Phase 1 build boundaries and deliverables', () => {
  it('emits ESM .js and .d.ts build artifacts for every TypeScript workspace', () => {
    const expectedArtifacts = [
      'packages/core/dist/index.js',
      'packages/core/dist/index.d.ts',
      'packages/gates/dist/index.js',
      'packages/gates/dist/index.d.ts',
      'packages/adapters/dist/index.js',
      'packages/adapters/dist/index.d.ts',
      'apps/cli/dist/index.js',
      'apps/cli/dist/index.d.ts',
      'apps/cli/dist/cli.js',
    ];

    for (const relPath of expectedArtifacts) {
      expect(existsSync(resolve(ROOT, relPath)), `Missing built artifact: ${relPath}`).toBe(true);
    }
  });

  it('enforces core independence with zero internal or harness dependencies in @donaron/core', () => {
    const corePkg = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(corePkg.dependencies ?? {}).toEqual({});
  });

  it('includes all required Phase 1 documentation and committed spec artifacts', () => {
    const requiredDocs = [
      'README.md',
      'docs/architecture.md',
      'docs/decisions.md',
      'docs/superpowers/specs/2026-11-19-donaron-plugin-design.md',
      'docs/superpowers/plans/2026-11-19-phase-1-foundation.md',
    ];

    for (const relPath of requiredDocs) {
      expect(existsSync(resolve(ROOT, relPath)), `Missing Phase 1 doc: ${relPath}`).toBe(true);
    }
  });

  it('type-checks test files via tsconfig.typecheck.json and enables strictTypeChecked ESLint rules', () => {
    expect(existsSync(resolve(ROOT, 'tsconfig.typecheck.json'))).toBe(true);
    const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPkg.scripts?.typecheck).toContain('tsconfig.typecheck.json');
    expect(rootPkg.scripts?.check).toContain('tsconfig.typecheck.json');

    const eslintConfig = readFileSync(resolve(ROOT, 'eslint.config.js'), 'utf8');
    expect(eslintConfig).toContain('strictTypeChecked');
    expect(eslintConfig).toContain('tsconfig.typecheck.json');
  });

  it('builds workspace project references before running test and test:coverage scripts', () => {
    const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPkg.scripts?.test).toMatch(/^tsc --build && vitest run$/);
    expect(rootPkg.scripts?.['test:coverage']).toMatch(/^tsc --build && vitest run --coverage$/);
  });
});
