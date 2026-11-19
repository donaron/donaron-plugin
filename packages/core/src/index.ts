export interface ModuleInfo {
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

export const DONARON_CORE_VERSION = '0.1.0';

export function getCoreModuleInfo(): ModuleInfo {
  return {
    name: '@donaron/core',
    version: DONARON_CORE_VERSION,
    dependencies: [],
  };
}

export type {
  DonAronManifest,
  Permission,
  PluginCapabilities,
  PluginDependency,
  ValidationIssue,
  ValidationResult,
} from './types.js';

export {
  SUPPORTED_MANIFEST_VERSION,
  isCompatibleWithCoreVersion,
  validateManifest,
} from './manifest/validator.js';

export {
  type ResolvedSafePath,
  type SafePathOptions,
  resolveSafePluginPath,
} from './loader/safe-path.js';

export { computePluginDigest } from './loader/digest.js';

export {
  type DiscoveryEntry,
  type LoadPluginOptions,
  type LoadedPlugin,
  discoverPlugins,
  loadPlugin,
  validatePluginDependencies,
} from './loader/plugin-loader.js';

export {
  type ParsedFrontmatter,
  isPlainObject,
  parseMarkdownFrontmatter,
  stripUtf8Bom,
} from './parsers/frontmatter.js';

export { type ParsedSkill, parseSkillFile } from './parsers/skill-parser.js';

export { type ModelTier, type ParsedAgent, parseAgentFile } from './parsers/agent-parser.js';

export { type ParsedRule, type RuleCategory, parseRuleFile } from './parsers/rule-parser.js';

export {
  type BuiltinHookHandler,
  type HookBinding,
  type HookEventName,
  parseHooksFile,
} from './parsers/hook-parser.js';

export {
  DEFAULT_SECURITY_POLICIES,
  type PolicyAction,
  type PolicyActorType,
  type PolicyEffect,
  type PolicyRule,
} from './policy/defaults.js';

export {
  type PolicyDecision,
  type PolicyRequest,
  evaluatePolicy,
  parsePolicyFile,
} from './policy/policy-engine.js';

export { REDACTED_VALUE, redactObject, redactSecrets } from './logger/redact.js';

export { type DonAronLogger, type LoggerOptions, createLogger } from './logger/logger.js';
