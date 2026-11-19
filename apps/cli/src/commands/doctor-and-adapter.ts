import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getAdaptersModuleInfo,
  getHarnessAdapter,
  type HarnessCapabilityMatrix,
  type HarnessId,
  listHarnessAdapters,
  PluginInstallationRegistry,
} from '@donaron/adapters';
import { getCoreModuleInfo } from '@donaron/core';
import { EvidenceStore, getGatesModuleInfo } from '@donaron/gates';
import { formatCliError, formatCliOutput } from '../args.js';
import type { CliExecutionContext, CliRunResult, ParsedCliArgs } from '../types.js';

export function resolveDefaultRegistryPath(context: CliExecutionContext): string {
  if (context.registryFilePath !== undefined && context.registryFilePath.trim().length > 0) {
    return resolve(context.registryFilePath);
  }
  return join(homedir(), '.donaron', 'registry.json');
}

export function resolveDefaultAntigravityPluginsDir(context: CliExecutionContext): string {
  if (
    context.antigravityPluginsDir !== undefined &&
    context.antigravityPluginsDir.trim().length > 0
  ) {
    return resolve(context.antigravityPluginsDir);
  }
  return join(homedir(), '.gemini', 'config', 'plugins');
}

export function resolveDefaultClaudePluginsDir(context: CliExecutionContext): string {
  if (context.claudePluginsDir !== undefined && context.claudePluginsDir.trim().length > 0) {
    return resolve(context.claudePluginsDir);
  }
  return join(homedir(), '.claude', 'plugins');
}

export function handleDoctorCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const cwd = resolve(context.cwd ?? process.cwd());
  const registryPath = resolveDefaultRegistryPath(context);
  const agyPluginsDir = resolveDefaultAntigravityPluginsDir(context);
  const claudePluginsDir = resolveDefaultClaudePluginsDir(context);

  const modules = [getCoreModuleInfo(), getGatesModuleInfo(), getAdaptersModuleInfo()];
  const registry = new PluginInstallationRegistry(registryPath);
  const installedPlugins = registry.listInstalled();

  const store = new EvidenceStore(cwd);
  const activeRunId = store.getActiveRunId();
  let activeWorkflow:
    | {
        readonly runId: string;
        readonly tier: string;
        readonly state: string;
        readonly taskDescription: string;
      }
    | undefined;
  if (activeRunId !== undefined) {
    const loadedRun = store.loadRunState(activeRunId);
    if (loadedRun.ok) {
      activeWorkflow = {
        runId: loadedRun.value.runId,
        tier: loadedRun.value.tier,
        state: loadedRun.value.state,
        taskDescription: loadedRun.value.taskDescription,
      };
    }
  }

  const report = {
    ok: true,
    nodeVersion: process.versions.node,
    platform: process.platform,
    workspaceRoot: cwd,
    modules,
    harnesses: {
      antigravity: {
        pluginsDir: agyPluginsDir,
        directoryExists: existsSync(agyPluginsDir),
      },
      'claude-code': {
        pluginsDir: claudePluginsDir,
        directoryExists: existsSync(claudePluginsDir),
      },
    },
    installedPluginsCount: installedPlugins.length,
    ...(activeWorkflow !== undefined ? { activeWorkflow } : {}),
  };

  const humanLines = [
    'DonAron Doctor Diagnostics',
    `  Node.js: v${report.nodeVersion} (${report.platform})`,
    `  Workspace: ${report.workspaceRoot}`,
    '  Modules:',
    ...modules.map((m) => `    - ${m.name}@${m.version}`),
    `  Installed Plugins: ${String(report.installedPluginsCount)} (registry: ${registryPath})`,
    activeWorkflow !== undefined
      ? `  Active Workflow: ${activeWorkflow.runId} [tier=${activeWorkflow.tier}, state=${activeWorkflow.state}]`
      : '  Active Workflow: none (Choice 2A hazard guards active)',
  ];

  return formatCliOutput(report, humanLines.join('\n'), parsed.json);
}

function isHarnessId(val: string): val is HarnessId {
  return val === 'antigravity' || val === 'claude-code';
}

function formatCapabilityMatrixHuman(caps: HarnessCapabilityMatrix): string {
  return [
    `Harness: ${caps.displayName} (${caps.harnessId})`,
    `  skills:                 ${caps.skills}`,
    `  rules:                  ${caps.rules}`,
    `  agents:                 ${caps.agents}`,
    `  agentPolicyEnforcement: ${caps.agentPolicyEnforcement}`,
    `  hooks.sessionStart:     ${caps.hooks.sessionStart}`,
    `  hooks.preToolUse:       ${caps.hooks.preToolUse}`,
    `  hooks.postToolUse:      ${caps.hooks.postToolUse}`,
    `  hooks.stop:             ${caps.hooks.stop}`,
    `  gates:                  ${caps.gates}`,
    `  runtimeVerification:    ${caps.runtimeVerification}`,
  ].join('\n');
}

export function handleAdapterCommand(parsed: ParsedCliArgs): CliRunResult {
  const subcommand = parsed.positionals[1];
  if (subcommand !== 'capabilities') {
    return formatCliError(
      'INVALID_ADAPTER_SUBCOMMAND',
      'Usage: donaron adapter capabilities [antigravity|claude-code] [--json]',
      parsed.json,
    );
  }

  const targetHarness = parsed.positionals[2];
  let matrices: readonly HarnessCapabilityMatrix[];
  if (targetHarness !== undefined) {
    if (!isHarnessId(targetHarness)) {
      return formatCliError(
        'UNKNOWN_HARNESS',
        `Unknown harness "${targetHarness}". Supported v1 harnesses: antigravity, claude-code.`,
        parsed.json,
      );
    }
    matrices = [getHarnessAdapter(targetHarness).getCapabilities()];
  } else {
    matrices = listHarnessAdapters().map((a) => a.getCapabilities());
  }

  const humanText = matrices.map((m) => formatCapabilityMatrixHuman(m)).join('\n\n');
  return formatCliOutput({ ok: true, adapters: matrices }, humanText, parsed.json);
}
