import {
  executeNormalizedHook,
  getHarnessAdapter,
  type HarnessId,
  type NormalizedHookDecision,
} from '@donaron/adapters';
import type { HookEventName } from '@donaron/core';
import { formatCliError } from '../args.js';
import type { CliExecutionContext, CliRunResult, ParsedCliArgs } from '../types.js';

const VALID_HARNESSES = new Set<HarnessId>(['antigravity', 'claude-code']);
const VALID_EVENTS = new Set<HookEventName>(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);

export function handleHookCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const harnessRaw = parsed.positionals[1];
  const eventRaw = parsed.positionals[2];

  if (
    harnessRaw === undefined ||
    !VALID_HARNESSES.has(harnessRaw as HarnessId) ||
    eventRaw === undefined ||
    !VALID_EVENTS.has(eventRaw as HookEventName)
  ) {
    return formatCliError(
      'INVALID_HOOK_ARGS',
      'Usage: donaron hook <antigravity|claude-code> <SessionStart|PreToolUse|PostToolUse|Stop>',
      true,
    );
  }

  const harnessId = harnessRaw as HarnessId;
  const event = eventRaw as HookEventName;
  const adapter = getHarnessAdapter(harnessId);
  const rawStdin = context.stdin ?? '';

  const translatedIn = adapter.translateHookInput(event, rawStdin);
  if (!translatedIn.ok) {
    // Fail-closed: translate a synthetic deny (for PreToolUse) or allow_stop (for Stop) into native stdout JSON
    const failClosedDecision: NormalizedHookDecision =
      event === 'PreToolUse'
        ? {
            event: 'PreToolUse',
            decision: 'deny',
            reason: `Fail-closed hook input parse error: ${translatedIn.issues.map((i) => i.message).join('; ')}`,
          }
        : event === 'Stop'
          ? {
              event: 'Stop',
              decision: 'allow_stop',
            }
          : {
              event,
              decision: 'allow',
            };

    const failOutput = adapter.translateHookOutput(event, failClosedDecision);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(failOutput)}\n`,
      stderr: '',
    };
  }

  const decision = executeNormalizedHook(translatedIn.value);
  const nativeOutput = adapter.translateHookOutput(event, decision);

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(nativeOutput)}\n`,
    stderr: '',
  };
}
