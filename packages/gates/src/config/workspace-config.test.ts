import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectWorkspaceStack, loadWorkspaceConfig } from './workspace-config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-ws-cfg-')));
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

describe('WorkspaceStackConfig & Stack Auto-Detection', () => {
  it('detects node, python, go, rust, flutter, and custom stacks from marker files', () => {
    const nodeDir = createTempDir();
    writeFileSync(join(nodeDir, 'package.json'), '{}', 'utf8');
    expect(detectWorkspaceStack(nodeDir)).toBe('node');

    const pyDir = createTempDir();
    writeFileSync(join(pyDir, 'pyproject.toml'), '[project]\nname="app"\n', 'utf8');
    expect(detectWorkspaceStack(pyDir)).toBe('python');

    const goDir = createTempDir();
    writeFileSync(join(goDir, 'go.mod'), 'module example.com/app\n', 'utf8');
    expect(detectWorkspaceStack(goDir)).toBe('go');

    const rustDir = createTempDir();
    writeFileSync(join(rustDir, 'Cargo.toml'), '[package]\nname="app"\n', 'utf8');
    expect(detectWorkspaceStack(rustDir)).toBe('rust');

    const flutterDir = createTempDir();
    writeFileSync(join(flutterDir, 'pubspec.yaml'), 'name: my_app\n', 'utf8');
    expect(detectWorkspaceStack(flutterDir)).toBe('flutter');

    const emptyDir = createTempDir();
    expect(detectWorkspaceStack(emptyDir)).toBe('custom');
  });

  it('loads default stack settings when .donaron/config.json is absent and applies explicit overrides when present', () => {
    const pyDir = createTempDir();
    writeFileSync(join(pyDir, 'requirements.txt'), 'pytest\n', 'utf8');

    const defaultCfg = loadWorkspaceConfig(pyDir);
    expect(defaultCfg.ok).toBe(true);
    if (defaultCfg.ok) {
      expect(defaultCfg.value.stack).toBe('python');
      expect(defaultCfg.value.testResultsFormat).toBe('junit');
      expect(defaultCfg.value.coverageFormat).toBe('lcov');
    }

    mkdirSync(join(pyDir, '.donaron'), { recursive: true });
    writeFileSync(
      join(pyDir, '.donaron', 'config.json'),
      JSON.stringify({
        stack: 'python',
        typecheckCommand: 'mypy src',
        lintCommand: 'ruff check .',
        testCommand:
          'pytest --junitxml=coverage/junit.xml --cov=src --cov-report=lcov:coverage/lcov.info',
        testResultsFormat: 'junit',
        testResultsPath: 'coverage/junit.xml',
        coverageFormat: 'lcov',
        coveragePath: 'coverage/lcov.info',
        minimumCoveragePct: 80,
        aiApplication: true,
      }),
      'utf8',
    );

    const customCfg = loadWorkspaceConfig(pyDir);
    expect(customCfg.ok).toBe(true);
    if (customCfg.ok) {
      expect(customCfg.value.typecheckCommand).toBe('mypy src');
      expect(customCfg.value.lintCommand).toBe('ruff check .');
      expect(customCfg.value.minimumCoveragePct).toBe(80);
      expect(customCfg.value.aiApplication).toBe(true);
    }
  });

  it('fails closed on malformed or invalid .donaron/config.json', () => {
    const dir = createTempDir();
    mkdirSync(join(dir, '.donaron'), { recursive: true });
    writeFileSync(join(dir, '.donaron', 'config.json'), '{bad-json', 'utf8');
    expect(loadWorkspaceConfig(dir).ok).toBe(false);

    writeFileSync(join(dir, '.donaron', 'config.json'), '[]', 'utf8');
    expect(loadWorkspaceConfig(dir).ok).toBe(false);

    writeFileSync(
      join(dir, '.donaron', 'config.json'),
      JSON.stringify({ minimumCoveragePct: 150 }),
      'utf8',
    );
    expect(loadWorkspaceConfig(dir).ok).toBe(false);
  });
});
