import type { ValidationIssue, ValidationResult } from '../types.js';
import { isPlainObject, stripUtf8Bom } from './frontmatter.js';
import {
  collectUnknownKeyIssues,
  failValidation,
  formatErrorReason,
  readBoolean,
  readOptionalNonEmptyString,
  readRequiredEnum,
  readRequiredInteger,
  readRequiredNonEmptyString,
  readSafePluginTextFile,
} from './shared.js';

export type HookEventName = 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop';
export type BuiltinHookHandler =
  | 'session-context'
  | 'policy-guard'
  | 'stale-tracker'
  | 'gate-stop-guard';

export interface HookBinding {
  readonly id: string;
  readonly event: HookEventName;
  readonly handler: BuiltinHookHandler;
  readonly matcher?: string;
  readonly timeoutSec: number;
  readonly failurePolicy: 'fail_closed' | 'warn';
  readonly enabled: boolean;
}

const HOOK_EVENTS: readonly HookEventName[] = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'];

const BUILTIN_HANDLERS: readonly BuiltinHookHandler[] = [
  'session-context',
  'policy-guard',
  'stale-tracker',
  'gate-stop-guard',
];

const FAILURE_POLICIES: readonly ('fail_closed' | 'warn')[] = ['fail_closed', 'warn'];

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['hooks']);

const ALLOWED_HOOK_KEYS: ReadonlySet<string> = new Set([
  'id',
  'event',
  'handler',
  'matcher',
  'timeoutSec',
  'failurePolicy',
  'enabled',
]);

/**
 * Loads and strictly validates declarative hook bindings (`hooks/hooks.json`).
 * Arbitrary shell `command` fields, unknown handlers, unknown keys, and duplicate hook IDs are rejected.
 */
export function parseHooksFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<readonly HookBinding[]> {
  const fileResult = readSafePluginTextFile(pluginRoot, relativePath);
  if (!fileResult.ok) {
    return fileResult;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(fileResult.value.content)) as unknown;
  } catch (error: unknown) {
    return failValidation(
      'HOOKS_INVALID_JSON',
      '/',
      `Invalid JSON in hooks file: ${formatErrorReason(error)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    return failValidation(
      'HOOKS_INVALID_SCHEMA',
      '/',
      'Hooks file must contain a JSON object with a "hooks" array.',
    );
  }

  const issues: ValidationIssue[] = [];
  collectUnknownKeyIssues(parsed, ALLOWED_TOP_LEVEL_KEYS, 'HOOKS_ADDITIONAL_PROPERTY', issues);

  if (!Object.hasOwn(parsed, 'hooks')) {
    issues.push({
      code: 'HOOKS_MISSING_PROPERTY',
      path: '/hooks',
      message: 'Missing required property "hooks".',
    });
    return { ok: false, issues };
  }

  const rawHooks = parsed.hooks;
  if (!Array.isArray(rawHooks)) {
    issues.push({
      code: 'HOOKS_INVALID_ARRAY',
      path: '/hooks',
      message: 'Property "hooks" must be an array of hook binding objects.',
    });
    return { ok: false, issues };
  }

  const bindings: HookBinding[] = [];
  const seenIds = new Set<string>();

  for (const [index, rawEntry] of rawHooks.entries()) {
    const itemPointer = `/hooks/${String(index)}`;
    if (!isPlainObject(rawEntry)) {
      issues.push({
        code: 'HOOK_INVALID_OBJECT',
        path: itemPointer,
        message: `Hook entry at "${itemPointer}" must be an object.`,
      });
      continue;
    }

    collectUnknownKeyIssues(
      rawEntry,
      ALLOWED_HOOK_KEYS,
      'HOOK_ADDITIONAL_PROPERTY',
      issues,
      itemPointer,
      (key) =>
        key === 'command'
          ? 'Unexpected property "command". Arbitrary shell commands are not permitted in declarative hooks.'
          : `Unexpected property "${key}".`,
    );

    const id = readRequiredNonEmptyString(rawEntry, 'id', issues, 'HOOK', itemPointer);
    const event = readRequiredEnum(rawEntry, 'event', HOOK_EVENTS, issues, 'HOOK', itemPointer);
    const handler = readRequiredEnum(
      rawEntry,
      'handler',
      BUILTIN_HANDLERS,
      issues,
      'HOOK',
      itemPointer,
    );
    const matcher = readOptionalNonEmptyString(rawEntry, 'matcher', issues, 'HOOK', itemPointer);
    const timeoutSec = readRequiredInteger(
      rawEntry,
      'timeoutSec',
      { min: 1, max: 120 },
      issues,
      'HOOK',
      itemPointer,
    );
    const failurePolicy = readRequiredEnum(
      rawEntry,
      'failurePolicy',
      FAILURE_POLICIES,
      issues,
      'HOOK',
      itemPointer,
    );
    const enabled = readBoolean(
      rawEntry,
      'enabled',
      { required: false, defaultValue: true },
      issues,
      'HOOK',
      itemPointer,
    );

    if (id !== undefined) {
      if (seenIds.has(id)) {
        issues.push({
          code: 'HOOK_DUPLICATE_ID',
          path: `${itemPointer}/id`,
          message: `Duplicate hook id "${id}".`,
        });
      } else {
        seenIds.add(id);
      }
    }

    if (
      id !== undefined &&
      event !== undefined &&
      handler !== undefined &&
      timeoutSec !== undefined &&
      failurePolicy !== undefined &&
      enabled !== undefined
    ) {
      bindings.push({
        id,
        event,
        handler,
        ...(matcher !== undefined ? { matcher } : {}),
        timeoutSec,
        failurePolicy,
        enabled,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: bindings,
  };
}
