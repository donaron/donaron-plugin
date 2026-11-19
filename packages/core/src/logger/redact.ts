export const REDACTED_VALUE = '[REDACTED]';

const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const JWT_PATTERN =
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const AWS_ACCESS_KEY_PATTERN = /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g;
const GITHUB_CLASSIC_PAT_PATTERN = /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9_]{20,}/g;
const GITHUB_FINE_PAT_PATTERN = /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g;
const PROVIDER_API_KEY_PATTERN = /(?<![A-Za-z0-9])sk-(ant-)?[A-Za-z0-9_-]{16,}/g;
const GOOGLE_API_KEY_PATTERN = /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/g;

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i;

/**
 * Scrubs known credential and secret patterns (AWS keys, GitHub PATs, OpenAI/Anthropic keys,
 * Google API keys, Bearer tokens, JWTs, PEM private key blocks, and URL passwords) from a string.
 */
export function redactSecrets(input: string): string {
  if (input.length === 0) {
    return input;
  }

  return input
    .replace(PEM_PRIVATE_KEY_PATTERN, REDACTED_VALUE)
    .replace(
      URL_CREDENTIALS_PATTERN,
      (_match, prefix: string, _secret: string, suffix: string) =>
        `${prefix}${REDACTED_VALUE}${suffix}`,
    )
    .replace(BEARER_TOKEN_PATTERN, REDACTED_VALUE)
    .replace(JWT_PATTERN, REDACTED_VALUE)
    .replace(AWS_ACCESS_KEY_PATTERN, REDACTED_VALUE)
    .replace(GITHUB_CLASSIC_PAT_PATTERN, REDACTED_VALUE)
    .replace(GITHUB_FINE_PAT_PATTERN, REDACTED_VALUE)
    .replace(PROVIDER_API_KEY_PATTERN, REDACTED_VALUE)
    .replace(GOOGLE_API_KEY_PATTERN, REDACTED_VALUE);
}

function defineEnumerableProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function copyRedactedProperties(
  source: object,
  target: Record<string, unknown>,
  activeAncestors: WeakSet<object>,
): void {
  for (const [key, entryValue] of Object.entries(source)) {
    if (typeof entryValue === 'function') {
      continue;
    }
    defineEnumerableProperty(
      target,
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactValue(entryValue, activeAncestors),
    );
  }
}

function redactValue(
  value: unknown,
  activeAncestors: WeakSet<object>,
  allowToJson = true,
): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value);
  }

  if (typeof value === 'function') {
    return undefined;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (activeAncestors.has(value)) {
    return '[Circular]';
  }

  if (Buffer.isBuffer(value)) {
    return '[Binary]';
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (value instanceof URL) {
    return redactSecrets(value.href);
  }

  activeAncestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, activeAncestors));
    }

    if (value instanceof Error) {
      const clonedError = new Error(redactSecrets(value.message));
      clonedError.name = redactSecrets(value.name);
      if (typeof value.stack === 'string') {
        clonedError.stack = redactSecrets(value.stack);
      }
      if ('cause' in value && value.cause !== undefined) {
        clonedError.cause = redactValue(value.cause, activeAncestors);
      }
      const clonedRecord = clonedError as unknown as Record<string, unknown>;
      const maybeErrors = (value as { readonly errors?: unknown }).errors;
      if (Array.isArray(maybeErrors)) {
        defineEnumerableProperty(clonedRecord, 'errors', redactValue(maybeErrors, activeAncestors));
      }
      copyRedactedProperties(value, clonedRecord, activeAncestors);
      return clonedError;
    }

    if (value instanceof Map) {
      const clonedMap = new Map<unknown, unknown>();
      for (const [entryKey, entryValue] of value.entries()) {
        const redactedKey = redactValue(entryKey, activeAncestors);
        const isSensitiveKey = typeof entryKey === 'string' && SENSITIVE_KEY_PATTERN.test(entryKey);
        clonedMap.set(
          redactedKey,
          isSensitiveKey ? REDACTED_VALUE : redactValue(entryValue, activeAncestors),
        );
      }
      return clonedMap;
    }

    if (value instanceof Set) {
      const clonedSet = new Set<unknown>();
      for (const item of value.values()) {
        clonedSet.add(redactValue(item, activeAncestors));
      }
      return clonedSet;
    }

    if (allowToJson) {
      let toJsonMethod: unknown;
      try {
        toJsonMethod = (value as { readonly toJSON?: unknown }).toJSON;
      } catch {
        toJsonMethod = undefined;
      }

      if (typeof toJsonMethod === 'function') {
        try {
          const serialized = Reflect.apply(
            toJsonMethod as (this: object, key: string) => unknown,
            value,
            [''],
          );
          return redactValue(serialized, activeAncestors, false);
        } catch {
          // Fall through to plain object cloning with functions omitted if toJSON() throws.
        }
      }
    }

    const clonedObj: Record<string, unknown> = {};
    copyRedactedProperties(value, clonedObj, activeAncestors);
    return clonedObj;
  } finally {
    activeAncestors.delete(value);
  }
}

/**
 * Recursively clones an arbitrary value, replacing sensitive object properties with `REDACTED_VALUE`,
 * scrubbing secret patterns from all strings (including `Error` messages and arrays), and marking
 * circular object references as `'[Circular]'`.
 */
export function redactObject<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}
