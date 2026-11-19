import type { ValidationIssue, ValidationResult } from '../types.js';
import {
  collectUnknownKeyIssues,
  loadMarkdownArtifact,
  readRequiredEnum,
  readRequiredInteger,
  readRequiredNonEmptyString,
  requireNonEmptyBody,
} from './shared.js';

export type RuleCategory = 'routing' | 'security' | 'development' | 'writing';

export interface ParsedRule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly scope: string;
  readonly priority: number;
  readonly body: string;
  readonly sourcePath: string;
}

const RULE_CATEGORIES: readonly RuleCategory[] = ['routing', 'security', 'development', 'writing'];

const ALLOWED_RULE_KEYS: ReadonlySet<string> = new Set(['id', 'category', 'scope', 'priority']);

/**
 * Loads, validates, and parses a guidance rule markdown file (`rules/*.md`).
 * Unknown frontmatter keys (including policy enforcement fields) are strictly rejected.
 */
export function parseRuleFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<ParsedRule> {
  const loaded = loadMarkdownArtifact(pluginRoot, relativePath);
  if (!loaded.ok) {
    return loaded;
  }

  const { data, body, sourcePath } = loaded.value;
  const issues: ValidationIssue[] = [];

  collectUnknownKeyIssues(data, ALLOWED_RULE_KEYS, 'RULE_ADDITIONAL_PROPERTY', issues, '', (key) =>
    key === 'enforcement'
      ? 'Unexpected property "enforcement". Deterministic policies belong in JSON policy files, not markdown guidance rules.'
      : `Unexpected property "${key}".`,
  );

  const id = readRequiredNonEmptyString(data, 'id', issues, 'RULE');
  const category = readRequiredEnum(data, 'category', RULE_CATEGORIES, issues, 'RULE');
  const scope = readRequiredNonEmptyString(data, 'scope', issues, 'RULE');
  const priority = readRequiredInteger(data, 'priority', {}, issues, 'RULE');

  requireNonEmptyBody(body, issues, 'RULE');

  if (
    issues.length > 0 ||
    id === undefined ||
    category === undefined ||
    scope === undefined ||
    priority === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      id,
      category,
      scope,
      priority,
      body,
      sourcePath,
    },
  };
}
