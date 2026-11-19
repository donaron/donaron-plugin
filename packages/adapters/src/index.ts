import { getCoreModuleInfo, type ModuleInfo } from '@donaron/core';
import { getGatesModuleInfo } from '@donaron/gates';

export const DONARON_ADAPTERS_VERSION = '0.1.0';

export function getAdaptersModuleInfo(): ModuleInfo {
  const core = getCoreModuleInfo();
  const gates = getGatesModuleInfo();
  return {
    name: '@donaron/adapters',
    version: DONARON_ADAPTERS_VERSION,
    dependencies: [`${core.name}@${core.version}`, `${gates.name}@${gates.version}`],
  };
}

export type {
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
  SupportLevel,
} from './types.js';

export { executeNormalizedHook } from './bridge/hook-executor.js';

export {
  ANTIGRAVITY_MAX_RULES_BYTES,
  AntigravityAdapter,
  buildWindowsSafeHookCommand,
  compileRulesPlainMarkdown,
  copySkillAssets,
  renderExportedSkillMarkdown,
} from './antigravity/antigravity-adapter.js';

export { ClaudeCodeAdapter, mapModelTierToClaudeAlias } from './claude-code/claude-code-adapter.js';

export {
  getHarnessAdapter,
  listHarnessAdapters,
  PluginInstallationRegistry,
} from './registry/installation-registry.js';
