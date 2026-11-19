import { getAdaptersModuleInfo } from '@donaron/adapters';
import { getCoreModuleInfo, type ModuleInfo } from '@donaron/core';
import { getGatesModuleInfo } from '@donaron/gates';

export const DONARON_CLI_VERSION = '0.1.0';

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

export function getCliInfo(): CliInfo {
  return {
    name: '@donaron/cli',
    version: DONARON_CLI_VERSION,
    modules: [getCoreModuleInfo(), getGatesModuleInfo(), getAdaptersModuleInfo()],
  };
}

export function runCli(argv: readonly string[]): CliRunResult {
  const firstArg = argv[0];

  if (firstArg === undefined || firstArg === '--help' || firstArg === '-h') {
    const info = getCliInfo();
    const moduleList = info.modules.map((m) => `  - ${m.name}@${m.version}`).join('\n');
    return {
      exitCode: 0,
      stdout: `donaron ${info.version} (Phase 1 foundation baseline)\nUsage: donaron [--version | --help]\nWorkspace modules:\n${moduleList}\n`,
      stderr: '',
    };
  }

  if (firstArg === '--version' || firstArg === '-v') {
    return {
      exitCode: 0,
      stdout: `donaron ${DONARON_CLI_VERSION}\n`,
      stderr: '',
    };
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `Unknown argument: ${firstArg}. Run "donaron --help" for Phase 1 usage.\n`,
  };
}
