import type { ModuleInfo } from '@donaron/core';
import type { DependencyAuditSummary, ParsedTestRun, PretestCheckRunner } from '@donaron/gates';

export interface CliInfo {
  readonly name: string;
  readonly version: string;
  readonly modules: readonly ModuleInfo[];
}

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliExecutionContext {
  readonly cwd?: string;
  readonly stdin?: string;
  readonly isInteractiveTty?: boolean;
  readonly confirmed?: boolean;
  readonly actorType?: 'agent' | 'human';
  readonly registryFilePath?: string;
  readonly antigravityPluginsDir?: string;
  readonly claudePluginsDir?: string;
  readonly cliEntryPath?: string;
  readonly pretestRunner?: PretestCheckRunner;
  readonly auditSummary?: DependencyAuditSummary;
  readonly auditReportJson?: string;
  readonly testRun?: ParsedTestRun;
  readonly requiredPackages?: readonly string[];
}

export interface ParsedCliArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly json: boolean;
}
