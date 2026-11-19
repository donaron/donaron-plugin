import { getAdaptersModuleInfo } from '@donaron/adapters';
import { getCoreModuleInfo } from '@donaron/core';
import { getGatesModuleInfo } from '@donaron/gates';
import { getBooleanFlag, parseCliArgs } from './args.js';
import { handleAdapterCommand, handleDoctorCommand } from './commands/doctor-and-adapter.js';
import { handleHookCommand } from './commands/hook-command.js';
import { handleExportCommand, handlePluginCommand } from './commands/plugin-and-export.js';
import { handleGateCommand, handleWorkflowCommand } from './commands/workflow-and-gate.js';
import type { CliExecutionContext, CliInfo, CliRunResult } from './types.js';

export type { CliExecutionContext, CliInfo, CliRunResult, ParsedCliArgs } from './types.js';
export {
  formatCliError,
  formatCliOutput,
  getBooleanFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCliArgs,
} from './args.js';

export const DONARON_CLI_VERSION = '0.1.0';

export function getCliInfo(): CliInfo {
  return {
    name: '@donaron/cli',
    version: DONARON_CLI_VERSION,
    modules: [getCoreModuleInfo(), getGatesModuleInfo(), getAdaptersModuleInfo()],
  };
}

function renderHelpText(): string {
  const info = getCliInfo();
  const moduleList = info.modules.map((m) => `  - ${m.name}@${m.version}`).join('\n');
  return [
    `donaron ${info.version} — Universal Multi-Harness AI Workflow & Gate Enforcement CLI`,
    'Usage: donaron <command> [options]',
    '',
    'Commands:',
    '  doctor [--json]',
    '  adapter capabilities [antigravity|claude-code] [--json]',
    '  plugin validate <dir> [--json]',
    '  plugin info <dir> [--json]',
    '  plugin list [--target antigravity|claude-code] [--json]',
    '  plugin install <dir> [--target antigravity|claude-code|all] [--yes] [--json]',
    '  plugin uninstall <name> [--target antigravity|claude-code] [--json]',
    '  export <dir> --target <antigravity|claude-code> --out <dir> [--overwrite] [--json]',
    '  workflow start [--run-id <id>] [--task <text>] [--tier strict|standard|quick] [--plan <files...>] [--json]',
    '  workflow status [--run-id <id>] [--json]',
    '  workflow advance <targetState> [--run-id <id>] [--json]',
    '  workflow register-author --kind <plan|code> --actor-id <id> [--run-id <id>] [--json]',
    '  workflow record-review --gate <GATE_01|02|03|05> --role <role> --reviewer-id <id> [--approved|--rejected] --summary <text> [--json]',
    '  gate run <01|02|03|04|05|all> [--run-id <id>] [--json]',
    '  gate status [--run-id <id>] [--json]',
    '  gate override <gateId> --reason <text> --approver <name> [--yes] [--json]',
    '  hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>',
    '',
    'Workspace modules:',
    moduleList,
    '',
  ].join('\n');
}

export function runCli(argv: readonly string[], context: CliExecutionContext = {}): CliRunResult {
  const firstArg = argv[0];

  if (firstArg === '--version' || firstArg === '-v') {
    return {
      exitCode: 0,
      stdout: `donaron ${DONARON_CLI_VERSION}\n`,
      stderr: '',
    };
  }

  if (firstArg === undefined || firstArg === '--help' || firstArg === '-h') {
    return {
      exitCode: 0,
      stdout: renderHelpText(),
      stderr: '',
    };
  }

  const parsed = parseCliArgs(argv);
  if (getBooleanFlag(parsed, 'version') || getBooleanFlag(parsed, 'v')) {
    return {
      exitCode: 0,
      stdout: `donaron ${DONARON_CLI_VERSION}\n`,
      stderr: '',
    };
  }
  if (getBooleanFlag(parsed, 'help') || getBooleanFlag(parsed, 'h')) {
    return {
      exitCode: 0,
      stdout: renderHelpText(),
      stderr: '',
    };
  }

  const command = parsed.positionals[0];
  if (command === 'doctor') {
    return handleDoctorCommand(parsed, context);
  }
  if (command === 'adapter') {
    return handleAdapterCommand(parsed);
  }
  if (command === 'plugin') {
    return handlePluginCommand(parsed, context);
  }
  if (command === 'export') {
    return handleExportCommand(parsed, context);
  }
  if (command === 'workflow') {
    return handleWorkflowCommand(parsed, context);
  }
  if (command === 'gate') {
    return handleGateCommand(parsed, context);
  }
  if (command === 'hook') {
    return handleHookCommand(parsed, context);
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `Unknown argument: ${firstArg}. Run "donaron --help" for usage.\n`,
  };
}
