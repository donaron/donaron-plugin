import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import {
  type HookEventName,
  type LoadedPlugin,
  type ModelTier,
  type ParsedAgent,
  resolveSafePluginPath,
  type ValidationResult,
} from '@donaron/core';
import {
  buildWindowsSafeHookCommand,
  compileRulesPlainMarkdown,
  copySkillAssets,
  renderExportedSkillMarkdown,
} from '../antigravity/antigravity-adapter.js';
import type {
  ExportedPluginBundle,
  ExportPluginOptions,
  HarnessAdapter,
  HarnessCapabilityMatrix,
  InstalledPluginReceipt,
  InstallPluginOptions,
  NormalizedHookDecision,
  NormalizedHookInput,
  NormalizedToolCall,
} from '../types.js';

const CLAUDE_ALLOWED_MANIFEST_KEYS = [
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
] as const;

export function mapModelTierToClaudeAlias(tier: ModelTier): 'haiku' | 'sonnet' | 'opus' {
  if (tier === 'fast') {
    return 'haiku';
  }
  if (tier === 'reasoning') {
    return 'opus';
  }
  return 'sonnet';
}

function renderClaudeAgentMarkdown(agent: ParsedAgent): string {
  const modelAlias = mapModelTierToClaudeAlias(agent.modelTier);
  const toolsLine = agent.tools.length > 0 ? `tools: ${agent.tools.join(', ')}` : undefined;
  const lines: string[] = [
    '---',
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    `model: ${modelAlias}`,
    ...(toolsLine !== undefined ? [toolsLine] : []),
    '---',
    '',
    `# ${agent.name} (${agent.role})`,
    '',
    `- **Model Tier:** ${agent.modelTier} (\`${modelAlias}\`)`,
    `- **Permission Profile:** ${agent.permissionProfile}`,
    `- **Max Retries:** ${String(agent.maxRetries)}`,
    `- **Requires Human Approval:** ${String(agent.requiresHumanApproval)}`,
    `- **Skills:** ${agent.skills.join(', ') || 'none'}`,
    '',
    '## Responsibilities',
    ...agent.responsibilities.map((r) => `- ${r}`),
    '',
    '## Non-Responsibilities',
    ...agent.nonResponsibilities.map((nr) => `- ${nr}`),
    '',
    '## Input & Output Contracts',
    `- **Input Contract:** ${agent.inputContract}`,
    `- **Output Contract:** ${agent.outputContract}`,
    `- **Handoff Conditions:** ${agent.handoffConditions.join('; ')}`,
    '',
    agent.body.trim(),
    '',
  ];
  return lines.join('\n');
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Anthropic Claude Code';

  getCapabilities(): HarnessCapabilityMatrix {
    return {
      harnessId: 'claude-code',
      displayName: this.displayName,
      skills: 'NATIVE',
      rules: 'NATIVE',
      agents: 'NATIVE',
      agentPolicyEnforcement: 'PARTIAL',
      hooks: {
        sessionStart: 'NATIVE',
        preToolUse: 'NATIVE',
        postToolUse: 'NATIVE',
        stop: 'NATIVE',
      },
      gates: 'EMULATED',
      runtimeVerification: 'UNVERIFIED',
      notes: [
        'Exports .claude-plugin/plugin.json, hooks/hooks.json, CLAUDE.md, skills/, and agents/.',
        'Maps DonAron modelTier (fast/balanced/reasoning) to Claude Code model aliases (haiku/sonnet/opus).',
        'Export layout and hook payload translation are verified by contract tests; live runtime execution against claude.exe is marked UNVERIFIED until explicitly executed live.',
      ],
    };
  }

  validateCompatibility(plugin: LoadedPlugin): ValidationResult<true> {
    const harnesses = plugin.manifest.compatibility.harnesses;
    if (
      harnesses !== undefined &&
      Object.keys(harnesses).length > 0 &&
      harnesses['claude-code'] === undefined
    ) {
      return {
        ok: false,
        issues: [
          {
            code: 'HARNESS_INCOMPATIBLE',
            path: '/compatibility/harnesses',
            message: `Plugin "${plugin.manifest.id}" does not list "claude-code" in compatibility.harnesses.`,
          },
        ],
      };
    }
    return { ok: true, value: true };
  }

  exportPlugin(
    plugin: LoadedPlugin,
    outDir: string,
    options?: ExportPluginOptions,
  ): ValidationResult<ExportedPluginBundle> {
    const compat = this.validateCompatibility(plugin);
    if (!compat.ok) {
      return compat;
    }

    const resolvedOutDir = resolve(outDir);
    if (existsSync(resolvedOutDir)) {
      const existingEntries = readdirSync(resolvedOutDir);
      if (existingEntries.length > 0) {
        if (options?.overwrite !== true) {
          return {
            ok: false,
            issues: [
              {
                code: 'EXPORT_DIR_NOT_EMPTY',
                path: 'outDir',
                message: `Export directory "${resolvedOutDir}" is not empty and overwrite is not enabled.`,
              },
            ],
          };
        }
        rmSync(resolvedOutDir, { recursive: true, force: true });
      }
    }

    mkdirSync(resolvedOutDir, { recursive: true });
    const writtenFiles: string[] = [];

    // 1. .claude-plugin/plugin.json
    const claudePluginDir = join(resolvedOutDir, '.claude-plugin');
    mkdirSync(claudePluginDir, { recursive: true });
    const claudeManifest: Record<string, unknown> = {};
    const srcManifest = plugin.manifest as unknown as Record<string, unknown>;
    for (const key of CLAUDE_ALLOWED_MANIFEST_KEYS) {
      if (srcManifest[key] !== undefined) {
        claudeManifest[key] = srcManifest[key];
      }
    }
    writeFileSync(
      join(claudePluginDir, 'plugin.json'),
      `${JSON.stringify(claudeManifest, null, 2)}\n`,
      'utf8',
    );
    writtenFiles.push('.claude-plugin/plugin.json');

    // 2. hooks/hooks.json
    const hooksDir = join(resolvedOutDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hooksByEvent: Record<
      string,
      {
        readonly matcher?: string;
        readonly hooks: readonly {
          readonly type: 'command';
          readonly command: string;
          readonly timeout: number;
        }[];
      }[]
    > = {};

    for (const binding of plugin.hooks) {
      if (!binding.enabled) {
        continue;
      }
      const list = hooksByEvent[binding.event] ?? [];
      list.push({
        ...(binding.matcher !== undefined ? { matcher: binding.matcher } : {}),
        hooks: [
          {
            type: 'command',
            command: buildWindowsSafeHookCommand(
              options?.cliEntryPath,
              'claude-code',
              binding.event,
            ),
            timeout: binding.timeoutSec,
          },
        ],
      });
      hooksByEvent[binding.event] = list;
    }

    writeFileSync(
      join(hooksDir, 'hooks.json'),
      `${JSON.stringify({ hooks: hooksByEvent }, null, 2)}\n`,
      'utf8',
    );
    writtenFiles.push('hooks/hooks.json');

    // 3. CLAUDE.md
    writeFileSync(join(resolvedOutDir, 'CLAUDE.md'), compileRulesPlainMarkdown(plugin), 'utf8');
    writtenFiles.push('CLAUDE.md');

    // 4. skills/<name>/SKILL.md + assets
    for (const skill of plugin.skills) {
      const skillRel = posix.join('skills', skill.name, 'SKILL.md');
      const skillAbs = join(resolvedOutDir, skillRel);
      mkdirSync(dirname(skillAbs), { recursive: true });
      writeFileSync(skillAbs, renderExportedSkillMarkdown(skill), 'utf8');
      writtenFiles.push(skillRel);
      copySkillAssets(plugin, skill, resolvedOutDir, writtenFiles);
    }

    // 5. agents/<name>.md
    for (const agent of plugin.agents) {
      const agentRel = posix.join('agents', `${agent.name}.md`);
      const agentAbs = join(resolvedOutDir, agentRel);
      mkdirSync(dirname(agentAbs), { recursive: true });
      writeFileSync(agentAbs, renderClaudeAgentMarkdown(agent), 'utf8');
      writtenFiles.push(agentRel);
    }

    return {
      ok: true,
      value: {
        harnessId: 'claude-code',
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        version: plugin.manifest.version,
        outputDir: resolvedOutDir,
        writtenFiles,
        sourceDigest: plugin.digest,
      },
    };
  }

  installPlugin(
    plugin: LoadedPlugin,
    options: InstallPluginOptions,
  ): ValidationResult<InstalledPluginReceipt> {
    const targetRoot = resolve(options.targetPluginRootDir);
    mkdirSync(targetRoot, { recursive: true });
    const safeSubdir = resolveSafePluginPath(targetRoot, plugin.manifest.name, {
      mustExist: false,
    });
    if (!safeSubdir.ok) {
      return safeSubdir;
    }

    const exported = this.exportPlugin(plugin, safeSubdir.value.absolutePath, {
      ...(options.cliEntryPath !== undefined ? { cliEntryPath: options.cliEntryPath } : {}),
      overwrite: options.overwrite ?? true,
    });
    if (!exported.ok) {
      return exported;
    }

    return {
      ok: true,
      value: {
        harnessId: 'claude-code',
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        version: plugin.manifest.version,
        installedPath: safeSubdir.value.absolutePath,
        sourceDigest: plugin.digest,
        permissions: [...plugin.manifest.permissions],
        installedAt: new Date().toISOString(),
      },
    };
  }

  translateHookInput(
    event: HookEventName,
    rawStdin: string,
  ): ValidationResult<NormalizedHookInput> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawStdin);
    } catch {
      return {
        ok: false,
        issues: [
          {
            code: 'HOOK_STDIN_INVALID_JSON',
            path: 'stdin',
            message: 'Claude Code hook stdin is not valid JSON.',
          },
        ],
      };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        issues: [
          {
            code: 'HOOK_STDIN_NOT_OBJECT',
            path: 'stdin',
            message: 'Claude Code hook stdin payload must be a JSON object.',
          },
        ],
      };
    }

    const obj = parsed as Record<string, unknown>;
    const cwd = typeof obj.cwd === 'string' && obj.cwd.trim().length > 0 ? obj.cwd.trim() : '';
    let fallbackWorkspace = '';
    if (Array.isArray(obj.workspace_roots) && typeof obj.workspace_roots[0] === 'string') {
      fallbackWorkspace = obj.workspace_roots[0].trim();
    } else if (Array.isArray(obj.workspacePaths) && typeof obj.workspacePaths[0] === 'string') {
      fallbackWorkspace = obj.workspacePaths[0].trim();
    }
    const workspaceRoot = cwd.length > 0 ? cwd : fallbackWorkspace;

    let toolCall: NormalizedToolCall | undefined;
    if (typeof obj.tool_name === 'string') {
      const args =
        typeof obj.tool_input === 'object' &&
        obj.tool_input !== null &&
        !Array.isArray(obj.tool_input)
          ? (obj.tool_input as Readonly<Record<string, unknown>>)
          : {};
      toolCall = {
        ...(typeof obj.tool_use_id === 'string' ? { id: obj.tool_use_id } : {}),
        name: obj.tool_name,
        args,
      };
    } else if (
      typeof obj.toolCall === 'object' &&
      obj.toolCall !== null &&
      !Array.isArray(obj.toolCall)
    ) {
      const tc = obj.toolCall as Record<string, unknown>;
      if (typeof tc.name === 'string') {
        const args =
          typeof tc.args === 'object' && tc.args !== null && !Array.isArray(tc.args)
            ? (tc.args as Readonly<Record<string, unknown>>)
            : {};
        toolCall = {
          ...(typeof tc.id === 'string' ? { id: tc.id } : {}),
          name: tc.name,
          args,
        };
      }
    }

    const sessionId =
      typeof obj.session_id === 'string'
        ? obj.session_id
        : typeof obj.conversationId === 'string'
          ? obj.conversationId
          : undefined;

    const continuationActive =
      typeof obj.stop_hook_active === 'boolean'
        ? obj.stop_hook_active
        : typeof obj.continuationActive === 'boolean'
          ? obj.continuationActive
          : undefined;

    return {
      ok: true,
      value: {
        harnessId: 'claude-code',
        event,
        workspaceRoot,
        ...(sessionId !== undefined ? { conversationId: sessionId } : {}),
        ...(toolCall !== undefined ? { toolCall } : {}),
        ...(typeof obj.error === 'string' ? { toolError: obj.error } : {}),
        ...(typeof obj.terminationReason === 'string'
          ? { terminationReason: obj.terminationReason }
          : {}),
        ...(continuationActive !== undefined ? { continuationActive } : {}),
      },
    };
  }

  translateHookOutput(
    event: HookEventName,
    decision: NormalizedHookDecision,
  ): Readonly<Record<string, unknown>> {
    if (event === 'SessionStart') {
      if (decision.systemMessage !== undefined && decision.systemMessage.trim().length > 0) {
        return {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: decision.systemMessage,
          },
        };
      }
      return {};
    }

    if (event === 'PreToolUse') {
      if (decision.decision === 'deny') {
        return {
          decision: 'block',
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            ...(decision.reason !== undefined ? { permissionDecisionReason: decision.reason } : {}),
          },
        };
      }
      if (decision.decision === 'ask') {
        return {
          decision: 'ask',
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            ...(decision.reason !== undefined ? { permissionDecisionReason: decision.reason } : {}),
          },
        };
      }
      return {
        decision: 'allow',
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      };
    }

    if (event === 'PostToolUse') {
      return {};
    }

    // Stop event
    if (decision.decision === 'block_stop') {
      return {
        decision: 'block',
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      };
    }
    return {};
  }
}
