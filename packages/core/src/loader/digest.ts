import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolveSafePluginPath } from './safe-path.js';

function formatSafePathFailure(
  relativePath: string,
  issues: readonly { readonly code: string; readonly message: string }[],
): string {
  const summary = issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
  return `Cannot compute plugin digest for "${relativePath}": ${summary}`;
}

/**
 * Computes a deterministic `sha256:<64-hex>` digest over a set of plugin-relative
 * files after validating containment and existence, deduplicating normalized POSIX
 * paths, and sorting lexicographically by POSIX path.
 */
export function computePluginDigest(pluginRoot: string, relativePaths: readonly string[]): string {
  if (relativePaths.length === 0) {
    const rootCheck = resolveSafePluginPath(pluginRoot, '.', { mustExist: true });
    if (!rootCheck.ok) {
      throw new Error(formatSafePathFailure('.', rootCheck.issues));
    }
  }

  const resolvedFiles = new Map<string, string>();

  for (const relativePath of relativePaths) {
    const resolved = resolveSafePluginPath(pluginRoot, relativePath, { mustExist: true });
    if (!resolved.ok) {
      throw new Error(formatSafePathFailure(relativePath, resolved.issues));
    }

    const { absolutePath, relativePosixPath } = resolved.value;
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      throw new Error(
        `Cannot compute plugin digest for "${relativePath}": resolved path "${relativePosixPath}" is not a regular file.`,
      );
    }

    resolvedFiles.set(relativePosixPath, absolutePath);
  }

  const sortedEntries = [...resolvedFiles.entries()].sort(([pathA], [pathB]) =>
    pathA < pathB ? -1 : pathA > pathB ? 1 : 0,
  );

  const hash = createHash('sha256');
  for (const [relativePosixPath, absolutePath] of sortedEntries) {
    const content = readFileSync(absolutePath);
    hash.update(relativePosixPath, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(String(content.byteLength), 'utf8');
    hash.update('\0', 'utf8');
    hash.update(content);
  }

  return `sha256:${hash.digest('hex')}`;
}
