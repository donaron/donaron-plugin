import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../apps/cli/src/index.js';
import {
  ANTIGRAVITY_MAX_RULES_BYTES,
  mapModelTierToClaudeAlias,
} from '../../packages/adapters/src/index.js';
import { loadPlugin } from '../../packages/core/src/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-dev-e2e-')));
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

const ROOT = resolve(import.meta.dirname, '../..');
const PLUGIN_DIR = resolve(ROOT, 'plugins/donaron-dev');
const CLI_DIST = resolve(ROOT, 'apps/cli/dist/cli.js');

const EXPECTED_SKILLS = [
  'node-react-planning',
  'node-react-implement',
  'node-react-testing',
  'security-review',
  'code-review',
  'debugging',
] as const;

const EXPECTED_AGENTS = [
  'requirements-gatherer',
  'intake-reviewer',
  'solutions-architect',
  'planner',
  'explore',
  'researcher',
  'ask',
  'developer',
  'developer-tester',
  'devops',
  'worker',
  'general-purpose',
  'reviewer',
  'code-reviewer',
  'qa',
] as const;

describe('Phase 6 Flagship Personal Node + React Plugin (plugins/donaron-dev)', () => {
  it('loads and validates plugins/donaron-dev with 6 progressive skills, 15 strict agents, 4 rules, and 4 lifecycle hooks', () => {
    const loaded = loadPlugin(PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.value.manifest.id).toBe('donaron-dev');
    expect(loaded.value.skills.map((s) => s.name)).toEqual([...EXPECTED_SKILLS]);
    expect(loaded.value.agents.map((a) => a.name)).toEqual([...EXPECTED_AGENTS]);
    expect(loaded.value.rules).toHaveLength(4);
    expect(loaded.value.hooks).toHaveLength(4);

    // Also validate via CLI `donaron plugin validate`
    const cliVal = runCli(['plugin', 'validate', PLUGIN_DIR, '--json'], { cwd: ROOT });
    expect(cliVal.exitCode).toBe(0);
    const valPayload = JSON.parse(cliVal.stdout) as {
      ok: boolean;
      skillsCount: number;
      agentsCount: number;
      rulesCount: number;
      hooksCount: number;
      harnessCompatibility: Record<string, { ok: boolean }>;
    };
    expect(valPayload.ok).toBe(true);
    expect(valPayload.skillsCount).toBe(6);
    expect(valPayload.agentsCount).toBe(15);
    expect(valPayload.rulesCount).toBe(4);
    expect(valPayload.hooksCount).toBe(4);
    expect(valPayload.harnessCompatibility.antigravity?.ok).toBe(true);
    expect(valPayload.harnessCompatibility['claude-code']?.ok).toBe(true);
  });

  it('exports plugins/donaron-dev cleanly to both Antigravity (<24KB rules, root hooks.json) and Claude Code (.claude-plugin, model aliases)', () => {
    const loaded = loadPlugin(PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const outRoot = createTempDir();
    const agyOut = join(outRoot, 'agy');
    const ccOut = join(outRoot, 'cc');

    const expAgy = runCli(
      ['export', PLUGIN_DIR, '--target', 'antigravity', '--out', agyOut, '--json'],
      { cwd: ROOT, cliEntryPath: CLI_DIST },
    );
    expect(expAgy.exitCode).toBe(0);
    expect(existsSync(join(agyOut, 'plugin.json'))).toBe(true);
    expect(existsSync(join(agyOut, 'hooks.json'))).toBe(true);
    expect(existsSync(join(agyOut, 'hooks', 'hooks.json'))).toBe(false);

    const agyRules = readFileSync(join(agyOut, 'rules', 'AGENTS.md'), 'utf8');
    expect(agyRules.startsWith('---')).toBe(false);
    expect(Buffer.byteLength(agyRules, 'utf8')).toBeLessThan(ANTIGRAVITY_MAX_RULES_BYTES);

    for (const skill of loaded.value.skills) {
      expect(existsSync(join(agyOut, 'skills', skill.name, 'SKILL.md'))).toBe(true);
      for (const refPath of skill.references) {
        expect(existsSync(join(agyOut, 'skills', skill.name, refPath))).toBe(true);
      }
    }

    const expCc = runCli(
      ['export', PLUGIN_DIR, '--target', 'claude-code', '--out', ccOut, '--json'],
      { cwd: ROOT, cliEntryPath: CLI_DIST },
    );
    expect(expCc.exitCode).toBe(0);
    expect(existsSync(join(ccOut, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(ccOut, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(ccOut, 'CLAUDE.md'))).toBe(true);

    for (const agent of loaded.value.agents) {
      const ccAgent = readFileSync(join(ccOut, 'agents', `${agent.name}.md`), 'utf8');
      expect(ccAgent).toContain(`model: ${mapModelTierToClaudeAlias(agent.modelTier)}`);
    }
  });

  it('smoke-tests the exported Antigravity hooks.json commands against a Node + React workspace', () => {
    const outRoot = createTempDir();
    const agyOut = join(outRoot, 'agy-installed');
    const workspace = createTempDir();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const app = 1;\n', 'utf8');

    const expAgy = runCli(['export', PLUGIN_DIR, '--target', 'antigravity', '--out', agyOut], {
      cwd: ROOT,
      cliEntryPath: CLI_DIST,
    });
    expect(expAgy.exitCode).toBe(0);

    const hooksJson = JSON.parse(readFileSync(join(agyOut, 'hooks.json'), 'utf8')) as {
      hooks: {
        PreToolUse?: { hooks: { command: string }[] }[];
      };
    };
    const preCmd = hooksJson.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? '';
    expect(preCmd).toContain('hook antigravity PreToolUse');

    const childEnv = { ...process.env, NODE_V8_COVERAGE: '' };
    const denyProc = spawnSync(process.execPath, [CLI_DIST, 'hook', 'antigravity', 'PreToolUse'], {
      input: JSON.stringify({
        cwd: workspace,
        toolCall: { name: 'read_file', args: { Path: join(workspace, '.env') } },
      }),
      encoding: 'utf8',
      env: childEnv,
    });
    expect(denyProc.status).toBe(0);
    expect(JSON.parse(denyProc.stdout)).toMatchObject({ decision: 'deny' });
  });
});
