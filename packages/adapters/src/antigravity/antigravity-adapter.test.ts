import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPlugin, type LoadedPlugin } from '@donaron/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_MAX_RULES_BYTES,
  AntigravityAdapter,
  buildWindowsSafeHookCommand,
} from './antigravity-adapter.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-agy-adapter-')));
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

const SAMPLE_PLUGIN_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'plugins',
  'valid-sample',
);

describe('AntigravityAdapter', () => {
  it('reports honest capabilities and builds Windows-safe hook commands', () => {
    const adapter = new AntigravityAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.harnessId).toBe('antigravity');
    expect(caps.skills).toBe('NATIVE');
    expect(caps.rules).toBe('NATIVE');
    expect(caps.agents).toBe('NATIVE');
    expect(caps.agentPolicyEnforcement).toBe('PARTIAL');
    expect(caps.hooks).toEqual({
      sessionStart: 'NATIVE',
      preToolUse: 'NATIVE',
      postToolUse: 'NATIVE',
      stop: 'NATIVE',
    });
    expect(caps.gates).toBe('EMULATED');
    expect(caps.runtimeVerification).toBe('NATIVE');

    expect(buildWindowsSafeHookCommand(undefined, 'antigravity', 'PreToolUse')).toBe(
      'donaron hook antigravity PreToolUse',
    );
    expect(
      buildWindowsSafeHookCommand('C:\\Program Files\\donaron\\cli.js', 'antigravity', 'Stop'),
    ).toBe('node "C:/Program Files/donaron/cli.js" hook antigravity Stop');
  });

  it('validates compatibility and fails closed when rules exceed 24,000 bytes or harness is excluded', () => {
    const loaded = loadPlugin(SAMPLE_PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const adapter = new AntigravityAdapter();
    expect(adapter.validateCompatibility(loaded.value)).toEqual({ ok: true, value: true });

    // 1. Excluded harness in compatibility.harnesses
    const incompatiblePlugin: LoadedPlugin = {
      ...loaded.value,
      manifest: {
        ...loaded.value.manifest,
        compatibility: {
          donaronPlugin: '>=0.1.0',
          harnesses: { 'claude-code': '>=1.0.0' },
        },
      },
    };
    const incomRes = adapter.validateCompatibility(incompatiblePlugin);
    expect(incomRes.ok).toBe(false);
    if (!incomRes.ok) {
      expect(incomRes.issues[0]?.code).toBe('HARNESS_INCOMPATIBLE');
    }

    // 2. Compiled rules >= 24,000 bytes -> ANTIGRAVITY_RULES_SIZE_EXCEEDED
    const oversizedPlugin: LoadedPlugin = {
      ...loaded.value,
      rules: [
        {
          id: 'huge-rule',
          category: 'development',
          scope: 'global',
          priority: 100,
          body: 'X'.repeat(ANTIGRAVITY_MAX_RULES_BYTES + 100),
          sourcePath: 'rules/huge.md',
        },
      ],
    };
    const sizeRes = adapter.validateCompatibility(oversizedPlugin);
    expect(sizeRes.ok).toBe(false);
    if (!sizeRes.ok) {
      expect(sizeRes.issues[0]?.code).toBe('ANTIGRAVITY_RULES_SIZE_EXCEEDED');
    }
  });

  it('exports a native Antigravity plugin bundle with root hooks.json, filtered plugin.json, <24KB rules/AGENTS.md, skills, and agents', () => {
    const loaded = loadPlugin(SAMPLE_PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const outDir = join(createTempDir(), 'exported-agy');
    const adapter = new AntigravityAdapter();
    const exported = adapter.exportPlugin(loaded.value, outDir, {
      cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
    });

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.harnessId).toBe('antigravity');
    expect(exported.value.sourceDigest).toBe(loaded.value.digest);

    // 1. plugin.json contains ONLY Antigravity-allowed top-level fields
    const rawManifest = JSON.parse(readFileSync(join(outDir, 'plugin.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(rawManifest.name).toBe(loaded.value.manifest.name);
    expect(rawManifest.version).toBe(loaded.value.manifest.version);
    expect(rawManifest.description).toBe(loaded.value.manifest.description);
    expect(rawManifest.manifestVersion).toBeUndefined();
    expect(rawManifest.id).toBeUndefined();
    expect(rawManifest.compatibility).toBeUndefined();
    expect(rawManifest.permissions).toBeUndefined();
    expect(rawManifest.capabilities).toBeUndefined();

    // 2. Root hooks.json exists at <outDir>/hooks.json (NOT <outDir>/hooks/hooks.json)
    expect(existsSync(join(outDir, 'hooks.json'))).toBe(true);
    expect(existsSync(join(outDir, 'hooks', 'hooks.json'))).toBe(false);
    const hooksJson = JSON.parse(readFileSync(join(outDir, 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
    };
    expect(hooksJson.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(
      'node "C:/donaron/apps/cli/dist/cli.js" hook antigravity PreToolUse',
    );

    // 3. rules/AGENTS.md has no YAML frontmatter and is < 24,000 bytes
    const rulesMd = readFileSync(join(outDir, 'rules', 'AGENTS.md'), 'utf8');
    expect(rulesMd.startsWith('---')).toBe(false);
    expect(Buffer.byteLength(rulesMd, 'utf8')).toBeLessThan(ANTIGRAVITY_MAX_RULES_BYTES);

    // 4. skills/<name>/SKILL.md and agents/<name>.md exist
    for (const skill of loaded.value.skills) {
      expect(existsSync(join(outDir, 'skills', skill.name, 'SKILL.md'))).toBe(true);
    }
    for (const agent of loaded.value.agents) {
      const agentMd = readFileSync(join(outDir, 'agents', `${agent.name}.md`), 'utf8');
      expect(agentMd).toContain(`name: ${agent.name}`);
      expect(agentMd).toContain(`description:`);
    }

    // 5. Re-exporting to non-empty directory without overwrite: true fails closed
    const reExportFail = adapter.exportPlugin(loaded.value, outDir, { overwrite: false });
    expect(reExportFail.ok).toBe(false);
    if (!reExportFail.ok) {
      expect(reExportFail.issues[0]?.code).toBe('EXPORT_DIR_NOT_EMPTY');
    }

    // 6. installPlugin deploys into <targetPluginRootDir>/<plugin.manifest.name>
    const installRoot = join(createTempDir(), 'plugins');
    const installRes = adapter.installPlugin(loaded.value, {
      targetPluginRootDir: installRoot,
      cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
    });
    expect(installRes.ok).toBe(true);
    if (installRes.ok) {
      expect(existsSync(join(installRes.value.installedPath, 'plugin.json'))).toBe(true);
      expect(existsSync(join(installRes.value.installedPath, 'hooks.json'))).toBe(true);
    }
  });

  it('translates Antigravity camelCase hook stdin and stdout payloads across SessionStart, PreToolUse, PostToolUse, and Stop', () => {
    const adapter = new AntigravityAdapter();

    // Malformed JSON fails closed
    expect(adapter.translateHookInput('PreToolUse', '{bad-json').ok).toBe(false);
    expect(adapter.translateHookInput('PreToolUse', '[]').ok).toBe(false);

    // Prefers cwd over workspacePaths[0]
    const preIn = adapter.translateHookInput(
      'PreToolUse',
      JSON.stringify({
        conversationId: 'conv-1',
        cwd: 'C:/active/workspace',
        workspacePaths: ['C:/fallback/workspace'],
        toolCall: {
          id: 'tc-1',
          name: 'write_file',
          args: { Path: 'src/app.ts', Content: 'x' },
        },
      }),
    );
    expect(preIn.ok).toBe(true);
    if (preIn.ok) {
      expect(preIn.value.workspaceRoot).toBe('C:/active/workspace');
      expect(preIn.value.toolCall?.name).toBe('write_file');
    }

    // Falls back to workspacePaths[0] when cwd is omitted
    const fallbackIn = adapter.translateHookInput(
      'Stop',
      JSON.stringify({
        workspacePaths: ['C:/fallback/workspace'],
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: true,
      }),
    );
    expect(fallbackIn.ok).toBe(true);
    if (fallbackIn.ok) {
      expect(fallbackIn.value.workspaceRoot).toBe('C:/fallback/workspace');
      expect(fallbackIn.value.continuationActive).toBe(true);
    }

    // Output translations
    expect(
      adapter.translateHookOutput('SessionStart', {
        event: 'SessionStart',
        decision: 'allow',
        systemMessage: 'Active workflow run-1',
      }),
    ).toEqual({
      injectSteps: [{ systemMessage: { systemMessage: 'Active workflow run-1' } }],
    });
    expect(
      adapter.translateHookOutput('SessionStart', {
        event: 'SessionStart',
        decision: 'allow',
      }),
    ).toEqual({});

    expect(
      adapter.translateHookOutput('PreToolUse', {
        event: 'PreToolUse',
        decision: 'deny',
        reason: 'Blocked .env read',
      }),
    ).toEqual({
      decision: 'deny',
      reason: 'Blocked .env read',
    });

    expect(
      adapter.translateHookOutput('PostToolUse', {
        event: 'PostToolUse',
        decision: 'allow',
      }),
    ).toEqual({});

    expect(
      adapter.translateHookOutput('Stop', {
        event: 'Stop',
        decision: 'block_stop',
        reason: 'Gate 04 not fresh',
      }),
    ).toEqual({
      decision: 'continue',
      reason: 'Gate 04 not fresh',
    });

    expect(
      adapter.translateHookOutput('Stop', {
        event: 'Stop',
        decision: 'allow_stop',
      }),
    ).toEqual({
      decision: '',
    });
  });
});
