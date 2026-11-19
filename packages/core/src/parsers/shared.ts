import { readFileSync, statSync } from 'node:fs';
import { resolveSafePluginPath } from '../loader/safe-path.js';
import type { ValidationIssue, ValidationResult } from '../types.js';
import { parseMarkdownFrontmatter } from './frontmatter.js';

export interface SafePluginTextFile {
  readonly absolutePath: string;
  readonly relativePosixPath: string;
  readonly content: string;
}

export interface LoadedMarkdownArtifact {
  readonly data: Record<string, unknown>;
  readonly body: string;
  readonly sourcePath: string;
}

export function joinJsonPointer(basePath: string, segment: string): string {
  const escaped = segment.replaceAll('~', '~0').replaceAll('/', '~1');
  return basePath === '' ? `/${escaped}` : `${basePath}/${escaped}`;
}

export function failValidation<T>(
  code: string,
  path: string,
  message: string,
): ValidationResult<T> {
  return {
    ok: false,
    issues: [{ code, path, message }],
  };
}

export function formatErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readSafePluginTextFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<SafePluginTextFile> {
  const resolved = resolveSafePluginPath(pluginRoot, relativePath, { mustExist: true });
  if (!resolved.ok) {
    return resolved;
  }

  const { absolutePath, relativePosixPath } = resolved.value;

  try {
    if (!statSync(absolutePath).isFile()) {
      return failValidation(
        'NOT_A_FILE',
        relativePosixPath,
        `Plugin path "${relativePosixPath}" is not a regular file.`,
      );
    }
  } catch (error: unknown) {
    return failValidation(
      'FILE_READ_ERROR',
      relativePosixPath,
      `Failed to inspect plugin file "${relativePosixPath}": ${formatErrorReason(error)}`,
    );
  }

  try {
    const content = readFileSync(absolutePath, 'utf8');
    return {
      ok: true,
      value: {
        absolutePath,
        relativePosixPath,
        content,
      },
    };
  } catch (error: unknown) {
    return failValidation(
      'FILE_READ_ERROR',
      relativePosixPath,
      `Failed to read plugin file "${relativePosixPath}": ${formatErrorReason(error)}`,
    );
  }
}

export function loadMarkdownArtifact(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<LoadedMarkdownArtifact> {
  const fileResult = readSafePluginTextFile(pluginRoot, relativePath);
  if (!fileResult.ok) {
    return fileResult;
  }

  const frontmatterResult = parseMarkdownFrontmatter(fileResult.value.content);
  if (!frontmatterResult.ok) {
    return frontmatterResult;
  }

  return {
    ok: true,
    value: {
      data: frontmatterResult.value.data,
      body: frontmatterResult.value.body.trim(),
      sourcePath: fileResult.value.relativePosixPath,
    },
  };
}

export function collectUnknownKeyIssues(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  issueCode: string,
  issues: ValidationIssue[],
  basePointer = '',
  customMessage?: (key: string) => string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        code: issueCode,
        path: joinJsonPointer(basePointer, key),
        message: customMessage ? customMessage(key) : `Unexpected property "${key}".`,
      });
    }
  }
}

export function readRequiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): string | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    issues.push({
      code: `${codePrefix}_MISSING_PROPERTY`,
      path: pointer,
      message: `Missing required property "${key}".`,
    });
    return undefined;
  }

  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({
      code: `${codePrefix}_INVALID_STRING`,
      path: pointer,
      message: `Property "${key}" must be a non-empty string.`,
    });
    return undefined;
  }

  return value;
}

export function readOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): string | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }

  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({
      code: `${codePrefix}_INVALID_STRING`,
      path: joinJsonPointer(basePointer, key),
      message: `Optional property "${key}" must be a non-empty string when provided.`,
    });
    return undefined;
  }

  return value;
}

export function readStringArray(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): readonly string[] | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    if (required) {
      issues.push({
        code: `${codePrefix}_MISSING_PROPERTY`,
        path: pointer,
        message: `Missing required property "${key}".`,
      });
      return undefined;
    }
    return [];
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push({
      code: `${codePrefix}_INVALID_ARRAY`,
      path: pointer,
      message: `Property "${key}" must be an array of non-empty strings.`,
    });
    return undefined;
  }

  const items: string[] = [];
  let hasItemError = false;
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issues.push({
        code: `${codePrefix}_INVALID_STRING`,
        path: `${pointer}/${String(index)}`,
        message: `Entry at "${key}[${String(index)}]" must be a non-empty string.`,
      });
      hasItemError = true;
    } else {
      items.push(entry);
    }
  }

  return hasItemError ? undefined : items;
}

export function readRequiredEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): T | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    issues.push({
      code: `${codePrefix}_MISSING_PROPERTY`,
      path: pointer,
      message: `Missing required property "${key}".`,
    });
    return undefined;
  }

  const value = record[key];
  if (typeof value === 'string') {
    const match = allowedValues.find((candidate) => candidate === value);
    if (match !== undefined) {
      return match;
    }
  }

  issues.push({
    code: `${codePrefix}_INVALID_ENUM`,
    path: pointer,
    message: `Property "${key}" must be one of: ${allowedValues.join(', ')}.`,
  });
  return undefined;
}

export function readRequiredInteger(
  record: Record<string, unknown>,
  key: string,
  bounds: { readonly min?: number; readonly max?: number },
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): number | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    issues.push({
      code: `${codePrefix}_MISSING_PROPERTY`,
      path: pointer,
      message: `Missing required property "${key}".`,
    });
    return undefined;
  }

  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push({
      code: `${codePrefix}_INVALID_INTEGER`,
      path: pointer,
      message: `Property "${key}" must be an integer.`,
    });
    return undefined;
  }

  if (bounds.min !== undefined && value < bounds.min) {
    issues.push({
      code: `${codePrefix}_OUT_OF_RANGE`,
      path: pointer,
      message: `Property "${key}" must be >= ${String(bounds.min)}.`,
    });
    return undefined;
  }

  if (bounds.max !== undefined && value > bounds.max) {
    issues.push({
      code: `${codePrefix}_OUT_OF_RANGE`,
      path: pointer,
      message: `Property "${key}" must be <= ${String(bounds.max)}.`,
    });
    return undefined;
  }

  return value;
}

export function readBoolean(
  record: Record<string, unknown>,
  key: string,
  options: { readonly required: boolean; readonly defaultValue: boolean },
  issues: ValidationIssue[],
  codePrefix: string,
  basePointer = '',
): boolean | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    if (options.required) {
      issues.push({
        code: `${codePrefix}_MISSING_PROPERTY`,
        path: pointer,
        message: `Missing required property "${key}".`,
      });
      return undefined;
    }
    return options.defaultValue;
  }

  const value = record[key];
  if (typeof value !== 'boolean') {
    issues.push({
      code: `${codePrefix}_INVALID_BOOLEAN`,
      path: pointer,
      message: `Property "${key}" must be a boolean.`,
    });
    return undefined;
  }

  return value;
}

export function requireNonEmptyBody(
  body: string,
  issues: ValidationIssue[],
  codePrefix: string,
): void {
  if (body.length === 0) {
    issues.push({
      code: `${codePrefix}_EMPTY_BODY`,
      path: '/body',
      message: 'Markdown body must not be empty.',
    });
  }
}
