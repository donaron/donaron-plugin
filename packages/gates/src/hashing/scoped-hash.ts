import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSafePluginPath, type ValidationIssue, type ValidationResult } from '@donaron/core';
import type { WorkspaceHashes } from '../types.js';

export interface CodeHashOptions {
  readonly planFiles?: readonly string[];
  readonly extraExcludeDirs?: readonly string[];
}

const DEFAULT_EXCLUDED_DIRS = new Set(['.git', '.donaron', 'node_modules', 'dist', 'coverage']);

function resolveWorkspaceDir(workspaceRoot: string): ValidationResult<string> {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: 'WORKSPACE_NOT_FOUND',
          path: 'workspaceRoot',
          message: 'Workspace root must be a non-empty directory path.',
        },
      ],
    };
  }
  try {
    const realRoot = realpathSync(workspaceRoot);
    if (!statSync(realRoot).isDirectory()) {
      return {
        ok: false,
        issues: [
          {
            code: 'WORKSPACE_NOT_DIRECTORY',
            path: 'workspaceRoot',
            message: 'Workspace root must be a directory.',
          },
        ],
      };
    }
    return { ok: true, value: realRoot };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'WORKSPACE_NOT_FOUND',
          path: 'workspaceRoot',
          message: `Workspace directory does not exist: ${workspaceRoot}`,
        },
      ],
    };
  }
}

export function computePlanHash(
  workspaceRoot: string,
  planFiles: readonly string[],
): ValidationResult<string> {
  const rootResult = resolveWorkspaceDir(workspaceRoot);
  if (!rootResult.ok) {
    return rootResult;
  }

  if (planFiles.length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: 'EMPTY_PLAN_FILES',
          path: 'planFiles',
          message: 'At least one planning artifact file is required to compute planHash.',
        },
      ],
    };
  }

  const realRoot = rootResult.value;
  const issues: ValidationIssue[] = [];
  const entries = new Map<string, string>();

  for (const [idx, relFile] of planFiles.entries()) {
    const resolved = resolveSafePluginPath(realRoot, relFile, { mustExist: true });
    if (!resolved.ok) {
      for (const issue of resolved.issues) {
        issues.push({
          code: issue.code,
          path: `planFiles/${String(idx)}`,
          message: issue.message,
        });
      }
      continue;
    }

    try {
      const st = statSync(resolved.value.absolutePath);
      if (!st.isFile()) {
        issues.push({
          code: 'PLAN_NOT_A_FILE',
          path: `planFiles/${String(idx)}`,
          message: `Planning path is not a regular file: ${resolved.value.relativePosixPath}`,
        });
        continue;
      }
      const rawText = readFileSync(resolved.value.absolutePath, 'utf8');
      const normalizedText = rawText.replaceAll('\r\n', '\n');
      if (normalizedText.trim().length === 0) {
        issues.push({
          code: 'EMPTY_PLAN_FILE',
          path: `planFiles/${String(idx)}`,
          message: `Planning file is empty: ${resolved.value.relativePosixPath}`,
        });
        continue;
      }
      entries.set(resolved.value.relativePosixPath, normalizedText);
    } catch {
      issues.push({
        code: 'PLAN_READ_ERROR',
        path: `planFiles/${String(idx)}`,
        message: `Failed to read planning file: ${resolved.value.relativePosixPath}`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const sortedPaths = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256');
  for (const posixPath of sortedPaths) {
    const content = entries.get(posixPath) ?? '';
    const byteLen = Buffer.byteLength(content, 'utf8');
    hash.update(posixPath, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(String(byteLen), 'utf8');
    hash.update('\0', 'utf8');
    hash.update(content, 'utf8');
  }

  return { ok: true, value: `sha256:${hash.digest('hex')}` };
}

function resolveGitHead(realRoot: string): string {
  try {
    const proc = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: realRoot,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (proc.status === 0 && typeof proc.stdout === 'string') {
      const candidate = proc.stdout.trim();
      if (/^[0-9a-f]{40}$/i.test(candidate)) {
        return candidate.toLowerCase();
      }
    }
  } catch {
    // ignore and fall back to no-git-head
  }
  return 'no-git-head';
}

export function computeCodeHash(
  workspaceRoot: string,
  options?: CodeHashOptions,
): ValidationResult<{ readonly codeHash: string; readonly gitHead: string }> {
  const rootResult = resolveWorkspaceDir(workspaceRoot);
  if (!rootResult.ok) {
    return rootResult;
  }
  const realRoot = rootResult.value;

  const excludedPlanPaths = new Set<string>();
  for (const planFile of options?.planFiles ?? []) {
    const resolved = resolveSafePluginPath(realRoot, planFile, { mustExist: false });
    if (resolved.ok) {
      excludedPlanPaths.add(resolved.value.relativePosixPath);
    }
  }

  const excludedDirs = new Set(DEFAULT_EXCLUDED_DIRS);
  for (const extra of options?.extraExcludeDirs ?? []) {
    const trimmed = extra.trim().replace(/^[/\\]+|[/\\]+$/g, '');
    if (trimmed.length > 0) {
      excludedDirs.add(trimmed);
    }
  }

  const collectedFiles: { readonly relativePosixPath: string; readonly absolutePath: string }[] =
    [];

  function walk(currentAbsDir: string, currentRelPosix: string): void {
    const names = readdirSync(currentAbsDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const childAbs = join(currentAbsDir, name);
      const childRelPosix = currentRelPosix.length > 0 ? `${currentRelPosix}/${name}` : name;

      let lstat;
      try {
        lstat = lstatSync(childAbs);
      } catch {
        continue;
      }

      if (lstat.isSymbolicLink()) {
        continue;
      }

      if (lstat.isDirectory()) {
        if (excludedDirs.has(name) || excludedDirs.has(childRelPosix)) {
          continue;
        }
        walk(childAbs, childRelPosix);
        continue;
      }

      if (!lstat.isFile()) {
        continue;
      }

      if (name.endsWith('.tsbuildinfo') || excludedPlanPaths.has(childRelPosix)) {
        continue;
      }

      collectedFiles.push({ relativePosixPath: childRelPosix, absolutePath: childAbs });
    }
  }

  try {
    walk(realRoot, '');
  } catch (error: unknown) {
    return {
      ok: false,
      issues: [
        {
          code: 'CODE_HASH_WALK_ERROR',
          path: 'workspaceRoot',
          message: `Failed to walk workspace for codeHash: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  collectedFiles.sort((a, b) =>
    a.relativePosixPath < b.relativePosixPath
      ? -1
      : a.relativePosixPath > b.relativePosixPath
        ? 1
        : 0,
  );

  const gitHead = resolveGitHead(realRoot);
  const hash = createHash('sha256');
  hash.update(gitHead, 'utf8');
  hash.update('\0', 'utf8');

  for (const file of collectedFiles) {
    const bytes = readFileSync(file.absolutePath);
    hash.update(file.relativePosixPath, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(String(bytes.byteLength), 'utf8');
    hash.update('\0', 'utf8');
    hash.update(bytes);
  }

  return {
    ok: true,
    value: {
      codeHash: `sha256:${hash.digest('hex')}`,
      gitHead,
    },
  };
}

export function computeWorkspaceHashes(
  workspaceRoot: string,
  planFiles: readonly string[],
  options?: CodeHashOptions,
): ValidationResult<WorkspaceHashes> {
  const planResult = computePlanHash(workspaceRoot, planFiles);
  const codeResult = computeCodeHash(workspaceRoot, { ...options, planFiles });

  if (!planResult.ok || !codeResult.ok) {
    return {
      ok: false,
      issues: [
        ...(planResult.ok ? [] : planResult.issues),
        ...(codeResult.ok ? [] : codeResult.issues),
      ],
    };
  }

  return {
    ok: true,
    value: {
      planHash: planResult.value,
      codeHash: codeResult.value.codeHash,
      gitHead: codeResult.value.gitHead,
    },
  };
}
