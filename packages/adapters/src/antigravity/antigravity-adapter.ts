import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import {
  type HookEventName,
  type LoadedPlugin,
  type ParsedAgent,
  type ParsedSkill,
  resolveSafePluginPath,
  type ValidationResult,
} from '@donaron/core';
import type {
  ExportedPluginBundle,
  ExportPluginOptions,
  HarnessAdapter,
  HarnessCapabilityMatrix,
  HarnessId,
  InstalledPluginReceipt,
  InstallPluginOptions,
  NormalizedHookDecision,
  NormalizedHookInput,
  NormalizedToolCall,
} from '../types.js';

export const ANTIGRAVITY_MAX_RULES_BYTES = 24000;

const ANTIGRAVITY_ALLOWED_MANIFEST_KEYS = [
  'name',
  'displayName',
  'description',
  'version',
  'author',
  'homepage',
  'repository',
  'logo',
  'suggestedPrompts',
] as const;

export function buildWindowsSafeHookCommand(
  cliEntryPath: string | undefined,
  harnessId: HarnessId,
  event: HookEventName,
): string {
  const trimmed = cliEntryPath?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    const normalizedPath = trimmed.replaceAll('\\', '/').replaceAll('"', '');
    return `node "${normalizedPath}" hook ${harnessId} ${event}`;
  }
  return `donaron hook ${harnessId} ${event}`;
}

export function compileRulesPlainMarkdown(plugin: LoadedPlugin): string {
  if (plugin.rules.length === 0) {
    return `# ${plugin.manifest.displayName ?? plugin.manifest.name} Rules\n\nNo custom guidance rules declared.\n`;
  }
  const sorted = [...plugin.rules].sort((a, b) =>
    b.priority !== a.priority ? b.priority - a.priority : a.id.localeCompare(b.id),
  );
  const sections = sorted.map(
    (rule) =>
      `## [${rule.category.toUpperCase()}] ${rule.id} (scope: ${rule.scope}, priority: ${String(rule.priority)})\n\n${rule.body.trim()}`,
  );
  return `# ${plugin.manifest.displayName ?? plugin.manifest.name} Guidance Rules\n\n${sections.join('\n\n---\n\n')}\n`;
}

export function renderExportedSkillMarkdown(skill: ParsedSkill): string {
  const lines: string[] = [
    '---',
    `name: ${skill.name}`,
    `description: ${JSON.stringify(skill.description)}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    `**Purpose:** ${skill.purpose}`,
    `**Activation:** ${skill.activation}`,
    '',
    '## Contract',
    `- **Inputs:** ${skill.inputs.join(', ')}`,
    `- **Outputs:** ${skill.outputs.join(', ')}`,
    `- **Constraints:** ${skill.constraints.join('; ')}`,
    `- **Completion Criteria:** ${skill.completionCriteria.join('; ')}`,
    '',
    skill.body.trim(),
    '',
  ];
  return lines.join('\n');
}

function renderAntigravityAgentMarkdown(agent: ParsedAgent): string {
  const lines: string[] = [
    '---',
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    '---',
    '',
    `# ${agent.name} (${agent.role})`,
    '',
    `- **Model Tier:** ${agent.modelTier}`,
    `- **Permission Profile:** ${agent.permissionProfile}`,
    `- **Max Retries:** ${String(agent.maxRetries)}`,
    `- **Requires Human Approval:** ${String(agent.requiresHumanApproval)}`,
    `- **Skills:** ${agent.skills.join(', ') || 'none'}`,
    `- **Tools:** ${agent.tools.join(', ') || 'none'}`,
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

export function copySkillAssets(
  plugin: LoadedPlugin,
  skill: ParsedSkill,
  outDir: string,
  writtenFiles: string[],
): void {
  const skillSourceDir = posix.dirname(skill.sourcePath);
  const assetRelPaths = [...skill.references, ...skill.scripts.map((s) => s.path)];

  for (const assetRel of assetRelPaths) {
    const joinedFromRoot = skillSourceDir === '.' ? assetRel : posix.join(skillSourceDir, assetRel);
    const resolved = resolveSafePluginPath(plugin.rootDir, joinedFromRoot, { mustExist: true }).ok
      ? resolveSafePluginPath(plugin.rootDir, joinedFromRoot, { mustExist: true })
      : resolveSafePluginPath(plugin.rootDir, assetRel, { mustExist: true });

    if (!resolved.ok) {
      continue;
    }

    const normalizedAssetRel = assetRel.replaceAll('\\', '/').replace(/^\/+/, '');
    const targetRelPosix = posix.join('skills', skill.name, normalizedAssetRel);
    const targetAbs = join(outDir, targetRelPosix);
    mkdirSync(dirname(targetAbs), { recursive: true });
    copyFileSync(resolved.value.absolutePath, targetAbs);
    writtenFiles.push(targetRelPosix);
  }
}

export class AntigravityAdapter implements HarnessAdapter {
  readonly id = 'antigravity' as const;
  readonly displayName = 'Google Antigravity';

  getCapabilities(): HarnessCapabilityMatrix {
    return {
      harnessId: 'antigravity',
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
      runtimeVerification: 'NATIVE',
      notes: [
        'Hooks execute from plugin root hooks.json via camelCase stdin/stdout payloads.',
        'Rules compile into rules/AGENTS.md with a strict < 24,000 byte limit.',
        'Agent custom frontmatter (modelTier, tools, permissionProfile) is preserved in the agent prompt body and enforced by DonAron PreToolUse/Stop hooks (PARTIAL native agent enforcement).',
      ],
    };
  }

  validateCompatibility(plugin: LoadedPlugin): ValidationResult<true> {
    const harnesses = plugin.manifest.compatibility.harnesses;
    if (
      harnesses !== undefined &&
      Object.keys(harnesses).length > 0 &&
      harnesses.antigravity === undefined
    ) {
      return {
        ok: false,
        issues: [
          {
            code: 'HARNESS_INCOMPATIBLE',
            path: '/compatibility/harnesses',
            message: `Plugin "${plugin.manifest.id}" does not list "antigravity" in compatibility.harnesses.`,
          },
        ],
      };
    }

    const compiledRules = compileRulesPlainMarkdown(plugin);
    const byteLength = Buffer.byteLength(compiledRules, 'utf8');
    if (byteLength >= ANTIGRAVITY_MAX_RULES_BYTES) {
      return {
        ok: false,
        issues: [
          {
            code: 'ANTIGRAVITY_RULES_SIZE_EXCEEDED',
            path: '/capabilities/rules',
            message: `Compiled rules/AGENTS.md size (${String(byteLength)} bytes) reaches or exceeds Antigravity's ${String(ANTIGRAVITY_MAX_RULES_BYTES)}-byte limit.`,
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

    // 1. Filtered Antigravity plugin.json
    const agyManifest: Record<string, unknown> = {};
    const srcManifest = plugin.manifest as unknown as Record<string, unknown>;
    for (const key of ANTIGRAVITY_ALLOWED_MANIFEST_KEYS) {
      if (srcManifest[key] !== undefined) {
        agyManifest[key] = srcManifest[key];
      }
    }
    writeFileSync(
      join(resolvedOutDir, 'plugin.json'),
      `${JSON.stringify(agyManifest, null, 2)}\n`,
      'utf8',
    );
    writtenFiles.push('plugin.json');

    if (plugin.manifest.logo !== undefined) {
      const logoRes = resolveSafePluginPath(plugin.rootDir, plugin.manifest.logo, {
        mustExist: true,
      });
      if (logoRes.ok) {
        const targetLogo = join(resolvedOutDir, logoRes.value.relativePosixPath);
        mkdirSync(dirname(targetLogo), { recursive: true });
        copyFileSync(logoRes.value.absolutePath, targetLogo);
        writtenFiles.push(logoRes.value.relativePosixPath);
      }
    }

    // 2. Root hooks.json
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
              'antigravity',
              binding.event,
            ),
            timeout: binding.timeoutSec,
          },
        ],
      });
      hooksByEvent[binding.event] = list;
    }

    writeFileSync(
      join(resolvedOutDir, 'hooks.json'),
      `${JSON.stringify({ hooks: hooksByEvent }, null, 2)}\n`,
      'utf8',
    );
    writtenFiles.push('hooks.json');

    // 3. rules/AGENTS.md (< 24,000 bytes, plain markdown, no YAML frontmatter)
    mkdirSync(join(resolvedOutDir, 'rules'), { recursive: true });
    const compiledRules = compileRulesPlainMarkdown(plugin);
    writeFileSync(join(resolvedOutDir, 'rules', 'AGENTS.md'), compiledRules, 'utf8');
    writtenFiles.push('rules/AGENTS.md');

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
      writeFileSync(agentAbs, renderAntigravityAgentMarkdown(agent), 'utf8');
      writtenFiles.push(agentRel);
    }

    return {
      ok: true,
      value: {
        harnessId: 'antigravity',
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
        harnessId: 'antigravity',
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
            message: 'Antigravity hook stdin is not valid JSON.',
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
            message: 'Antigravity hook stdin payload must be a JSON object.',
          },
        ],
      };
    }

    const obj = parsed as Record<string, unknown>;
    const cwd = typeof obj.cwd === 'string' && obj.cwd.trim().length > 0 ? obj.cwd.trim() : '';
    let fallbackWorkspace = '';
    if (Array.isArray(obj.workspacePaths) && typeof obj.workspacePaths[0] === 'string') {
      fallbackWorkspace = obj.workspacePaths[0].trim();
    }
    const workspaceRoot = cwd.length > 0 ? cwd : fallbackWorkspace;

    let toolCall: NormalizedToolCall | undefined;
    if (typeof obj.toolCall === 'object' && obj.toolCall !== null && !Array.isArray(obj.toolCall)) {
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

    return {
      ok: true,
      value: {
        harnessId: 'antigravity',
        event,
        workspaceRoot,
        ...(typeof obj.conversationId === 'string' ? { conversationId: obj.conversationId } : {}),
        ...(toolCall !== undefined ? { toolCall } : {}),
        ...(typeof obj.error === 'string' ? { toolError: obj.error } : {}),
        ...(typeof obj.terminationReason === 'string'
          ? { terminationReason: obj.terminationReason }
          : {}),
        ...(typeof obj.continuationActive === 'boolean'
          ? { continuationActive: obj.continuationActive }
          : {}),
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
          injectSteps: [
            {
              systemMessage: {
                systemMessage: decision.systemMessage,
              },
            },
          ],
        };
      }
      return {};
    }

    if (event === 'PreToolUse') {
      const agyDecision =
        decision.decision === 'deny' ? 'deny' : decision.decision === 'ask' ? 'ask' : 'allow';
      return {
        decision: agyDecision,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      };
    }

    if (event === 'PostToolUse') {
      return {};
    }

    // Stop event
    if (decision.decision === 'block_stop') {
      return {
        decision: 'continue',
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      };
    }
    return {
      decision: '',
    };
  }
}
