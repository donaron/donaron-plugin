import { type Stats, lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { ValidationResult } from '../types.js';

export interface SafePathOptions {
  readonly mustExist?: boolean;
}

export interface ResolvedSafePath {
  readonly absolutePath: string;
  readonly relativePosixPath: string;
}

interface AncestorResolution {
  readonly resolvedPath: string;
  readonly existed: boolean;
}

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;
const MAX_BROKEN_SYMLINK_DEPTH = 32;

function fail<T>(code: string, path: string, message: string): ValidationResult<T> {
  return {
    ok: false,
    issues: [{ code, path, message }],
  };
}

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

function formatErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeForContainment(targetPath: string): string {
  const resolved = resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(normalizedRoot: string, candidatePath: string): boolean {
  const normalizedCandidate = normalizeForContainment(candidatePath);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedCandidate.startsWith(rootPrefix);
}

function validateAndNormalizeSegments(relativePath: string): ValidationResult<readonly string[]> {
  if (relativePath.trim().length === 0) {
    return fail(
      'INVALID_RELATIVE_PATH',
      relativePath,
      'Plugin relative path must not be empty or whitespace-only.',
    );
  }

  if (hasControlCharacter(relativePath)) {
    return fail(
      'INVALID_RELATIVE_PATH',
      relativePath,
      'Plugin relative path must not contain null bytes or control characters.',
    );
  }

  if (relativePath.startsWith('\\\\') || relativePath.startsWith('//')) {
    return fail('UNSAFE_PATH', relativePath, 'UNC paths are not allowed as plugin relative paths.');
  }

  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    return fail(
      'UNSAFE_PATH',
      relativePath,
      'Absolute paths are not allowed as plugin relative paths.',
    );
  }

  if (WINDOWS_DRIVE_PREFIX.test(relativePath)) {
    return fail(
      'UNSAFE_PATH',
      relativePath,
      'Windows drive-prefixed or drive-relative paths are not allowed.',
    );
  }

  if (relativePath.includes(':')) {
    return fail('UNSAFE_PATH', relativePath, 'Colons are not allowed in plugin relative paths.');
  }

  const rawSegments = relativePath.split(/[/\\]/);
  if (rawSegments.some((segment) => segment === '..')) {
    return fail(
      'PATH_TRAVERSAL',
      relativePath,
      'Path traversal segments ("..") are not allowed in plugin relative paths.',
    );
  }

  const normalizedSegments = rawSegments.filter((segment) => segment.length > 0 && segment !== '.');
  return { ok: true, value: normalizedSegments };
}

function resolveVerifiedRoot(pluginRoot: string): ValidationResult<string> {
  if (pluginRoot.trim().length === 0) {
    return fail('ROOT_NOT_FOUND', pluginRoot, 'Plugin root path must not be empty.');
  }

  let realRoot: string;
  try {
    realRoot = resolve(realpathSync(pluginRoot));
  } catch (error: unknown) {
    return fail(
      'ROOT_NOT_FOUND',
      pluginRoot,
      `Plugin root directory does not exist or cannot be resolved: ${formatErrorReason(error)}`,
    );
  }

  try {
    if (!statSync(realRoot).isDirectory()) {
      return fail(
        'ROOT_NOT_DIRECTORY',
        pluginRoot,
        `Plugin root path is not a directory: "${pluginRoot}".`,
      );
    }
  } catch (error: unknown) {
    return fail(
      'ROOT_NOT_FOUND',
      pluginRoot,
      `Unable to inspect plugin root directory: ${formatErrorReason(error)}`,
    );
  }

  return { ok: true, value: realRoot };
}

function parseBrokenSymlinkTarget(
  rawTarget: string,
  realParent: string,
  originalRelativePath: string,
): ValidationResult<{ readonly startCursor: string; readonly segments: readonly string[] }> {
  if (rawTarget.trim().length === 0 || hasControlCharacter(rawTarget)) {
    return fail(
      'SYMLINK_ESCAPE',
      originalRelativePath,
      `Symlink target for "${originalRelativePath}" is empty or contains control characters.`,
    );
  }

  if (process.platform === 'win32') {
    if (/^[a-zA-Z]:(?![/\\])/.test(rawTarget)) {
      return fail(
        'SYMLINK_ESCAPE',
        originalRelativePath,
        `Drive-relative symlink target "${rawTarget}" is not allowed.`,
      );
    }

    if (isAbsolute(rawTarget)) {
      const startCursor = parse(resolve(realParent, rawTarget)).root;
      const isUncOrDevice = rawTarget.startsWith('\\\\') || rawTarget.startsWith('//');
      const rawWithoutRoot = isUncOrDevice
        ? rawTarget.replace(/^[/\\]{2}[^/\\]+[/\\][^/\\]+[/\\]?/, '')
        : rawTarget.replace(/^(?:[a-zA-Z]:[/\\]+|[/\\]+)/, '');
      return {
        ok: true,
        value: {
          startCursor,
          segments: rawWithoutRoot.split(/[/\\]/),
        },
      };
    }

    return {
      ok: true,
      value: {
        startCursor: realParent,
        segments: rawTarget.split(/[/\\]/),
      },
    };
  }

  if (rawTarget.startsWith('/')) {
    return {
      ok: true,
      value: {
        startCursor: '/',
        segments: rawTarget.replace(/^\/+/, '').split('/'),
      },
    };
  }

  return {
    ok: true,
    value: {
      startCursor: realParent,
      segments: rawTarget.split('/'),
    },
  };
}

function resolveBrokenTargetSegments(
  rawTarget: string,
  realParent: string,
  realRoot: string,
  normalizedRoot: string,
  originalRelativePath: string,
  visited: Set<string>,
  depth: number,
): ValidationResult<string> {
  const parsed = parseBrokenSymlinkTarget(rawTarget, realParent, originalRelativePath);
  if (!parsed.ok) {
    return parsed;
  }

  let cursor = parsed.value.startCursor;
  let hasEnteredRoot = isPathWithinRoot(normalizedRoot, cursor);

  for (const segment of parsed.value.segments) {
    if (segment === '' || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (!isPathWithinRoot(normalizedRoot, cursor)) {
        return fail(
          'SYMLINK_ESCAPE',
          originalRelativePath,
          `Symlink target "${rawTarget}" escapes plugin root "${realRoot}".`,
        );
      }
      const parent = dirname(cursor);
      if (parent === cursor || !isPathWithinRoot(normalizedRoot, parent)) {
        return fail(
          'SYMLINK_ESCAPE',
          originalRelativePath,
          `Symlink target "${rawTarget}" escapes plugin root "${realRoot}".`,
        );
      }
      cursor = parent;
      continue;
    }

    cursor = join(cursor, segment);
    if (isPathWithinRoot(normalizedRoot, cursor)) {
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
      return fail(
        'PATH_RESOLUTION_ERROR',
        originalRelativePath,
        `Failed to inspect symlink target "${originalRelativePath}": ${formatErrorReason(error)}`,
      );
    }

    if (!stats.isSymbolicLink()) {
      continue;
    }

    try {
      const realCursor = resolve(realpathSync(cursor));
      const inRoot = isPathWithinRoot(normalizedRoot, realCursor);
      const isAncestorOfRoot =
        !hasEnteredRoot && isPathWithinRoot(normalizeForContainment(realCursor), realRoot);
      if (!inRoot && !isAncestorOfRoot) {
        return fail(
          'SYMLINK_ESCAPE',
          originalRelativePath,
          `Symlink target "${rawTarget}" escapes plugin root "${realRoot}".`,
        );
      }
      cursor = realCursor;
      if (inRoot) {
        hasEnteredRoot = true;
      }
    } catch (error: unknown) {
      const code = getErrnoCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        const nestedBroken = verifyBrokenSymlinkTarget(
          cursor,
          realRoot,
          normalizedRoot,
          originalRelativePath,
          visited,
          depth + 1,
        );
        if (!nestedBroken.ok) {
          return nestedBroken;
        }
        cursor = nestedBroken.value.resolvedPath;
        if (isPathWithinRoot(normalizedRoot, cursor)) {
          hasEnteredRoot = true;
        }
      } else if (code === 'ELOOP') {
        return fail(
          'SYMLINK_ESCAPE',
          originalRelativePath,
          `Symlink loop encountered while resolving "${originalRelativePath}".`,
        );
      } else {
        return fail(
          'PATH_RESOLUTION_ERROR',
          originalRelativePath,
          `Failed to resolve symlink target "${originalRelativePath}": ${formatErrorReason(error)}`,
        );
      }
    }
  }

  if (!isPathWithinRoot(normalizedRoot, cursor)) {
    return fail(
      'SYMLINK_ESCAPE',
      originalRelativePath,
      `Symlink target "${cursor}" escapes plugin root "${realRoot}".`,
    );
  }

  return { ok: true, value: cursor };
}

function verifyBrokenSymlinkTarget(
  symlinkPath: string,
  realRoot: string,
  normalizedRoot: string,
  originalRelativePath: string,
  visited: Set<string>,
  depth = 0,
): ValidationResult<AncestorResolution> {
  let realParent: string;
  try {
    realParent = resolve(realpathSync(dirname(symlinkPath)));
  } catch (error: unknown) {
    const code = getErrnoCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
      return fail(
        'SYMLINK_ESCAPE',
        originalRelativePath,
        `Unable to resolve symlink parent for "${originalRelativePath}": ${formatErrorReason(error)}`,
      );
    }
    return fail(
      'PATH_RESOLUTION_ERROR',
      originalRelativePath,
      `Failed to resolve symlink parent for "${originalRelativePath}": ${formatErrorReason(error)}`,
    );
  }

  if (!isPathWithinRoot(normalizedRoot, realParent)) {
    return fail(
      'SYMLINK_ESCAPE',
      originalRelativePath,
      `Symlink parent "${realParent}" escapes plugin root "${realRoot}".`,
    );
  }

  const canonicalLinkPath = resolve(realParent, basename(symlinkPath));
  const normalizedLink = normalizeForContainment(canonicalLinkPath);
  if (visited.has(normalizedLink) || depth >= MAX_BROKEN_SYMLINK_DEPTH) {
    return fail(
      'SYMLINK_ESCAPE',
      originalRelativePath,
      `Detected symlink loop or excessive symlink depth at "${originalRelativePath}".`,
    );
  }
  visited.add(normalizedLink);

  try {
    let rawTarget: string;
    try {
      rawTarget = readlinkSync(canonicalLinkPath);
    } catch (error: unknown) {
      return fail(
        'SYMLINK_ESCAPE',
        originalRelativePath,
        `Unable to read symlink target for "${originalRelativePath}": ${formatErrorReason(error)}`,
      );
    }

    const resolvedTargetResult = resolveBrokenTargetSegments(
      rawTarget,
      realParent,
      realRoot,
      normalizedRoot,
      originalRelativePath,
      visited,
      depth,
    );
    if (!resolvedTargetResult.ok) {
      return resolvedTargetResult;
    }

    const targetResult = resolveExistingOrAncestor(
      resolvedTargetResult.value,
      realRoot,
      normalizedRoot,
      originalRelativePath,
      visited,
      depth + 1,
    );
    if (!targetResult.ok) {
      return targetResult;
    }

    return {
      ok: true,
      value: {
        resolvedPath: targetResult.value.resolvedPath,
        existed: false,
      },
    };
  } finally {
    visited.delete(normalizedLink);
  }
}

function resolveExistingOrAncestor(
  targetPath: string,
  realRoot: string,
  normalizedRoot: string,
  originalRelativePath: string,
  visited: Set<string>,
  depth = 0,
): ValidationResult<AncestorResolution> {
  const trailingSegments: string[] = [];
  let current = targetPath;

  while (isPathWithinRoot(normalizedRoot, current)) {
    let lstatSucceeded = false;
    try {
      lstatSync(current);
      lstatSucceeded = true;
    } catch (error: unknown) {
      const code = getErrnoCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return fail(
          'PATH_RESOLUTION_ERROR',
          originalRelativePath,
          `Failed to inspect path "${originalRelativePath}": ${formatErrorReason(error)}`,
        );
      }
    }

    if (lstatSucceeded) {
      try {
        const realCurrent = resolve(realpathSync(current));
        if (!isPathWithinRoot(normalizedRoot, realCurrent)) {
          return fail(
            'SYMLINK_ESCAPE',
            originalRelativePath,
            `Resolved path "${realCurrent}" escapes plugin root "${realRoot}".`,
          );
        }

        const resolvedPath =
          trailingSegments.length === 0
            ? realCurrent
            : resolve(realCurrent, ...trailingSegments.reverse());
        return {
          ok: true,
          value: {
            resolvedPath,
            existed: trailingSegments.length === 0,
          },
        };
      } catch (error: unknown) {
        const code = getErrnoCode(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          const brokenResult = verifyBrokenSymlinkTarget(
            current,
            realRoot,
            normalizedRoot,
            originalRelativePath,
            visited,
            depth,
          );
          if (!brokenResult.ok) {
            return brokenResult;
          }

          const resolvedPath =
            trailingSegments.length === 0
              ? brokenResult.value.resolvedPath
              : resolve(brokenResult.value.resolvedPath, ...trailingSegments.reverse());
          return {
            ok: true,
            value: {
              resolvedPath,
              existed: false,
            },
          };
        }

        if (code === 'ELOOP') {
          return fail(
            'SYMLINK_ESCAPE',
            originalRelativePath,
            `Symlink loop encountered while resolving "${originalRelativePath}".`,
          );
        }

        return fail(
          'PATH_RESOLUTION_ERROR',
          originalRelativePath,
          `Failed to resolve path "${originalRelativePath}": ${formatErrorReason(error)}`,
        );
      }
    }

    if (normalizeForContainment(current) === normalizedRoot) {
      break;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    trailingSegments.push(basename(current));
    current = parent;
  }

  return fail(
    'PATH_TRAVERSAL',
    originalRelativePath,
    `Path "${originalRelativePath}" could not be contained within plugin root "${realRoot}".`,
  );
}

/**
 * Resolves a plugin-relative path safely within `pluginRoot`, preventing lexical
 * traversal, Windows drive/UNC escapes, and symlink/junction escapes for both
 * existing and non-existent target paths.
 */
export function resolveSafePluginPath(
  pluginRoot: string,
  relativePath: string,
  options?: SafePathOptions,
): ValidationResult<ResolvedSafePath> {
  const segmentsResult = validateAndNormalizeSegments(relativePath);
  if (!segmentsResult.ok) {
    return segmentsResult;
  }

  const rootResult = resolveVerifiedRoot(pluginRoot);
  if (!rootResult.ok) {
    return rootResult;
  }

  const realRoot = rootResult.value;
  const normalizedRoot = normalizeForContainment(realRoot);
  const candidate =
    segmentsResult.value.length === 0 ? realRoot : resolve(realRoot, ...segmentsResult.value);

  if (!isPathWithinRoot(normalizedRoot, candidate)) {
    return fail(
      'PATH_TRAVERSAL',
      relativePath,
      `Path "${relativePath}" escapes plugin root "${realRoot}".`,
    );
  }

  const ancestorResult = resolveExistingOrAncestor(
    candidate,
    realRoot,
    normalizedRoot,
    relativePath,
    new Set<string>(),
  );
  if (!ancestorResult.ok) {
    return ancestorResult;
  }

  const mustExist = options?.mustExist ?? false;
  if (mustExist && !ancestorResult.value.existed) {
    return fail('PATH_NOT_FOUND', relativePath, `Plugin path does not exist: "${relativePath}".`);
  }

  const resolvedAbsolutePath = ancestorResult.value.resolvedPath;
  if (!isPathWithinRoot(normalizedRoot, resolvedAbsolutePath)) {
    return fail(
      'SYMLINK_ESCAPE',
      relativePath,
      `Resolved path "${resolvedAbsolutePath}" escapes plugin root "${realRoot}".`,
    );
  }

  const rel = relative(realRoot, resolvedAbsolutePath);
  if (rel === '') {
    return {
      ok: true,
      value: {
        absolutePath: resolvedAbsolutePath,
        relativePosixPath: '.',
      },
    };
  }

  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    return fail(
      'PATH_TRAVERSAL',
      relativePath,
      `Resolved path "${resolvedAbsolutePath}" escaped plugin root "${realRoot}".`,
    );
  }

  return {
    ok: true,
    value: {
      absolutePath: resolvedAbsolutePath,
      relativePosixPath: rel.split(sep).join('/'),
    },
  };
}
