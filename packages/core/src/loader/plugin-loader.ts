import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { satisfies, valid, validRange } from 'semver';
import { isCompatibleWithCoreVersion, validateManifest } from '../manifest/validator.js';
import { type ParsedAgent, parseAgentFile } from '../parsers/agent-parser.js';
import { stripUtf8Bom } from '../parsers/frontmatter.js';
import { type HookBinding, parseHooksFile } from '../parsers/hook-parser.js';
import { type ParsedRule, parseRuleFile } from '../parsers/rule-parser.js';
import { formatErrorReason, joinJsonPointer } from '../parsers/shared.js';
import { type ParsedSkill, parseSkillFile } from '../parsers/skill-parser.js';
import type { DonAronManifest, ValidationIssue, ValidationResult } from '../types.js';
import { computePluginDigest } from './digest.js';
import { resolveSafePluginPath } from './safe-path.js';

export interface LoadedPlugin {
  readonly rootDir: string;
  readonly manifest: DonAronManifest;
  readonly digest: string;
  readonly skills: readonly ParsedSkill[];
  readonly agents: readonly ParsedAgent[];
  readonly rules: readonly ParsedRule[];
  readonly hooks: readonly HookBinding[];
  readonly toolConfigPaths: readonly string[];
  readonly policyPaths: readonly string[];
}

export interface DiscoveryEntry {
  readonly dir: string;
  readonly manifestPath: string;
}

export interface LoadPluginOptions {
  readonly coreVersion?: string;
}

function fail<T>(code: string, path: string, message: string): ValidationResult<T> {
  return {
    ok: false,
    issues: [{ code, path, message }],
  };
}

function pushSubIssues(
  issues: ValidationIssue[],
  basePointer: string,
  subIssues: readonly ValidationIssue[],
): void {
  for (const issue of subIssues) {
    const path =
      issue.path === '/' || issue.path === ''
        ? basePointer
        : issue.path.startsWith('/')
          ? `${basePointer}${issue.path}`
          : basePointer;
    issues.push({
      code: issue.code,
      path,
      message: issue.message,
    });
  }
}

function isRegularFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function resolveRegularPluginFile(
  realRoot: string,
  relativePath: string,
  pointerPath: string,
  issues: ValidationIssue[],
): string | undefined {
  const resolved = resolveSafePluginPath(realRoot, relativePath, { mustExist: true });
  if (!resolved.ok) {
    pushSubIssues(issues, pointerPath, resolved.issues);
    return undefined;
  }

  try {
    if (!statSync(resolved.value.absolutePath).isFile()) {
      issues.push({
        code: 'NOT_A_FILE',
        path: pointerPath,
        message: `Plugin path "${relativePath}" must resolve to a regular file.`,
      });
      return undefined;
    }
  } catch (error: unknown) {
    issues.push({
      code: 'FILE_READ_ERROR',
      path: pointerPath,
      message: `Unable to inspect plugin path "${relativePath}": ${formatErrorReason(error)}`,
    });
    return undefined;
  }

  return resolved.value.relativePosixPath;
}

function resolveSkillEntryPath(
  realRoot: string,
  rawSkillPath: string,
  pointerPath: string,
  issues: ValidationIssue[],
): string | undefined {
  const resolved = resolveSafePluginPath(realRoot, rawSkillPath, { mustExist: true });
  if (!resolved.ok) {
    pushSubIssues(issues, pointerPath, resolved.issues);
    return undefined;
  }

  try {
    const stats = statSync(resolved.value.absolutePath);
    if (stats.isDirectory()) {
      return resolved.value.relativePosixPath === '.'
        ? 'SKILL.md'
        : `${resolved.value.relativePosixPath}/SKILL.md`;
    }

    if (stats.isFile()) {
      if (posix.basename(resolved.value.relativePosixPath) !== 'SKILL.md') {
        issues.push({
          code: 'INVALID_SKILL_PATH',
          path: pointerPath,
          message: `Skill path "${rawSkillPath}" must be a skill directory or a SKILL.md file.`,
        });
        return undefined;
      }
      return resolved.value.relativePosixPath;
    }

    issues.push({
      code: 'NOT_A_FILE',
      path: pointerPath,
      message: `Skill path "${rawSkillPath}" must resolve to a skill directory or regular SKILL.md file.`,
    });
    return undefined;
  } catch (error: unknown) {
    issues.push({
      code: 'FILE_READ_ERROR',
      path: pointerPath,
      message: `Unable to inspect skill path "${rawSkillPath}": ${formatErrorReason(error)}`,
    });
    return undefined;
  }
}

function resolveRegularPathList(
  realRoot: string,
  rawPaths: readonly string[] | undefined,
  capabilityKey: 'tools' | 'policies',
  issues: ValidationIssue[],
): readonly string[] {
  const resolvedPaths: string[] = [];
  for (const [index, rawPath] of (rawPaths ?? []).entries()) {
    const pointer = `/capabilities/${capabilityKey}/${String(index)}`;
    const resolved = resolveRegularPluginFile(realRoot, rawPath, pointer, issues);
    if (resolved !== undefined) {
      resolvedPaths.push(resolved);
    }
  }
  return resolvedPaths;
}

function isSemverSatisfied(version: string, versionRange: string): boolean {
  const normalizedVersion = valid(version);
  if (normalizedVersion === null) {
    return false;
  }

  if (versionRange.trim().length === 0 || validRange(versionRange) === null) {
    return false;
  }

  try {
    return satisfies(normalizedVersion, versionRange);
  } catch {
    return false;
  }
}

/**
 * Discovers candidate plugin directories across `searchDirs` by checking each
 * existing directory's immediate subdirectories for a safe `plugin.json` regular file.
 * Missing or non-directory search paths are skipped without throwing.
 */
export function discoverPlugins(searchDirs: readonly string[]): readonly DiscoveryEntry[] {
  const entries: DiscoveryEntry[] = [];
  const seenCanonicalDirs = new Set<string>();

  for (const rawSearchDir of searchDirs) {
    if (rawSearchDir.trim().length === 0) {
      continue;
    }

    const searchDir = resolve(rawSearchDir);
    let isSearchDir = false;
    try {
      isSearchDir = statSync(searchDir).isDirectory();
    } catch {
      continue;
    }
    if (!isSearchDir) {
      continue;
    }

    let dirEntries;
    try {
      dirEntries = readdirSync(searchDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirEntry of dirEntries) {
      const candidateDir = resolve(searchDir, dirEntry.name);
      let isCandidateDir = false;
      try {
        isCandidateDir = statSync(candidateDir).isDirectory();
      } catch {
        continue;
      }
      if (!isCandidateDir) {
        continue;
      }

      const manifestCheck = resolveSafePluginPath(candidateDir, 'plugin.json', { mustExist: true });
      if (!manifestCheck.ok || !isRegularFile(manifestCheck.value.absolutePath)) {
        continue;
      }

      let canonicalDir: string;
      try {
        canonicalDir = resolve(realpathSync(candidateDir));
      } catch {
        continue;
      }

      const dedupKey = process.platform === 'win32' ? canonicalDir.toLowerCase() : canonicalDir;
      if (seenCanonicalDirs.has(dedupKey)) {
        continue;
      }
      seenCanonicalDirs.add(dedupKey);

      entries.push({
        dir: candidateDir,
        manifestPath: resolve(candidateDir, 'plugin.json'),
      });
    }
  }

  return entries.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/**
 * Safely validates, loads, and computes a deterministic bundle digest for a plugin
 * without executing any plugin scripts or hook commands.
 */
export function loadPlugin(
  pluginRoot: string,
  options?: LoadPluginOptions,
): ValidationResult<LoadedPlugin> {
  const manifestResolved = resolveSafePluginPath(pluginRoot, 'plugin.json', { mustExist: true });
  if (!manifestResolved.ok) {
    return manifestResolved;
  }

  let realRoot: string;
  try {
    realRoot = resolve(realpathSync(pluginRoot));
  } catch (error: unknown) {
    return fail(
      'ROOT_NOT_FOUND',
      pluginRoot,
      `Unable to resolve plugin root "${pluginRoot}": ${formatErrorReason(error)}`,
    );
  }

  try {
    if (!statSync(manifestResolved.value.absolutePath).isFile()) {
      return fail(
        'NOT_A_FILE',
        'plugin.json',
        'Manifest path "plugin.json" must resolve to a regular file.',
      );
    }
  } catch (error: unknown) {
    return fail(
      'FILE_READ_ERROR',
      'plugin.json',
      `Unable to inspect "plugin.json": ${formatErrorReason(error)}`,
    );
  }

  let rawManifestText: string;
  try {
    rawManifestText = readFileSync(manifestResolved.value.absolutePath, 'utf8');
  } catch (error: unknown) {
    return fail(
      'FILE_READ_ERROR',
      'plugin.json',
      `Unable to read "plugin.json": ${formatErrorReason(error)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripUtf8Bom(rawManifestText)) as unknown;
  } catch (error: unknown) {
    return fail(
      'MANIFEST_INVALID_JSON',
      'plugin.json',
      `Invalid JSON in "plugin.json": ${formatErrorReason(error)}`,
    );
  }

  const manifestResult = validateManifest(parsedJson);
  if (!manifestResult.ok) {
    return manifestResult;
  }

  const manifest = manifestResult.value;
  if (
    options?.coreVersion !== undefined &&
    !isCompatibleWithCoreVersion(manifest, options.coreVersion)
  ) {
    return fail(
      'INCOMPATIBLE_CORE_VERSION',
      '/compatibility/donaronPlugin',
      `Plugin "${manifest.id}" requires core version "${manifest.compatibility.donaronPlugin}", which is incompatible with "${options.coreVersion}".`,
    );
  }

  const issues: ValidationIssue[] = [];
  const digestFiles: string[] = [manifestResolved.value.relativePosixPath];

  if (manifest.logo !== undefined) {
    const logoPath = resolveRegularPluginFile(realRoot, manifest.logo, '/logo', issues);
    if (logoPath !== undefined) {
      digestFiles.push(logoPath);
    }
  }

  const skills: ParsedSkill[] = [];
  const seenSkillNames = new Set<string>();
  for (const [index, rawSkillPath] of (manifest.capabilities.skills ?? []).entries()) {
    const pointer = `/capabilities/skills/${String(index)}`;
    const skillMdPath = resolveSkillEntryPath(realRoot, rawSkillPath, pointer, issues);
    if (skillMdPath === undefined) {
      continue;
    }

    const parsedSkill = parseSkillFile(realRoot, skillMdPath);
    if (!parsedSkill.ok) {
      pushSubIssues(issues, pointer, parsedSkill.issues);
      continue;
    }

    if (seenSkillNames.has(parsedSkill.value.name)) {
      issues.push({
        code: 'DUPLICATE_SKILL_NAME',
        path: joinJsonPointer(pointer, 'name'),
        message: `Duplicate skill name "${parsedSkill.value.name}" in plugin "${manifest.id}".`,
      });
      continue;
    }

    seenSkillNames.add(parsedSkill.value.name);
    skills.push(parsedSkill.value);
    digestFiles.push(parsedSkill.value.sourcePath, ...parsedSkill.value.references);
    for (const script of parsedSkill.value.scripts) {
      digestFiles.push(script.path);
    }
  }

  const agents: ParsedAgent[] = [];
  const seenAgentNames = new Set<string>();
  for (const [index, rawAgentPath] of (manifest.capabilities.agents ?? []).entries()) {
    const pointer = `/capabilities/agents/${String(index)}`;
    const parsedAgent = parseAgentFile(realRoot, rawAgentPath);
    if (!parsedAgent.ok) {
      pushSubIssues(issues, pointer, parsedAgent.issues);
      continue;
    }

    if (seenAgentNames.has(parsedAgent.value.name)) {
      issues.push({
        code: 'DUPLICATE_AGENT_NAME',
        path: joinJsonPointer(pointer, 'name'),
        message: `Duplicate agent name "${parsedAgent.value.name}" in plugin "${manifest.id}".`,
      });
      continue;
    }

    seenAgentNames.add(parsedAgent.value.name);
    agents.push(parsedAgent.value);
    digestFiles.push(parsedAgent.value.sourcePath);
  }

  const rules: ParsedRule[] = [];
  const seenRuleIds = new Set<string>();
  for (const [index, rawRulePath] of (manifest.capabilities.rules ?? []).entries()) {
    const pointer = `/capabilities/rules/${String(index)}`;
    const parsedRule = parseRuleFile(realRoot, rawRulePath);
    if (!parsedRule.ok) {
      pushSubIssues(issues, pointer, parsedRule.issues);
      continue;
    }

    if (seenRuleIds.has(parsedRule.value.id)) {
      issues.push({
        code: 'DUPLICATE_RULE_ID',
        path: joinJsonPointer(pointer, 'id'),
        message: `Duplicate rule id "${parsedRule.value.id}" in plugin "${manifest.id}".`,
      });
      continue;
    }

    seenRuleIds.add(parsedRule.value.id);
    rules.push(parsedRule.value);
    digestFiles.push(parsedRule.value.sourcePath);
  }

  const hooks: HookBinding[] = [];
  const seenHookIds = new Set<string>();
  for (const [index, rawHooksPath] of (manifest.capabilities.hooks ?? []).entries()) {
    const pointer = `/capabilities/hooks/${String(index)}`;
    const hooksFilePosix = resolveRegularPluginFile(realRoot, rawHooksPath, pointer, issues);
    if (hooksFilePosix === undefined) {
      continue;
    }

    const parsedHooks = parseHooksFile(realRoot, hooksFilePosix);
    if (!parsedHooks.ok) {
      pushSubIssues(issues, pointer, parsedHooks.issues);
      continue;
    }

    digestFiles.push(hooksFilePosix);

    for (const binding of parsedHooks.value) {
      if (seenHookIds.has(binding.id)) {
        issues.push({
          code: 'DUPLICATE_HOOK_ID',
          path: pointer,
          message: `Duplicate hook id "${binding.id}" in plugin "${manifest.id}".`,
        });
        continue;
      }

      seenHookIds.add(binding.id);
      hooks.push(binding);
    }
  }

  const toolConfigPaths = resolveRegularPathList(
    realRoot,
    manifest.capabilities.tools,
    'tools',
    issues,
  );
  const policyPaths = resolveRegularPathList(
    realRoot,
    manifest.capabilities.policies,
    'policies',
    issues,
  );
  digestFiles.push(...toolConfigPaths, ...policyPaths);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  let digest: string;
  try {
    digest = computePluginDigest(realRoot, digestFiles);
  } catch (error: unknown) {
    return fail(
      'FILE_READ_ERROR',
      'plugin.json',
      `Unable to compute plugin digest: ${formatErrorReason(error)}`,
    );
  }

  return {
    ok: true,
    value: {
      rootDir: realRoot,
      manifest,
      digest,
      skills,
      agents,
      rules,
      hooks,
      toolConfigPaths,
      policyPaths,
    },
  };
}

/**
 * Validates inter-plugin uniqueness, dependency availability/version compatibility,
 * and acyclicity, returning plugins ordered topologically (dependencies before dependents).
 */
export function validatePluginDependencies(
  plugins: readonly LoadedPlugin[],
): ValidationResult<readonly LoadedPlugin[]> {
  const issues: ValidationIssue[] = [];
  const byId = new Map<string, LoadedPlugin>();

  for (const [index, plugin] of plugins.entries()) {
    const id = plugin.manifest.id;
    if (byId.has(id)) {
      issues.push({
        code: 'DUPLICATE_PLUGIN_ID',
        path: `/plugins/${String(index)}/id`,
        message: `Duplicate plugin id "${id}".`,
      });
      continue;
    }
    byId.set(id, plugin);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const adjacency = new Map<string, readonly string[]>();
  for (const plugin of plugins) {
    const id = plugin.manifest.id;
    const depIds: string[] = [];
    const seenDepIds = new Set<string>();

    for (const [depIndex, dep] of (plugin.manifest.dependencies ?? []).entries()) {
      const target = byId.get(dep.id);
      if (target === undefined) {
        issues.push({
          code: 'MISSING_DEPENDENCY',
          path: `/${id}/dependencies/${String(depIndex)}/id`,
          message: `Plugin "${id}" depends on missing plugin "${dep.id}".`,
        });
        continue;
      }

      if (!isSemverSatisfied(target.manifest.version, dep.versionRange)) {
        issues.push({
          code: 'INCOMPATIBLE_DEPENDENCY_VERSION',
          path: `/${id}/dependencies/${String(depIndex)}/versionRange`,
          message: `Plugin "${id}" requires "${dep.id}" matching "${dep.versionRange}", but found "${target.manifest.version}".`,
        });
      }

      if (!seenDepIds.has(dep.id)) {
        seenDepIds.add(dep.id);
        depIds.push(dep.id);
      }
    }

    adjacency.set(id, depIds);
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const ordered: LoadedPlugin[] = [];

  function visit(id: string): void {
    const currentState = visitState.get(id);
    if (currentState !== undefined) {
      return;
    }

    visitState.set(id, 'visiting');
    stack.push(id);

    for (const depId of adjacency.get(id) ?? []) {
      const depState = visitState.get(depId);
      if (depState === 'visiting') {
        const cycleStart = stack.indexOf(depId);
        const cycleChain = [...stack.slice(cycleStart), depId];
        issues.push({
          code: 'CIRCULAR_DEPENDENCY',
          path: `/${id}/dependencies`,
          message: `Circular plugin dependency detected: ${cycleChain.join(' -> ')}.`,
        });
        continue;
      }

      if (depState === undefined) {
        visit(depId);
      }
    }

    stack.pop();
    visitState.set(id, 'visited');

    const plugin = byId.get(id);
    if (plugin !== undefined) {
      ordered.push(plugin);
    }
  }

  for (const plugin of plugins) {
    if (!visitState.has(plugin.manifest.id)) {
      visit(plugin.manifest.id);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: ordered };
}
