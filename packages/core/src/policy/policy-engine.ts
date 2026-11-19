import { type Stats, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { isPlainObject, stripUtf8Bom } from '../parsers/frontmatter.js';
import {
  collectUnknownKeyIssues,
  failValidation,
  formatErrorReason,
  joinJsonPointer,
  readRequiredEnum,
  readRequiredInteger,
  readRequiredNonEmptyString,
  readSafePluginTextFile,
} from '../parsers/shared.js';
import type { ValidationIssue, ValidationResult } from '../types.js';
import {
  DEFAULT_SECURITY_POLICIES,
  type PolicyAction,
  type PolicyActorType,
  type PolicyEffect,
  type PolicyRule,
} from './defaults.js';

export {
  DEFAULT_SECURITY_POLICIES,
  type PolicyAction,
  type PolicyActorType,
  type PolicyEffect,
  type PolicyRule,
} from './defaults.js';

export interface PolicyRequest {
  readonly action: PolicyAction;
  readonly actorType: PolicyActorType;
  readonly actorId?: string;
  readonly workspaceRoot?: string;
  readonly targetPath?: string;
  readonly command?: string;
  readonly allowlistedPaths?: readonly string[];
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly matchedRuleId: string;
  readonly reason: string;
  readonly evaluatedRulesCount: number;
  readonly failedClosed: boolean;
}

interface CompiledRule {
  readonly rule: PolicyRule;
  readonly pathRegexes: readonly RegExp[];
  readonly commandRegexes: readonly RegExp[];
}

type PathImpl = typeof posix;

type TargetResolutionResult =
  | { readonly ok: true; readonly normalizedPosixPath: string; readonly caseInsensitive: boolean }
  | {
      readonly ok: false;
      readonly matchedRuleId: string;
      readonly reason: string;
      readonly failedClosed: boolean;
    };

const POLICY_EFFECTS: readonly PolicyEffect[] = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'];

const POLICY_ACTIONS: readonly PolicyAction[] = [
  'fs:read',
  'fs:write',
  'fs:delete',
  'cmd:exec',
  'net:outbound',
  'env:read',
  'workflow:override',
  'workflow:record-review',
];

const POLICY_ACTOR_TYPES: readonly PolicyActorType[] = ['agent', 'human', 'system'];

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['rules']);

const ALLOWED_RULE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'description',
  'priority',
  'effect',
  'actions',
  'pathPatterns',
  'commandPatterns',
  'actorTypes',
  'critical',
]);

const EFFECT_RANK: Readonly<Record<PolicyEffect, number>> = {
  ALLOW: 1,
  REQUIRE_APPROVAL: 2,
  DENY: 3,
};

const WINDOWS_DRIVE_ABSOLUTE = /^[a-zA-Z]:[/\\]/;
const WINDOWS_DRIVE_RELATIVE = /^[a-zA-Z]:(?![/\\])/;
const MAX_SYMLINK_DEPTH = 32;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function getErrnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function getWindowsDriveLetter(value: string): string | undefined {
  return WINDOWS_DRIVE_ABSOLUTE.test(value) ? value.slice(0, 1).toLowerCase() : undefined;
}

function isUncOrDevicePath(value: string): boolean {
  return value.startsWith('\\\\') || value.startsWith('//');
}

function isDeviceNamespacePath(value: string): boolean {
  return (
    value.startsWith('\\\\?\\') ||
    value.startsWith('\\\\.\\') ||
    value.startsWith('//?/') ||
    value.startsWith('//./')
  );
}

function getUncShareRoot(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized.startsWith('//')) {
    return undefined;
  }
  const parts = normalized
    .slice(2)
    .split('/')
    .filter((segment) => segment.length > 0);
  if (parts.length < 2) {
    return undefined;
  }
  const server = parts[0];
  const share = parts[1];
  if (server === undefined || share === undefined) {
    return undefined;
  }
  return `//${server.toLowerCase()}/${share.toLowerCase()}`;
}

function isWindowsStylePath(value: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE.test(value) || value.startsWith('\\\\');
}

function selectPathContext(
  workspaceRoot: string | undefined,
  targetPath: string,
): { readonly pathImpl: PathImpl; readonly caseInsensitive: boolean } {
  const useWin32 =
    process.platform === 'win32' ||
    (workspaceRoot !== undefined && isWindowsStylePath(workspaceRoot)) ||
    isWindowsStylePath(targetPath);

  return {
    pathImpl: useWin32 ? win32 : posix,
    caseInsensitive: useWin32,
  };
}

function normalizeForComparison(
  target: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
): string {
  const resolved = pathImpl.resolve(target);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

function isContainedPath(
  root: string,
  candidate: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
): boolean {
  const normRoot = normalizeForComparison(root, pathImpl, caseInsensitive);
  const normCandidate = normalizeForComparison(candidate, pathImpl, caseInsensitive);
  if (normCandidate === normRoot) {
    return true;
  }
  const rootPrefix = normRoot.endsWith(pathImpl.sep) ? normRoot : `${normRoot}${pathImpl.sep}`;
  return normCandidate.startsWith(rootPrefix);
}

function stripTrailingSlashes(posixPath: string): string {
  if (posixPath === '/' || posixPath === '.') {
    return posixPath;
  }
  let end = posixPath.length;
  while (end > 1 && posixPath.charCodeAt(end - 1) === 0x2f) {
    end -= 1;
  }
  return posixPath.slice(0, end);
}

function toPosixRelative(root: string, target: string, pathImpl: PathImpl): string {
  const rel = pathImpl.relative(root, target);
  if (rel === '') {
    return '.';
  }
  return stripTrailingSlashes(rel.split(pathImpl.sep).join('/'));
}

function normalizeStandalonePath(targetPath: string): string {
  const slashed = targetPath.replaceAll('\\', '/');
  if (slashed.startsWith('//')) {
    const rest = slashed.slice(2);
    return stripTrailingSlashes(`//${posix.normalize(rest)}`);
  }
  return stripTrailingSlashes(posix.normalize(slashed));
}

function resolveDiskRoot(resolvedRoot: string, pathImpl: PathImpl): string | undefined {
  try {
    return pathImpl.resolve(realpathSync(resolvedRoot));
  } catch (error: unknown) {
    const code = getErrnoCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }
}

function resolveSegmentsOnDisk(
  rawPath: string,
  relativeBase: string,
  anchorFallbackBase: string,
  realRoot: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
  visited: Set<string>,
  depth: number,
): { readonly resolvedPath: string; readonly escapedRoot: boolean } {
  const separatorPattern = caseInsensitive ? /[/\\]/ : '/';
  const isAnchored =
    pathImpl.isAbsolute(rawPath) ||
    rawPath.startsWith('/') ||
    (caseInsensitive && rawPath.startsWith('\\'));

  let cursor: string;
  let segments: string[];

  if (isAnchored) {
    const parsed = pathImpl.parse(pathImpl.resolve(anchorFallbackBase, rawPath));
    cursor = parsed.root;
    let rawWithoutRoot: string;
    if (caseInsensitive && isUncOrDevicePath(rawPath)) {
      rawWithoutRoot = rawPath.replace(/^[/\\]{2}[^/\\]+[/\\][^/\\]+[/\\]?/, '');
    } else if (caseInsensitive) {
      rawWithoutRoot = rawPath.replace(/^(?:[a-zA-Z]:[/\\]+|[/\\]+)/, '');
    } else {
      rawWithoutRoot = rawPath.replace(/^\/+/, '');
    }
    segments = rawWithoutRoot.split(separatorPattern);
  } else {
    cursor = relativeBase;
    segments = rawPath.split(separatorPattern);
  }

  let hasEnteredRoot = isContainedPath(realRoot, cursor, pathImpl, caseInsensitive);
  let escapedRoot = false;

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (!isContainedPath(realRoot, cursor, pathImpl, caseInsensitive)) {
        escapedRoot = true;
      }
      const parent = pathImpl.dirname(cursor);
      if (parent === cursor || !isContainedPath(realRoot, parent, pathImpl, caseInsensitive)) {
        escapedRoot = true;
      }
      cursor = parent;
      continue;
    }

    cursor = pathImpl.join(cursor, segment);
    if (isContainedPath(realRoot, cursor, pathImpl, caseInsensitive)) {
      hasEnteredRoot = true;
    }

    let stats: Stats;
    try {
      stats = lstatSync(cursor);
    } catch (error: unknown) {
      const code = getErrnoCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        continue;
      }
      throw error;
    }

    if (!stats.isSymbolicLink()) {
      continue;
    }

    try {
      const realCursor = pathImpl.resolve(realpathSync(cursor));
      const inRoot = isContainedPath(realRoot, realCursor, pathImpl, caseInsensitive);
      const isAncestorOfRoot =
        !hasEnteredRoot && isContainedPath(realCursor, realRoot, pathImpl, caseInsensitive);
      if (!inRoot && !isAncestorOfRoot) {
        escapedRoot = true;
      }
      cursor = realCursor;
      if (inRoot) {
        hasEnteredRoot = true;
      }
    } catch (symlinkError: unknown) {
      const symlinkCode = getErrnoCode(symlinkError);
      if (symlinkCode === 'ENOENT' || symlinkCode === 'ENOTDIR') {
        const broken = resolveBrokenSymlinkTarget(
          cursor,
          realRoot,
          pathImpl,
          caseInsensitive,
          visited,
          depth + 1,
        );
        if (broken.escapedRoot) {
          escapedRoot = true;
        }
        cursor = broken.resolvedPath;
        if (isContainedPath(realRoot, cursor, pathImpl, caseInsensitive)) {
          hasEnteredRoot = true;
        }
      } else {
        throw symlinkError;
      }
    }
  }

  if (!isContainedPath(realRoot, cursor, pathImpl, caseInsensitive)) {
    escapedRoot = true;
  }

  return { resolvedPath: cursor, escapedRoot };
}

function resolveBrokenSymlinkTarget(
  symlinkPath: string,
  realRoot: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
  visited: Set<string>,
  depth = 0,
): { readonly resolvedPath: string; readonly escapedRoot: boolean } {
  const realParent = pathImpl.resolve(realpathSync(pathImpl.dirname(symlinkPath)));
  const canonicalLink = pathImpl.resolve(realParent, pathImpl.basename(symlinkPath));
  const visitKey = caseInsensitive ? canonicalLink.toLowerCase() : canonicalLink;

  if (visited.has(visitKey) || depth >= MAX_SYMLINK_DEPTH) {
    throw new Error(`Symlink loop or excessive symlink depth at "${symlinkPath}".`);
  }
  visited.add(visitKey);

  try {
    const rawTarget = readlinkSync(canonicalLink);
    if (
      rawTarget.trim().length === 0 ||
      hasControlCharacter(rawTarget) ||
      (caseInsensitive && WINDOWS_DRIVE_RELATIVE.test(rawTarget))
    ) {
      throw new Error(`Unsafe symlink target at "${symlinkPath}".`);
    }

    const segResult = resolveSegmentsOnDisk(
      rawTarget,
      realParent,
      realParent,
      realRoot,
      pathImpl,
      caseInsensitive,
      visited,
      depth + 1,
    );
    const ancestor = resolveTargetOnDisk(
      segResult.resolvedPath,
      realRoot,
      realRoot,
      pathImpl,
      caseInsensitive,
      visited,
      depth + 1,
    );

    return {
      resolvedPath: ancestor.resolvedPath,
      escapedRoot:
        !isContainedPath(realRoot, realParent, pathImpl, caseInsensitive) ||
        segResult.escapedRoot ||
        ancestor.escapedRoot ||
        !isContainedPath(realRoot, ancestor.resolvedPath, pathImpl, caseInsensitive),
    };
  } finally {
    visited.delete(visitKey);
  }
}

function resolveTargetOnDisk(
  candidate: string,
  lexicalRoot: string,
  realRoot: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
  visited: Set<string>,
  depth = 0,
): { readonly resolvedPath: string; readonly escapedRoot: boolean } {
  const trailingSegments: string[] = [];
  let current = candidate;
  let shouldContinue = true;

  while (shouldContinue) {
    let lstatSucceeded = false;
    try {
      lstatSync(current);
      lstatSucceeded = true;
    } catch (error: unknown) {
      const code = getErrnoCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
    }

    if (lstatSucceeded) {
      try {
        const realCurrent = pathImpl.resolve(realpathSync(current));
        const resolvedPath =
          trailingSegments.length === 0
            ? realCurrent
            : pathImpl.resolve(realCurrent, ...trailingSegments.reverse());
        return {
          resolvedPath,
          escapedRoot: !isContainedPath(realRoot, resolvedPath, pathImpl, caseInsensitive),
        };
      } catch (error: unknown) {
        const code = getErrnoCode(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          const broken = resolveBrokenSymlinkTarget(
            current,
            realRoot,
            pathImpl,
            caseInsensitive,
            visited,
            depth,
          );
          const resolvedPath =
            trailingSegments.length === 0
              ? broken.resolvedPath
              : pathImpl.resolve(broken.resolvedPath, ...trailingSegments.reverse());
          return {
            resolvedPath,
            escapedRoot:
              broken.escapedRoot ||
              !isContainedPath(realRoot, resolvedPath, pathImpl, caseInsensitive),
          };
        }
        throw error;
      }
    }

    if (
      normalizeForComparison(current, pathImpl, caseInsensitive) ===
      normalizeForComparison(lexicalRoot, pathImpl, caseInsensitive)
    ) {
      shouldContinue = false;
      continue;
    }

    const parent = pathImpl.dirname(current);
    if (parent === current) {
      shouldContinue = false;
      continue;
    }
    trailingSegments.push(pathImpl.basename(current));
    current = parent;
  }

  return {
    resolvedPath: candidate,
    escapedRoot: !isContainedPath(realRoot, candidate, pathImpl, caseInsensitive),
  };
}

function resolveWithDotDotSymlinkCheck(
  rawTargetPath: string,
  resolvedRoot: string,
  realRoot: string,
  pathImpl: PathImpl,
  caseInsensitive: boolean,
): { readonly resolvedPath: string; readonly escapedRoot: boolean } | undefined {
  const separatorPattern = caseInsensitive ? /[/\\]/ : '/';
  const rawSegments = rawTargetPath.split(separatorPattern);
  if (!rawSegments.includes('..')) {
    return undefined;
  }

  const visited = new Set<string>();
  const segResult = resolveSegmentsOnDisk(
    rawTargetPath,
    realRoot,
    resolvedRoot,
    realRoot,
    pathImpl,
    caseInsensitive,
    visited,
    0,
  );
  const diskResult = resolveTargetOnDisk(
    segResult.resolvedPath,
    resolvedRoot,
    realRoot,
    pathImpl,
    caseInsensitive,
    visited,
    0,
  );

  return {
    resolvedPath: diskResult.resolvedPath,
    escapedRoot: segResult.escapedRoot || diskResult.escapedRoot,
  };
}

function resolveTargetPath(
  request: PolicyRequest,
  enforceContainment: boolean,
): TargetResolutionResult {
  const targetPath = request.targetPath;
  if (targetPath === undefined) {
    return { ok: true, normalizedPosixPath: '', caseInsensitive: false };
  }

  const rawWorkspaceRoot = request.workspaceRoot;
  if (
    enforceContainment &&
    (rawWorkspaceRoot === undefined || rawWorkspaceRoot.trim().length === 0)
  ) {
    return {
      ok: false,
      matchedRuleId: 'builtin-missing-workspace-root',
      reason: `Cannot perform "${request.action}" without a valid workspaceRoot.`,
      failedClosed: true,
    };
  }

  if (rawWorkspaceRoot !== undefined && hasControlCharacter(rawWorkspaceRoot)) {
    return {
      ok: false,
      matchedRuleId: 'builtin-missing-workspace-root',
      reason: 'workspaceRoot contains invalid null bytes or control characters.',
      failedClosed: true,
    };
  }

  if (hasControlCharacter(targetPath)) {
    return {
      ok: false,
      matchedRuleId: 'builtin-workspace-boundary',
      reason: 'Target path contains null bytes or control characters.',
      failedClosed: false,
    };
  }

  if (targetPath.trim().length === 0) {
    return {
      ok: false,
      matchedRuleId: 'builtin-workspace-boundary',
      reason: 'Target path must not be empty.',
      failedClosed: false,
    };
  }

  if (WINDOWS_DRIVE_RELATIVE.test(targetPath)) {
    return {
      ok: false,
      matchedRuleId: 'builtin-workspace-boundary',
      reason: `Drive-relative path "${targetPath}" is not permitted.`,
      failedClosed: false,
    };
  }

  if (rawWorkspaceRoot === undefined || rawWorkspaceRoot.trim().length === 0) {
    return {
      ok: true,
      normalizedPosixPath: normalizeStandalonePath(targetPath),
      caseInsensitive: process.platform === 'win32' || isWindowsStylePath(targetPath),
    };
  }

  if (enforceContainment) {
    if (isDeviceNamespacePath(targetPath)) {
      return {
        ok: false,
        matchedRuleId: 'builtin-workspace-boundary',
        reason: `Device namespace path "${targetPath}" escapes workspaceRoot.`,
        failedClosed: false,
      };
    }

    if (isUncOrDevicePath(targetPath)) {
      const rootUnc = getUncShareRoot(rawWorkspaceRoot);
      const targetUnc = getUncShareRoot(targetPath);
      if (rootUnc === undefined || targetUnc === undefined || rootUnc !== targetUnc) {
        return {
          ok: false,
          matchedRuleId: 'builtin-workspace-boundary',
          reason: `UNC path "${targetPath}" escapes workspaceRoot "${rawWorkspaceRoot}".`,
          failedClosed: false,
        };
      }
    }

    const targetDrive = getWindowsDriveLetter(targetPath);
    if (targetDrive !== undefined) {
      const rootDrive = getWindowsDriveLetter(rawWorkspaceRoot);
      if (rootDrive === undefined || rootDrive !== targetDrive) {
        return {
          ok: false,
          matchedRuleId: 'builtin-workspace-boundary',
          reason: `Drive-prefixed path "${targetPath}" escapes workspaceRoot "${rawWorkspaceRoot}".`,
          failedClosed: false,
        };
      }
    }
  }

  const { pathImpl, caseInsensitive } = selectPathContext(rawWorkspaceRoot, targetPath);
  const resolvedRoot = pathImpl.resolve(rawWorkspaceRoot);
  const resolvedTarget = pathImpl.resolve(resolvedRoot, targetPath);
  const lexicallyContained = isContainedPath(
    resolvedRoot,
    resolvedTarget,
    pathImpl,
    caseInsensitive,
  );

  if (enforceContainment && !lexicallyContained) {
    return {
      ok: false,
      matchedRuleId: 'builtin-workspace-boundary',
      reason: `Target path "${targetPath}" escapes workspaceRoot "${rawWorkspaceRoot}".`,
      failedClosed: false,
    };
  }

  const realRoot = resolveDiskRoot(resolvedRoot, pathImpl);
  if (realRoot !== undefined) {
    if (lexicallyContained) {
      const dotDotResult = resolveWithDotDotSymlinkCheck(
        targetPath,
        resolvedRoot,
        realRoot,
        pathImpl,
        caseInsensitive,
      );
      if (dotDotResult !== undefined) {
        if (enforceContainment && dotDotResult.escapedRoot) {
          return {
            ok: false,
            matchedRuleId: 'builtin-workspace-boundary',
            reason: `Target path "${targetPath}" escapes workspaceRoot "${rawWorkspaceRoot}" via symlink.`,
            failedClosed: false,
          };
        }
        return {
          ok: true,
          normalizedPosixPath: toPosixRelative(realRoot, dotDotResult.resolvedPath, pathImpl),
          caseInsensitive,
        };
      }

      const diskResult = resolveTargetOnDisk(
        resolvedTarget,
        resolvedRoot,
        realRoot,
        pathImpl,
        caseInsensitive,
        new Set<string>(),
      );
      if (enforceContainment && diskResult.escapedRoot) {
        return {
          ok: false,
          matchedRuleId: 'builtin-workspace-boundary',
          reason: `Target path "${targetPath}" escapes workspaceRoot "${rawWorkspaceRoot}" via symlink.`,
          failedClosed: false,
        };
      }
      return {
        ok: true,
        normalizedPosixPath: toPosixRelative(realRoot, diskResult.resolvedPath, pathImpl),
        caseInsensitive,
      };
    }

    const externalTarget = resolveTargetOnDisk(
      resolvedTarget,
      resolvedRoot,
      realRoot,
      pathImpl,
      caseInsensitive,
      new Set<string>(),
    );
    return {
      ok: true,
      normalizedPosixPath: toPosixRelative(realRoot, externalTarget.resolvedPath, pathImpl),
      caseInsensitive,
    };
  }

  return {
    ok: true,
    normalizedPosixPath: toPosixRelative(resolvedRoot, resolvedTarget, pathImpl),
    caseInsensitive,
  };
}

function normalizeAllowlistSet(
  allowlistedPaths: readonly string[] | undefined,
  workspaceRoot: string | undefined,
  caseInsensitive: boolean,
): ReadonlySet<string> {
  const entries = new Set<string>();
  if (allowlistedPaths === undefined || allowlistedPaths.length === 0) {
    return entries;
  }

  for (const rawEntry of allowlistedPaths) {
    if (
      rawEntry.trim().length === 0 ||
      hasControlCharacter(rawEntry) ||
      WINDOWS_DRIVE_RELATIVE.test(rawEntry)
    ) {
      continue;
    }

    let normalized: string;
    if (
      workspaceRoot !== undefined &&
      workspaceRoot.trim().length > 0 &&
      !hasControlCharacter(workspaceRoot)
    ) {
      const { pathImpl } = selectPathContext(workspaceRoot, rawEntry);
      const resolvedRoot = pathImpl.resolve(workspaceRoot);
      const resolvedEntry = pathImpl.resolve(resolvedRoot, rawEntry);
      normalized = toPosixRelative(resolvedRoot, resolvedEntry, pathImpl);
    } else {
      normalized = normalizeStandalonePath(rawEntry);
    }

    entries.add(caseInsensitive ? normalized.toLowerCase() : normalized);
  }

  return entries;
}

function compileRules(
  rules: readonly PolicyRule[],
):
  | { readonly ok: true; readonly compiled: readonly CompiledRule[] }
  | { readonly ok: false; readonly decision: PolicyDecision } {
  const compiled: CompiledRule[] = [];

  for (const [index, rule] of rules.entries()) {
    const pathRegexes: RegExp[] = [];
    for (const pattern of rule.pathPatterns ?? []) {
      try {
        pathRegexes.push(new RegExp(pattern));
      } catch (error: unknown) {
        return {
          ok: false,
          decision: {
            effect: 'DENY',
            matchedRuleId: rule.id,
            reason: `Fail-closed: malformed pathPatterns regex "${pattern}" in rule "${rule.id}": ${formatErrorReason(error)}`,
            evaluatedRulesCount: index + 1,
            failedClosed: true,
          },
        };
      }
    }

    const commandRegexes: RegExp[] = [];
    for (const pattern of rule.commandPatterns ?? []) {
      try {
        commandRegexes.push(new RegExp(pattern));
      } catch (error: unknown) {
        return {
          ok: false,
          decision: {
            effect: 'DENY',
            matchedRuleId: rule.id,
            reason: `Fail-closed: malformed commandPatterns regex "${pattern}" in rule "${rule.id}": ${formatErrorReason(error)}`,
            evaluatedRulesCount: index + 1,
            failedClosed: true,
          },
        };
      }
    }

    compiled.push({
      rule,
      pathRegexes,
      commandRegexes,
    });
  }

  return { ok: true, compiled };
}

function isHigherPrecedence(candidate: PolicyRule, current: PolicyRule): boolean {
  const candidateRank = EFFECT_RANK[candidate.effect];
  const currentRank = EFFECT_RANK[current.effect];
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }

  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }

  return candidate.id < current.id;
}

function readEnumArray<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  required: boolean,
  issues: ValidationIssue[],
  basePointer: string,
): readonly T[] | undefined {
  const pointer = joinJsonPointer(basePointer, key);
  if (!Object.hasOwn(record, key)) {
    if (required) {
      issues.push({
        code: 'POLICY_RULE_MISSING_PROPERTY',
        path: pointer,
        message: `Missing required property "${key}".`,
      });
    }
    return undefined;
  }

  const raw = record[key];
  if (!Array.isArray(raw)) {
    issues.push({
      code: 'POLICY_RULE_INVALID_ARRAY',
      path: pointer,
      message: `Property "${key}" must be a non-empty array.`,
    });
    return undefined;
  }

  if (raw.length === 0) {
    issues.push({
      code: 'POLICY_RULE_EMPTY_ARRAY',
      path: pointer,
      message: `Property "${key}" must contain at least one item.`,
    });
    return undefined;
  }

  const result: T[] = [];
  let hasError = false;
  for (const [index, entry] of raw.entries()) {
    const match = typeof entry === 'string' ? allowedValues.find((v) => v === entry) : undefined;
    if (match === undefined) {
      issues.push({
        code: 'POLICY_RULE_INVALID_ENUM',
        path: `${pointer}/${String(index)}`,
        message: `Entry at "${key}[${String(index)}]" must be one of: ${allowedValues.join(', ')}.`,
      });
      hasError = true;
    } else {
      result.push(match);
    }
  }

  return hasError ? undefined : result;
}

function readOptionalPatternArray(
  record: Record<string, unknown>,
  key: 'pathPatterns' | 'commandPatterns',
  issues: ValidationIssue[],
  basePointer: string,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }

  const pointer = joinJsonPointer(basePointer, key);
  const raw = record[key];
  if (!Array.isArray(raw)) {
    issues.push({
      code: 'POLICY_RULE_INVALID_ARRAY',
      path: pointer,
      message: `Property "${key}" must be an array of valid regex strings.`,
    });
    return undefined;
  }

  if (raw.length === 0) {
    issues.push({
      code: 'POLICY_RULE_EMPTY_ARRAY',
      path: pointer,
      message: `Property "${key}" must not be empty when provided.`,
    });
    return undefined;
  }

  const patterns: string[] = [];
  let hasError = false;

  for (const [index, entry] of raw.entries()) {
    const itemPointer = `${pointer}/${String(index)}`;
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issues.push({
        code: 'POLICY_RULE_INVALID_STRING',
        path: itemPointer,
        message: `Pattern at "${key}[${String(index)}]" must be a non-empty string.`,
      });
      hasError = true;
      continue;
    }

    try {
      new RegExp(entry);
      patterns.push(entry);
    } catch (error: unknown) {
      issues.push({
        code: 'POLICY_INVALID_REGEX',
        path: itemPointer,
        message: `Invalid regular expression "${entry}" in "${key}[${String(index)}]": ${formatErrorReason(error)}`,
      });
      hasError = true;
    }
  }

  return hasError ? undefined : patterns;
}

/**
 * Loads and strictly validates a JSON policy file (`{ rules: PolicyRule[] }`),
 * rejecting unknown keys, invalid schemas, duplicate rule IDs, and uncompilable regexes.
 */
export function parsePolicyFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<readonly PolicyRule[]> {
  const fileResult = readSafePluginTextFile(pluginRoot, relativePath);
  if (!fileResult.ok) {
    return fileResult;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(fileResult.value.content)) as unknown;
  } catch (error: unknown) {
    return failValidation(
      'POLICY_INVALID_JSON',
      '/',
      `Invalid JSON in policy file: ${formatErrorReason(error)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    return failValidation(
      'POLICY_INVALID_SCHEMA',
      '/',
      'Policy file must contain a JSON object with a "rules" array.',
    );
  }

  const issues: ValidationIssue[] = [];
  collectUnknownKeyIssues(parsed, ALLOWED_TOP_LEVEL_KEYS, 'POLICY_ADDITIONAL_PROPERTY', issues);

  if (!Object.hasOwn(parsed, 'rules')) {
    issues.push({
      code: 'POLICY_MISSING_PROPERTY',
      path: '/rules',
      message: 'Missing required property "rules".',
    });
    return { ok: false, issues };
  }

  const rawRules = parsed.rules;
  if (!Array.isArray(rawRules)) {
    issues.push({
      code: 'POLICY_INVALID_ARRAY',
      path: '/rules',
      message: 'Property "rules" must be an array of policy rule objects.',
    });
    return { ok: false, issues };
  }

  const rules: PolicyRule[] = [];
  const seenIds = new Set<string>();

  for (const [index, rawEntry] of rawRules.entries()) {
    const itemPointer = `/rules/${String(index)}`;
    if (!isPlainObject(rawEntry)) {
      issues.push({
        code: 'POLICY_RULE_INVALID_OBJECT',
        path: itemPointer,
        message: `Policy rule at "${itemPointer}" must be an object.`,
      });
      continue;
    }

    collectUnknownKeyIssues(
      rawEntry,
      ALLOWED_RULE_KEYS,
      'POLICY_RULE_ADDITIONAL_PROPERTY',
      issues,
      itemPointer,
    );

    const id = readRequiredNonEmptyString(rawEntry, 'id', issues, 'POLICY_RULE', itemPointer);
    const description = readRequiredNonEmptyString(
      rawEntry,
      'description',
      issues,
      'POLICY_RULE',
      itemPointer,
    );
    const priority = readRequiredInteger(
      rawEntry,
      'priority',
      {},
      issues,
      'POLICY_RULE',
      itemPointer,
    );
    const effect = readRequiredEnum(
      rawEntry,
      'effect',
      POLICY_EFFECTS,
      issues,
      'POLICY_RULE',
      itemPointer,
    );
    const actions = readEnumArray(rawEntry, 'actions', POLICY_ACTIONS, true, issues, itemPointer);
    const pathPatterns = readOptionalPatternArray(rawEntry, 'pathPatterns', issues, itemPointer);
    const commandPatterns = readOptionalPatternArray(
      rawEntry,
      'commandPatterns',
      issues,
      itemPointer,
    );
    const actorTypes = readEnumArray(
      rawEntry,
      'actorTypes',
      POLICY_ACTOR_TYPES,
      false,
      issues,
      itemPointer,
    );

    let critical: boolean | undefined;
    if (Object.hasOwn(rawEntry, 'critical')) {
      const rawCritical = rawEntry.critical;
      if (typeof rawCritical !== 'boolean') {
        issues.push({
          code: 'POLICY_RULE_INVALID_BOOLEAN',
          path: joinJsonPointer(itemPointer, 'critical'),
          message: 'Optional property "critical" must be a boolean.',
        });
      } else {
        critical = rawCritical;
      }
    }

    if (id !== undefined) {
      if (seenIds.has(id)) {
        issues.push({
          code: 'POLICY_DUPLICATE_ID',
          path: `${itemPointer}/id`,
          message: `Duplicate policy rule id "${id}".`,
        });
      } else {
        seenIds.add(id);
      }
    }

    if (
      id !== undefined &&
      description !== undefined &&
      priority !== undefined &&
      effect !== undefined &&
      actions !== undefined
    ) {
      rules.push({
        id,
        description,
        priority,
        effect,
        actions,
        ...(pathPatterns !== undefined ? { pathPatterns } : {}),
        ...(commandPatterns !== undefined ? { commandPatterns } : {}),
        ...(actorTypes !== undefined ? { actorTypes } : {}),
        ...(critical !== undefined ? { critical } : {}),
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: rules };
}

/**
 * Deterministically evaluates a `PolicyRequest` against `DEFAULT_SECURITY_POLICIES`
 * plus optional `extraRules`. Always fails closed (`DENY`, `failedClosed: true`) on
 * malformed regexes, missing workspace roots for write/delete checks, or internal errors.
 */
export function evaluatePolicy(
  request: PolicyRequest,
  extraRules?: readonly PolicyRule[],
): PolicyDecision {
  let allRules: readonly PolicyRule[] = DEFAULT_SECURITY_POLICIES;

  try {
    const rawExtraRules: unknown = extraRules;
    if (rawExtraRules !== undefined) {
      if (!Array.isArray(rawExtraRules)) {
        return {
          effect: 'DENY',
          matchedRuleId: 'builtin-policy-evaluation-error',
          reason: 'Fail-closed: extraRules must be an array.',
          evaluatedRulesCount: allRules.length,
          failedClosed: true,
        };
      }
      if (rawExtraRules.length > 0) {
        allRules = [...DEFAULT_SECURITY_POLICIES, ...(rawExtraRules as readonly PolicyRule[])];
      }
    }

    if (
      !POLICY_ACTIONS.includes(request.action) ||
      !POLICY_ACTOR_TYPES.includes(request.actorType)
    ) {
      return {
        effect: 'DENY',
        matchedRuleId: 'builtin-policy-evaluation-error',
        reason: 'Fail-closed: invalid policy request action or actorType.',
        evaluatedRulesCount: allRules.length,
        failedClosed: true,
      };
    }

    if (
      request.action === 'fs:read' ||
      request.action === 'fs:write' ||
      request.action === 'fs:delete'
    ) {
      const rawTargetPath: unknown = request.targetPath;
      if (typeof rawTargetPath !== 'string' || rawTargetPath.trim().length === 0) {
        return {
          effect: 'DENY',
          matchedRuleId: 'builtin-policy-evaluation-error',
          reason: `Fail-closed: "${request.action}" requires a non-empty targetPath.`,
          evaluatedRulesCount: allRules.length,
          failedClosed: true,
        };
      }
    }

    if (request.action === 'cmd:exec') {
      const rawCommand: unknown = request.command;
      if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
        return {
          effect: 'DENY',
          matchedRuleId: 'builtin-policy-evaluation-error',
          reason: 'Fail-closed: "cmd:exec" requires a non-empty command.',
          evaluatedRulesCount: allRules.length,
          failedClosed: true,
        };
      }
    }

    const compiledResult = compileRules(allRules);
    if (!compiledResult.ok) {
      return compiledResult.decision;
    }

    const enforceContainment = request.action === 'fs:write' || request.action === 'fs:delete';
    const targetResolution = resolveTargetPath(request, enforceContainment);
    if (!targetResolution.ok) {
      return {
        effect: 'DENY',
        matchedRuleId: targetResolution.matchedRuleId,
        reason: targetResolution.reason,
        evaluatedRulesCount: allRules.length,
        failedClosed: targetResolution.failedClosed,
      };
    }

    const hasTargetPath = request.targetPath !== undefined;
    const normalizedPath = hasTargetPath ? targetResolution.normalizedPosixPath : undefined;
    const allowlistedSet = normalizeAllowlistSet(
      request.allowlistedPaths,
      request.workspaceRoot,
      targetResolution.caseInsensitive,
    );
    const allowlistLookupKey =
      normalizedPath !== undefined
        ? targetResolution.caseInsensitive
          ? normalizedPath.toLowerCase()
          : normalizedPath
        : undefined;
    const isTargetAllowlisted =
      allowlistLookupKey !== undefined && allowlistedSet.has(allowlistLookupKey);

    let winningRule: PolicyRule | undefined;

    for (const { rule, pathRegexes, commandRegexes } of compiledResult.compiled) {
      if (!rule.actions.includes(request.action)) {
        continue;
      }

      if (rule.actorTypes !== undefined && !rule.actorTypes.includes(request.actorType)) {
        continue;
      }

      if (rule.pathPatterns !== undefined) {
        if (normalizedPath === undefined || !pathRegexes.some((re) => re.test(normalizedPath))) {
          continue;
        }
      }

      if (rule.commandPatterns !== undefined) {
        const command = request.command;
        if (command === undefined || !commandRegexes.some((re) => re.test(command))) {
          continue;
        }
      }

      const canBypassWithAllowlist =
        isTargetAllowlisted &&
        rule.critical !== true &&
        rule.effect !== 'ALLOW' &&
        rule.pathPatterns !== undefined &&
        rule.pathPatterns.length > 0 &&
        (rule.commandPatterns === undefined || rule.commandPatterns.length === 0);

      if (canBypassWithAllowlist) {
        continue;
      }

      if (winningRule === undefined || isHigherPrecedence(rule, winningRule)) {
        winningRule = rule;
      }
    }

    if (winningRule === undefined) {
      return {
        effect: 'ALLOW',
        matchedRuleId: 'default-allow',
        reason: 'No restricting policy matched',
        evaluatedRulesCount: allRules.length,
        failedClosed: false,
      };
    }

    return {
      effect: winningRule.effect,
      matchedRuleId: winningRule.id,
      reason: winningRule.description,
      evaluatedRulesCount: allRules.length,
      failedClosed: false,
    };
  } catch (error: unknown) {
    return {
      effect: 'DENY',
      matchedRuleId: 'builtin-policy-evaluation-error',
      reason: `Fail-closed: unexpected policy evaluation error: ${formatErrorReason(error)}`,
      evaluatedRulesCount: allRules.length,
      failedClosed: true,
    };
  }
}
