import { statSync } from 'node:fs';
import { posix } from 'node:path';
import { resolveSafePluginPath } from '../loader/safe-path.js';
import type { ValidationIssue, ValidationResult } from '../types.js';
import {
  collectUnknownKeyIssues,
  formatErrorReason,
  loadMarkdownArtifact,
  readOptionalNonEmptyString,
  readRequiredNonEmptyString,
  readStringArray,
  requireNonEmptyBody,
} from './shared.js';

export interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly activation: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly constraints: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly references: readonly string[];
  readonly scripts: readonly { readonly path: string; readonly requiresPolicyApproval: true }[];
  readonly version?: string;
  readonly body: string;
  readonly sourcePath: string;
}

const ALLOWED_SKILL_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'purpose',
  'activation',
  'inputs',
  'outputs',
  'constraints',
  'completionCriteria',
  'references',
  'scripts',
  'version',
]);

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function resolveSkillAssetPath(
  pluginRoot: string,
  skillDirPosix: string,
  rawEntry: string,
  pointerPath: string,
  issues: ValidationIssue[],
): string | undefined {
  if (hasControlCharacter(rawEntry)) {
    issues.push({
      code: 'INVALID_RELATIVE_PATH',
      path: pointerPath,
      message: `Skill asset path "${rawEntry}" must not contain control characters.`,
    });
    return undefined;
  }

  if (
    rawEntry.startsWith('/') ||
    rawEntry.startsWith('\\') ||
    WINDOWS_DRIVE_PREFIX.test(rawEntry) ||
    rawEntry.includes(':')
  ) {
    issues.push({
      code: 'UNSAFE_PATH',
      path: pointerPath,
      message: `Skill asset path "${rawEntry}" must be a relative path inside the plugin root.`,
    });
    return undefined;
  }

  const posixEntry = rawEntry.replaceAll('\\', '/');
  let seenNonParentSegment = false;
  for (const segment of posixEntry.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (seenNonParentSegment) {
        issues.push({
          code: 'PATH_TRAVERSAL',
          path: pointerPath,
          message: `Nested traversal segment ("..") is not allowed in skill asset path "${rawEntry}".`,
        });
        return undefined;
      }
      continue;
    }
    seenNonParentSegment = true;
  }

  const joinedRelativePath =
    skillDirPosix === '.' ? posixEntry : posix.join(skillDirPosix, posixEntry);
  const resolvedAsset = resolveSafePluginPath(pluginRoot, joinedRelativePath, { mustExist: true });

  if (!resolvedAsset.ok) {
    for (const issue of resolvedAsset.issues) {
      issues.push({
        code: issue.code,
        path: pointerPath,
        message: issue.message,
      });
    }
    return undefined;
  }

  try {
    if (!statSync(resolvedAsset.value.absolutePath).isFile()) {
      issues.push({
        code: 'NOT_A_FILE',
        path: pointerPath,
        message: `Skill asset path "${rawEntry}" must resolve to a regular file.`,
      });
      return undefined;
    }
  } catch (error: unknown) {
    issues.push({
      code: 'FILE_READ_ERROR',
      path: pointerPath,
      message: `Unable to inspect skill asset "${rawEntry}": ${formatErrorReason(error)}`,
    });
    return undefined;
  }

  return resolvedAsset.value.relativePosixPath;
}

function resolveSkillAssetList(
  pluginRoot: string,
  skillDirPosix: string,
  entries: readonly string[] | undefined,
  fieldKey: string,
  issues: ValidationIssue[],
): readonly string[] {
  if (entries === undefined) {
    return [];
  }

  const resolvedPaths: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const resolvedPath = resolveSkillAssetPath(
      pluginRoot,
      skillDirPosix,
      entry,
      `/${fieldKey}/${String(index)}`,
      issues,
    );
    if (resolvedPath !== undefined) {
      resolvedPaths.push(resolvedPath);
    }
  }
  return resolvedPaths;
}

/**
 * Loads, validates, and parses a plugin skill markdown file (`SKILL.md`),
 * resolving all referenced documentation and script paths safely within `pluginRoot`.
 */
export function parseSkillFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<ParsedSkill> {
  const loaded = loadMarkdownArtifact(pluginRoot, relativePath);
  if (!loaded.ok) {
    return loaded;
  }

  const { data, body, sourcePath } = loaded.value;
  const issues: ValidationIssue[] = [];

  collectUnknownKeyIssues(data, ALLOWED_SKILL_KEYS, 'SKILL_ADDITIONAL_PROPERTY', issues);

  const name = readRequiredNonEmptyString(data, 'name', issues, 'SKILL');
  const description = readRequiredNonEmptyString(data, 'description', issues, 'SKILL');
  const purpose = readRequiredNonEmptyString(data, 'purpose', issues, 'SKILL');
  const activation = readRequiredNonEmptyString(data, 'activation', issues, 'SKILL');
  const inputs = readStringArray(data, 'inputs', true, issues, 'SKILL');
  const outputs = readStringArray(data, 'outputs', true, issues, 'SKILL');
  const constraints = readStringArray(data, 'constraints', true, issues, 'SKILL');
  const completionCriteria = readStringArray(data, 'completionCriteria', true, issues, 'SKILL');
  const rawReferences = readStringArray(data, 'references', false, issues, 'SKILL');
  const rawScripts = readStringArray(data, 'scripts', false, issues, 'SKILL');
  const version = readOptionalNonEmptyString(data, 'version', issues, 'SKILL');

  requireNonEmptyBody(body, issues, 'SKILL');

  const skillDirPosix = posix.dirname(sourcePath);
  const references = resolveSkillAssetList(
    pluginRoot,
    skillDirPosix,
    rawReferences,
    'references',
    issues,
  );
  const scriptPaths = resolveSkillAssetList(
    pluginRoot,
    skillDirPosix,
    rawScripts,
    'scripts',
    issues,
  );

  if (
    issues.length > 0 ||
    name === undefined ||
    description === undefined ||
    purpose === undefined ||
    activation === undefined ||
    inputs === undefined ||
    outputs === undefined ||
    constraints === undefined ||
    completionCriteria === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      name,
      description,
      purpose,
      activation,
      inputs,
      outputs,
      constraints,
      completionCriteria,
      references,
      scripts: scriptPaths.map((scriptPath) => ({
        path: scriptPath,
        requiresPolicyApproval: true as const,
      })),
      ...(version !== undefined ? { version } : {}),
      body,
      sourcePath,
    },
  };
}
