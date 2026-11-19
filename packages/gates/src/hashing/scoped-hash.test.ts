import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeCodeHash, computePlanHash, computeWorkspaceHashes } from './scoped-hash.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-gates-hash-')));
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

describe('scoped-hash (planHash & codeHash)', () => {
  it('computes deterministic planHash independent of file order, slash style, or CRLF vs LF', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'spec.md'), '# Spec\nRequirements details\n', 'utf8');
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\r\nTask 1\r\n', 'utf8');

    const first = computePlanHash(root, ['docs/plan.md', 'docs/spec.md']);
    const second = computePlanHash(root, ['docs\\spec.md', 'docs/plan.md', 'docs/plan.md']);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.value).toBe(first.value);

      writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nTask 1\n', 'utf8');
      const lfResult = computePlanHash(root, ['docs/plan.md', 'docs/spec.md']);
      expect(lfResult).toEqual({ ok: true, value: first.value });
    }
  });

  it('fails closed on missing workspace, empty planFiles, missing/empty plan file, or path traversal', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'empty.md'), '   \n  ', 'utf8');

    expect(computePlanHash(join(root, 'non-existent'), ['docs/plan.md']).ok).toBe(false);
    expect(computePlanHash(root, []).ok).toBe(false);
    expect(computePlanHash(root, ['docs/missing.md']).ok).toBe(false);
    expect(computePlanHash(root, ['docs/empty.md']).ok).toBe(false);
    expect(computePlanHash(root, ['../outside.md']).ok).toBe(false);
  });

  it('computes codeHash with no-git-head fallback and real git HEAD in a git repo', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

    const nonGit = computeCodeHash(root);
    expect(nonGit.ok).toBe(true);
    if (nonGit.ok) {
      expect(nonGit.value.gitHead).toBe('no-git-head');
      expect(nonGit.value.codeHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    spawnSync('git', ['init', '-b', 'main'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: root });

    const withGit = computeCodeHash(root);
    expect(withGit.ok).toBe(true);
    if (withGit.ok && nonGit.ok) {
      expect(withGit.value.gitHead).toMatch(/^[0-9a-f]{40}$/);
      expect(withGit.value.codeHash).not.toBe(nonGit.value.codeHash);
    }
  });

  it('enforces strict orthogonality between planHash, codeHash, and .donaron/ evidence writes', () => {
    const root = createTempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nInitial plan\n', 'utf8');
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 1;\n', 'utf8');
    writeFileSync(join(root, 'tests', 'app.test.ts'), 'export const t = 1;\n', 'utf8');

    const baseline = computeWorkspaceHashes(root, ['docs/plan.md']);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    // 1. Writing to .donaron/, dist/, coverage/, node_modules/, *.tsbuildinfo changes NEITHER hash
    mkdirSync(join(root, '.donaron', 'runs', 'run-1'), { recursive: true });
    writeFileSync(join(root, '.donaron', 'runs', 'run-1', 'evidence.json'), '{"ok":true}', 'utf8');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'app.js'), 'console.log(1);', 'utf8');
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), '{}', 'utf8');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '', 'utf8');
    writeFileSync(join(root, 'tsconfig.tsbuildinfo'), '{}', 'utf8');

    const afterIgnoredWrites = computeWorkspaceHashes(root, ['docs/plan.md']);
    expect(afterIgnoredWrites).toEqual(baseline);

    // 2. Editing source or test code changes codeHash ONLY, leaving planHash identical
    writeFileSync(join(root, 'src', 'app.ts'), 'export const v = 2;\n', 'utf8');
    const afterCodeEdit = computeWorkspaceHashes(root, ['docs/plan.md']);
    expect(afterCodeEdit.ok).toBe(true);
    if (!afterCodeEdit.ok) return;
    expect(afterCodeEdit.value.planHash).toBe(baseline.value.planHash);
    expect(afterCodeEdit.value.codeHash).not.toBe(baseline.value.codeHash);

    // 3. Editing plan file changes planHash ONLY, leaving codeHash identical
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\nUpdated plan\n', 'utf8');
    const afterPlanEdit = computeWorkspaceHashes(root, ['docs/plan.md']);
    expect(afterPlanEdit.ok).toBe(true);
    if (!afterPlanEdit.ok) return;
    expect(afterPlanEdit.value.planHash).not.toBe(afterCodeEdit.value.planHash);
    expect(afterPlanEdit.value.codeHash).toBe(afterCodeEdit.value.codeHash);
  });
});
