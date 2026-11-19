import { parse as parseYaml } from 'yaml';
import type { ValidationResult } from '../types.js';

export interface ParsedFrontmatter {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

const FRONTMATTER_FENCE = /^---[ \t]*$/;

export function stripUtf8Bom(raw: string): string {
  return raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function failFrontmatter(code: string, message: string): ValidationResult<ParsedFrontmatter> {
  return {
    ok: false,
    issues: [{ code, path: '/', message }],
  };
}

/**
 * Splits a markdown file's YAML frontmatter and body after stripping an optional
 * UTF-8 BOM and normalizing CRLF line endings to LF.
 */
export function parseMarkdownFrontmatter(raw: string): ValidationResult<ParsedFrontmatter> {
  const normalized = stripUtf8Bom(raw).replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const firstLine = lines[0];

  if (firstLine === undefined || !FRONTMATTER_FENCE.test(firstLine)) {
    return failFrontmatter(
      'FRONTMATTER_MISSING',
      'Markdown document must begin with a YAML frontmatter block delimited by "---" on line 1.',
    );
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && FRONTMATTER_FENCE.test(line)) {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return failFrontmatter(
      'FRONTMATTER_UNCLOSED',
      'YAML frontmatter block is missing a closing "---" delimiter line.',
    );
  }

  const yamlSource = lines.slice(1, closingIndex).join('\n');
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlSource, {
      logLevel: 'error',
      schema: 'core',
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      maxAliasCount: 25,
    }) as unknown;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return failFrontmatter('FRONTMATTER_INVALID_YAML', `Invalid YAML in frontmatter: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    return failFrontmatter(
      'FRONTMATTER_NOT_OBJECT',
      'YAML frontmatter must evaluate to a plain non-null, non-array key-value object.',
    );
  }

  return {
    ok: true,
    value: {
      data: parsed,
      body: lines.slice(closingIndex + 1).join('\n'),
    },
  };
}
