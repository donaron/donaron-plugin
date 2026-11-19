import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPlugin, type LoadedPlugin } from '@donaron/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter, mapModelTierToClaudeAlias } from './claude-code-adapter.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-cc-adapter-')));
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

describe('ClaudeCodeAdapter', () => {
  it('reports honest capabilities (with runtimeVerification UNVERIFIED) and maps modelTier to Claude aliases', () => {
    const adapter = new ClaudeCodeAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.harnessId).toBe('claude-code');
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
    expect(caps.runtimeVerification).toBe('UNVERIFIED');

    expect(mapModelTierToClaudeAlias('fast')).toBe('haiku');
    expect(mapModelTierToClaudeAlias('balanced')).toBe('sonnet');
    expect(mapModelTierToClaudeAlias('reasoning')).toBe('opus');
  });

  it('validates compatibility and exports .claude-plugin/plugin.json, hooks/hooks.json, CLAUDE.md, skills, and agents', () => {
    const loaded = loadPlugin(SAMPLE_PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const adapter = new ClaudeCodeAdapter();
    expect(adapter.validateCompatibility(loaded.value)).toEqual({ ok: true, value: true });

    // Rejects plugin whose compatibility.harnesses excludes claude-code
    const excluded: LoadedPlugin = {
      ...loaded.value,
      manifest: {
        ...loaded.value.manifest,
        compatibility: {
          donaronPlugin: '>=0.1.0',
          harnesses: { antigravity: '>=1.0.0' },
        },
      },
    };
    const incom = adapter.validateCompatibility(excluded);
    expect(incom.ok).toBe(false);
    if (!incom.ok) {
      expect(incom.issues[0]?.code).toBe('HARNESS_INCOMPATIBLE');
    }

    const outDir = join(createTempDir(), 'exported-claude');
    const exported = adapter.exportPlugin(loaded.value, outDir, {
      cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.harnessId).toBe('claude-code');

    // 1. .claude-plugin/plugin.json
    expect(existsSync(join(outDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    const claudeManifest = JSON.parse(
      readFileSync(join(outDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(claudeManifest.name).toBe(loaded.value.manifest.name);
    expect(claudeManifest.version).toBe(loaded.value.manifest.version);
    expect(claudeManifest.description).toBe(loaded.value.manifest.description);

    // 2. hooks/hooks.json
    expect(existsSync(join(outDir, 'hooks', 'hooks.json'))).toBe(true);
    const hooksJson = JSON.parse(readFileSync(join(outDir, 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
    };
    expect(hooksJson.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(
      'node "C:/donaron/apps/cli/dist/cli.js" hook claude-code PreToolUse',
    );

    // 3. CLAUDE.md
    expect(existsSync(join(outDir, 'CLAUDE.md'))).toBe(true);
    const claudeMd = readFileSync(join(outDir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd.length).toBeGreaterThan(0);

    // 4. skills/<name>/SKILL.md and agents/<name>.md (with model: haiku|sonnet|opus)
    for (const skill of loaded.value.skills) {
      expect(existsSync(join(outDir, 'skills', skill.name, 'SKILL.md'))).toBe(true);
    }
    for (const agent of loaded.value.agents) {
      const agentMd = readFileSync(join(outDir, 'agents', `${agent.name}.md`), 'utf8');
      const expectedAlias = mapModelTierToClaudeAlias(agent.modelTier);
      expect(agentMd).toContain(`model: ${expectedAlias}`);
    }

    // 5. Non-empty directory without overwrite fails closed
    expect(adapter.exportPlugin(loaded.value, outDir, { overwrite: false }).ok).toBe(false);

    // 6. installPlugin deploys into <targetPluginRootDir>/<plugin.manifest.name>
    const installRoot = join(createTempDir(), 'claude-plugins');
    const installed = adapter.installPlugin(loaded.value, {
      targetPluginRootDir: installRoot,
      cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
    });
    expect(installed.ok).toBe(true);
    if (installed.ok) {
      expect(existsSync(join(installed.value.installedPath, '.claude-plugin', 'plugin.json'))).toBe(
        true,
      );
    }
  });

  it('translates Claude Code snake_case and camelCase hook stdin and stdout payloads', () => {
    const adapter = new ClaudeCodeAdapter();

    expect(adapter.translateHookInput('PreToolUse', 'not-json').ok).toBe(false);
    expect(adapter.translateHookInput('PreToolUse', 'null').ok).toBe(false);

    // Snake_case Claude Code PreToolUse payload
    const preIn = adapter.translateHookInput(
      'PreToolUse',
      JSON.stringify({
        session_id: 'sess-99',
        cwd: 'C:/repo/root',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
      }),
    );
    expect(preIn.ok).toBe(true);
    if (preIn.ok) {
      expect(preIn.value.workspaceRoot).toBe('C:/repo/root');
      expect(preIn.value.conversationId).toBe('sess-99');
      expect(preIn.value.toolCall).toEqual({
        name: 'Bash',
        args: { command: 'pnpm test' },
      });
    }

    // Snake_case Stop payload with stop_hook_active
    const stopIn = adapter.translateHookInput(
      'Stop',
      JSON.stringify({
        workspace_roots: ['C:/repo/fallback'],
        stop_hook_active: true,
      }),
    );
    expect(stopIn.ok).toBe(true);
    if (stopIn.ok) {
      expect(stopIn.value.workspaceRoot).toBe('C:/repo/fallback');
      expect(stopIn.value.continuationActive).toBe(true);
    }

    // Output translations
    expect(
      adapter.translateHookOutput('SessionStart', {
        event: 'SessionStart',
        decision: 'allow',
        systemMessage: 'Workflow active',
      }),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Workflow active',
      },
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
        reason: 'Policy denied',
      }),
    ).toEqual({
      decision: 'block',
      reason: 'Policy denied',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Policy denied',
      },
    });

    expect(
      adapter.translateHookOutput('PreToolUse', {
        event: 'PreToolUse',
        decision: 'ask',
        reason: 'Approval needed',
      }),
    ).toEqual({
      decision: 'ask',
      reason: 'Approval needed',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Approval needed',
      },
    });

    expect(
      adapter.translateHookOutput('PreToolUse', {
        event: 'PreToolUse',
        decision: 'allow',
      }),
    ).toEqual({
      decision: 'allow',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
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
        reason: 'Incomplete gates',
      }),
    ).toEqual({
      decision: 'block',
      reason: 'Incomplete gates',
    });

    expect(
      adapter.translateHookOutput('Stop', {
        event: 'Stop',
        decision: 'allow_stop',
      }),
    ).toEqual({});
  });
});
