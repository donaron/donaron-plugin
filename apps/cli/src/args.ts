import type { CliRunResult, ParsedCliArgs } from './types.js';

const BOOLEAN_FLAGS = new Set([
  'json',
  'yes',
  'y',
  'overwrite',
  'approved',
  'rejected',
  'help',
  'h',
  'version',
  'v',
  'allow-skipped',
]);

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | readonly string[]> = {};

  function addFlagValue(key: string, val: string | boolean): void {
    const existing = flags[key];
    if (typeof val === 'boolean') {
      flags[key] = val;
      return;
    }
    if (existing === undefined || typeof existing === 'boolean') {
      flags[key] = val;
      return;
    }
    if (typeof existing === 'string') {
      flags[key] = [existing, val];
      return;
    }
    flags[key] = [...existing, val];
  }

  let idx = 0;
  while (idx < argv.length) {
    const token = argv[idx];
    if (token === undefined) {
      idx += 1;
      continue;
    }

    if (token.startsWith('--')) {
      const stripped = token.slice(2);
      const eqIdx = stripped.indexOf('=');
      if (eqIdx !== -1) {
        const key = stripped.slice(0, eqIdx);
        const val = stripped.slice(eqIdx + 1);
        addFlagValue(key, val);
        idx += 1;
        continue;
      }

      if (BOOLEAN_FLAGS.has(stripped)) {
        addFlagValue(stripped, true);
        idx += 1;
        continue;
      }

      const nextToken = argv[idx + 1];
      if (nextToken !== undefined && !nextToken.startsWith('-')) {
        addFlagValue(stripped, nextToken);
        idx += 2;
        continue;
      }

      addFlagValue(stripped, true);
      idx += 1;
      continue;
    }

    if (token === '-h') {
      addFlagValue('help', true);
      idx += 1;
      continue;
    }

    if (token === '-v') {
      addFlagValue('version', true);
      idx += 1;
      continue;
    }

    if (token === '-y') {
      addFlagValue('yes', true);
      idx += 1;
      continue;
    }

    positionals.push(token);
    idx += 1;
  }

  return {
    positionals,
    flags,
    json: flags.json === true,
  };
}

export function getBooleanFlag(parsed: ParsedCliArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

export function getStringFlag(parsed: ParsedCliArgs, name: string): string | undefined {
  const raw = parsed.flags[name];
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    const last = raw[raw.length - 1] as unknown;
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

export function getStringArrayFlag(parsed: ParsedCliArgs, name: string): readonly string[] {
  const raw = parsed.flags[name];
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        for (const sub of item.split(',')) {
          const trimmed = sub.trim();
          if (trimmed.length > 0) {
            out.push(trimmed);
          }
        }
      }
    }
    return out;
  }
  return [];
}

export function formatCliOutput(
  data: unknown,
  humanText: string,
  asJson: boolean,
  exitCode = 0,
): CliRunResult {
  if (asJson) {
    return {
      exitCode,
      stdout: `${JSON.stringify(data, null, 2)}\n`,
      stderr: '',
    };
  }
  const normalized = humanText.endsWith('\n') ? humanText : `${humanText}\n`;
  return {
    exitCode,
    stdout: exitCode === 0 ? normalized : '',
    stderr: exitCode === 0 ? '' : normalized,
  };
}

export function formatCliError(
  code: string,
  message: string,
  asJson: boolean,
  details?: unknown,
): CliRunResult {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  if (asJson) {
    return {
      exitCode: 1,
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      stderr: '',
    };
  }
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Error [${code}]: ${message}\n`,
  };
}
