import type { HookEventName, LoadedPlugin, Permission, ValidationResult } from '@donaron/core';

export type HarnessId = 'antigravity' | 'claude-code';

export type SupportLevel = 'NATIVE' | 'EMULATED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNVERIFIED';

export interface HarnessCapabilityMatrix {
  readonly harnessId: HarnessId;
  readonly displayName: string;
  readonly skills: SupportLevel;
  readonly rules: SupportLevel;
  readonly agents: SupportLevel;
  readonly agentPolicyEnforcement: SupportLevel;
  readonly hooks: {
    readonly sessionStart: SupportLevel;
    readonly preToolUse: SupportLevel;
    readonly postToolUse: SupportLevel;
    readonly stop: SupportLevel;
  };
  readonly gates: SupportLevel;
  readonly runtimeVerification: SupportLevel;
  readonly notes: readonly string[];
}

export interface ExportPluginOptions {
  readonly cliEntryPath?: string;
  readonly overwrite?: boolean;
}

export interface ExportedPluginBundle {
  readonly harnessId: HarnessId;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly version: string;
  readonly outputDir: string;
  readonly writtenFiles: readonly string[];
  readonly sourceDigest: string;
}

export interface InstallPluginOptions extends ExportPluginOptions {
  readonly targetPluginRootDir: string;
  readonly registryFilePath?: string;
}

export interface InstalledPluginReceipt {
  readonly harnessId: HarnessId;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly version: string;
  readonly installedPath: string;
  readonly sourceDigest: string;
  readonly permissions: readonly Permission[];
  readonly installedAt: string;
}

export interface NormalizedToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface NormalizedHookInput {
  readonly harnessId: HarnessId;
  readonly event: HookEventName;
  readonly workspaceRoot: string;
  readonly conversationId?: string;
  readonly toolCall?: NormalizedToolCall;
  readonly toolError?: string;
  readonly terminationReason?: string;
  readonly continuationActive?: boolean;
}

export interface NormalizedHookDecision {
  readonly event: HookEventName;
  readonly decision: 'allow' | 'deny' | 'ask' | 'allow_stop' | 'block_stop';
  readonly reason?: string;
  readonly systemMessage?: string;
  readonly matchedRuleId?: string;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly displayName: string;
  getCapabilities(): HarnessCapabilityMatrix;
  validateCompatibility(plugin: LoadedPlugin): ValidationResult<true>;
  exportPlugin(
    plugin: LoadedPlugin,
    outDir: string,
    options?: ExportPluginOptions,
  ): ValidationResult<ExportedPluginBundle>;
  installPlugin(
    plugin: LoadedPlugin,
    options: InstallPluginOptions,
  ): ValidationResult<InstalledPluginReceipt>;
  translateHookInput(event: HookEventName, rawStdin: string): ValidationResult<NormalizedHookInput>;
  translateHookOutput(
    event: HookEventName,
    decision: NormalizedHookDecision,
  ): Readonly<Record<string, unknown>>;
}
