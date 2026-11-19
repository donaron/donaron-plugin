import { resolve } from 'node:path';
import {
  getHarnessAdapter,
  type HarnessId,
  type InstalledPluginReceipt,
  listHarnessAdapters,
  PluginInstallationRegistry,
} from '@donaron/adapters';
import { loadPlugin } from '@donaron/core';
import { formatCliError, formatCliOutput, getBooleanFlag, getStringFlag } from '../args.js';
import type { CliExecutionContext, CliRunResult, ParsedCliArgs } from '../types.js';
import {
  resolveDefaultAntigravityPluginsDir,
  resolveDefaultClaudePluginsDir,
  resolveDefaultRegistryPath,
} from './doctor-and-adapter.js';

function isHarnessId(val: string): val is HarnessId {
  return val === 'antigravity' || val === 'claude-code';
}

function resolveTargetHarnesses(targetRaw: string | undefined): readonly HarnessId[] | undefined {
  if (targetRaw === undefined || targetRaw === 'all') {
    return ['antigravity', 'claude-code'];
  }
  if (isHarnessId(targetRaw)) {
    return [targetRaw];
  }
  return undefined;
}

export function handlePluginCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const cwd = resolve(context.cwd ?? process.cwd());
  const subcommand = parsed.positionals[1];

  if (subcommand === 'validate') {
    const dirArg = parsed.positionals[2];
    if (dirArg === undefined || dirArg.trim().length === 0) {
      return formatCliError(
        'MISSING_PLUGIN_DIR',
        'Usage: donaron plugin validate <dir> [--json]',
        parsed.json,
      );
    }

    const pluginDir = resolve(cwd, dirArg);
    const loaded = loadPlugin(pluginDir);
    if (!loaded.ok) {
      return formatCliError(
        'PLUGIN_VALIDATION_FAILED',
        `Plugin at "${pluginDir}" failed validation (${String(loaded.issues.length)} issue(s)).`,
        parsed.json,
        { issues: loaded.issues },
      );
    }

    const harnessCompatibility: Record<
      string,
      { readonly ok: boolean; readonly issues?: unknown }
    > = {};
    for (const adapter of listHarnessAdapters()) {
      const compat = adapter.validateCompatibility(loaded.value);
      harnessCompatibility[adapter.id] = compat.ok
        ? { ok: true }
        : { ok: false, issues: compat.issues };
    }

    const payload = {
      ok: true,
      pluginId: loaded.value.manifest.id,
      name: loaded.value.manifest.name,
      version: loaded.value.manifest.version,
      digest: loaded.value.digest,
      skillsCount: loaded.value.skills.length,
      agentsCount: loaded.value.agents.length,
      rulesCount: loaded.value.rules.length,
      hooksCount: loaded.value.hooks.length,
      harnessCompatibility,
    };
    const human = `VALID: ${payload.name}@${payload.version} (${payload.pluginId})\n  Digest: ${payload.digest}\n  Skills: ${String(payload.skillsCount)}, Agents: ${String(payload.agentsCount)}, Rules: ${String(payload.rulesCount)}, Hooks: ${String(payload.hooksCount)}`;
    return formatCliOutput(payload, human, parsed.json);
  }

  if (subcommand === 'info') {
    const dirArg = parsed.positionals[2];
    if (dirArg === undefined || dirArg.trim().length === 0) {
      return formatCliError(
        'MISSING_PLUGIN_DIR',
        'Usage: donaron plugin info <dir> [--json]',
        parsed.json,
      );
    }

    const pluginDir = resolve(cwd, dirArg);
    const loaded = loadPlugin(pluginDir);
    if (!loaded.ok) {
      return formatCliError(
        'PLUGIN_LOAD_FAILED',
        `Failed to load plugin at "${pluginDir}".`,
        parsed.json,
        { issues: loaded.issues },
      );
    }

    const plugin = loaded.value;
    const payload = {
      ok: true,
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      digest: plugin.digest,
      permissions: plugin.manifest.permissions,
      skills: plugin.skills.map((s) => ({ name: s.name, description: s.description })),
      agents: plugin.agents.map((a) => ({
        name: a.name,
        role: a.role,
        modelTier: a.modelTier,
      })),
      rules: plugin.rules.map((r) => ({
        id: r.id,
        category: r.category,
        priority: r.priority,
      })),
      hooks: plugin.hooks.map((h) => ({
        id: h.id,
        event: h.event,
        handler: h.handler,
        enabled: h.enabled,
      })),
    };
    const human = [
      `Plugin: ${plugin.manifest.displayName ?? plugin.manifest.name} (${plugin.manifest.id}@${plugin.manifest.version})`,
      `  Description: ${plugin.manifest.description}`,
      `  Digest:      ${plugin.digest}`,
      `  Permissions: ${plugin.manifest.permissions.join(', ') || 'none'}`,
      `  Skills (${String(plugin.skills.length)}): ${plugin.skills.map((s) => s.name).join(', ') || 'none'}`,
      `  Agents (${String(plugin.agents.length)}): ${plugin.agents.map((a) => a.name).join(', ') || 'none'}`,
      `  Rules (${String(plugin.rules.length)}):  ${plugin.rules.map((r) => r.id).join(', ') || 'none'}`,
      `  Hooks (${String(plugin.hooks.length)}):  ${plugin.hooks.map((h) => `${h.event}:${h.handler}`).join(', ') || 'none'}`,
    ].join('\n');
    return formatCliOutput(payload, human, parsed.json);
  }

  if (subcommand === 'list') {
    const targetFlag = getStringFlag(parsed, 'target');
    if (targetFlag !== undefined && !isHarnessId(targetFlag)) {
      return formatCliError(
        'UNKNOWN_HARNESS',
        `Unknown harness "${targetFlag}". Supported: antigravity, claude-code.`,
        parsed.json,
      );
    }

    const registry = new PluginInstallationRegistry(resolveDefaultRegistryPath(context));
    const installations = registry.listInstalled(targetFlag);
    const human =
      installations.length === 0
        ? 'No plugins currently installed.'
        : installations
            .map(
              (inst) =>
                `- ${inst.pluginName}@${inst.version} [${inst.harnessId}] -> ${inst.installedPath} (${inst.sourceDigest})`,
            )
            .join('\n');
    return formatCliOutput({ ok: true, installations }, human, parsed.json);
  }

  if (subcommand === 'install') {
    const dirArg = parsed.positionals[2];
    if (dirArg === undefined || dirArg.trim().length === 0) {
      return formatCliError(
        'MISSING_PLUGIN_DIR',
        'Usage: donaron plugin install <dir> [--target antigravity|claude-code|all] [--yes] [--json]',
        parsed.json,
      );
    }

    const targets = resolveTargetHarnesses(getStringFlag(parsed, 'target'));
    if (targets === undefined) {
      return formatCliError(
        'UNKNOWN_HARNESS',
        'Invalid --target flag. Supported: antigravity, claude-code, all.',
        parsed.json,
      );
    }

    const pluginDir = resolve(cwd, dirArg);
    const loaded = loadPlugin(pluginDir);
    if (!loaded.ok) {
      return formatCliError(
        'PLUGIN_VALIDATION_FAILED',
        `Plugin at "${pluginDir}" failed validation.`,
        parsed.json,
        { issues: loaded.issues },
      );
    }

    const plugin = loaded.value;
    const hasConfirmed =
      getBooleanFlag(parsed, 'yes') ||
      (context.isInteractiveTty === true && context.confirmed === true);

    if (plugin.manifest.permissions.length > 0 && !hasConfirmed) {
      return formatCliError(
        'INSTALL_CONFIRMATION_REQUIRED',
        `Plugin "${plugin.manifest.name}" requests permissions [${plugin.manifest.permissions.join(', ')}]. Re-run with --yes after reviewing permissions.`,
        parsed.json,
        { permissions: plugin.manifest.permissions },
      );
    }

    const registry = new PluginInstallationRegistry(resolveDefaultRegistryPath(context));
    const receipts: InstalledPluginReceipt[] = [];

    for (const harnessId of targets) {
      const adapter = getHarnessAdapter(harnessId);
      const targetRootDir =
        harnessId === 'antigravity'
          ? resolveDefaultAntigravityPluginsDir(context)
          : resolveDefaultClaudePluginsDir(context);

      const installed = adapter.installPlugin(plugin, {
        targetPluginRootDir: targetRootDir,
        ...(context.cliEntryPath !== undefined ? { cliEntryPath: context.cliEntryPath } : {}),
        overwrite: true,
      });

      if (!installed.ok) {
        return formatCliError(
          'PLUGIN_INSTALL_FAILED',
          `Failed to install plugin "${plugin.manifest.name}" for harness "${harnessId}".`,
          parsed.json,
          { issues: installed.issues },
        );
      }

      registry.recordInstall(installed.value);
      receipts.push(installed.value);
    }

    const human = receipts
      .map(
        (r) =>
          `Installed ${r.pluginName}@${r.version} for ${r.harnessId} at ${r.installedPath} (permissions: ${r.permissions.join(', ') || 'none'})`,
      )
      .join('\n');
    return formatCliOutput({ ok: true, receipts }, human, parsed.json);
  }

  if (subcommand === 'uninstall') {
    const nameArg = parsed.positionals[2];
    if (nameArg === undefined || nameArg.trim().length === 0) {
      return formatCliError(
        'MISSING_PLUGIN_NAME',
        'Usage: donaron plugin uninstall <name> [--target antigravity|claude-code] [--json]',
        parsed.json,
      );
    }

    const targetFlag = getStringFlag(parsed, 'target');
    if (targetFlag !== undefined && !isHarnessId(targetFlag)) {
      return formatCliError(
        'UNKNOWN_HARNESS',
        `Unknown harness "${targetFlag}". Supported: antigravity, claude-code.`,
        parsed.json,
      );
    }

    const registry = new PluginInstallationRegistry(resolveDefaultRegistryPath(context));
    const removed = registry.uninstallPlugin(nameArg, targetFlag);
    if (!removed.ok) {
      return formatCliError(
        removed.issues[0]?.code ?? 'UNINSTALL_FAILED',
        removed.issues.map((i) => i.message).join('; '),
        parsed.json,
        { issues: removed.issues },
      );
    }

    const human = removed.value
      .map(
        (r) => `Uninstalled ${r.pluginName}@${r.version} [${r.harnessId}] from ${r.installedPath}`,
      )
      .join('\n');
    return formatCliOutput({ ok: true, removed: removed.value }, human, parsed.json);
  }

  return formatCliError(
    'INVALID_PLUGIN_SUBCOMMAND',
    'Usage: donaron plugin <validate|info|list|install|uninstall> ...',
    parsed.json,
  );
}

export function handleExportCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const cwd = resolve(context.cwd ?? process.cwd());
  const dirArg = parsed.positionals[1];
  const targetFlag = getStringFlag(parsed, 'target');
  const outFlag = getStringFlag(parsed, 'out');

  if (
    dirArg === undefined ||
    dirArg.trim().length === 0 ||
    targetFlag === undefined ||
    outFlag === undefined
  ) {
    return formatCliError(
      'INVALID_EXPORT_ARGS',
      'Usage: donaron export <dir> --target <antigravity|claude-code> --out <dir> [--overwrite] [--json]',
      parsed.json,
    );
  }

  if (!isHarnessId(targetFlag)) {
    return formatCliError(
      'UNKNOWN_HARNESS',
      `Unknown harness "${targetFlag}". Supported: antigravity, claude-code.`,
      parsed.json,
    );
  }

  const pluginDir = resolve(cwd, dirArg);
  const loaded = loadPlugin(pluginDir);
  if (!loaded.ok) {
    return formatCliError(
      'PLUGIN_VALIDATION_FAILED',
      `Plugin at "${pluginDir}" failed validation.`,
      parsed.json,
      { issues: loaded.issues },
    );
  }

  const adapter = getHarnessAdapter(targetFlag);
  const outDir = resolve(cwd, outFlag);
  const exported = adapter.exportPlugin(loaded.value, outDir, {
    ...(context.cliEntryPath !== undefined ? { cliEntryPath: context.cliEntryPath } : {}),
    overwrite: getBooleanFlag(parsed, 'overwrite'),
  });

  if (!exported.ok) {
    return formatCliError(
      exported.issues[0]?.code ?? 'EXPORT_FAILED',
      exported.issues.map((i) => i.message).join('; '),
      parsed.json,
      { issues: exported.issues },
    );
  }

  const human = `Exported ${exported.value.pluginName}@${exported.value.version} for ${exported.value.harnessId} -> ${exported.value.outputDir} (${String(exported.value.writtenFiles.length)} files)`;
  return formatCliOutput({ ok: true, bundle: exported.value }, human, parsed.json);
}
