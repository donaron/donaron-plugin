import type { ValidationIssue, ValidationResult } from '../types.js';
import {
  collectUnknownKeyIssues,
  loadMarkdownArtifact,
  readBoolean,
  readRequiredEnum,
  readRequiredInteger,
  readRequiredNonEmptyString,
  readStringArray,
  requireNonEmptyBody,
} from './shared.js';

export type ModelTier = 'fast' | 'balanced' | 'reasoning';

export interface ParsedAgent {
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly responsibilities: readonly string[];
  readonly nonResponsibilities: readonly string[];
  readonly skills: readonly string[];
  readonly tools: readonly string[];
  readonly permissionProfile: string;
  readonly modelTier: ModelTier;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly handoffConditions: readonly string[];
  readonly maxRetries: number;
  readonly requiresHumanApproval: boolean;
  readonly body: string;
  readonly sourcePath: string;
}

const MODEL_TIERS: readonly ModelTier[] = ['fast', 'balanced', 'reasoning'];

const ALLOWED_AGENT_KEYS: ReadonlySet<string> = new Set([
  'name',
  'role',
  'description',
  'responsibilities',
  'nonResponsibilities',
  'skills',
  'tools',
  'permissionProfile',
  'modelTier',
  'inputContract',
  'outputContract',
  'handoffConditions',
  'maxRetries',
  'requiresHumanApproval',
]);

/**
 * Loads, validates, and parses an agent definition markdown file (`agents/*.md`).
 */
export function parseAgentFile(
  pluginRoot: string,
  relativePath: string,
): ValidationResult<ParsedAgent> {
  const loaded = loadMarkdownArtifact(pluginRoot, relativePath);
  if (!loaded.ok) {
    return loaded;
  }

  const { data, body, sourcePath } = loaded.value;
  const issues: ValidationIssue[] = [];

  collectUnknownKeyIssues(data, ALLOWED_AGENT_KEYS, 'AGENT_ADDITIONAL_PROPERTY', issues);

  const name = readRequiredNonEmptyString(data, 'name', issues, 'AGENT');
  const role = readRequiredNonEmptyString(data, 'role', issues, 'AGENT');
  const description = readRequiredNonEmptyString(data, 'description', issues, 'AGENT');
  const responsibilities = readStringArray(data, 'responsibilities', true, issues, 'AGENT');
  const nonResponsibilities = readStringArray(data, 'nonResponsibilities', true, issues, 'AGENT');
  const skills = readStringArray(data, 'skills', true, issues, 'AGENT');
  const tools = readStringArray(data, 'tools', true, issues, 'AGENT');
  const permissionProfile = readRequiredNonEmptyString(data, 'permissionProfile', issues, 'AGENT');
  const modelTier = readRequiredEnum(data, 'modelTier', MODEL_TIERS, issues, 'AGENT');
  const inputContract = readRequiredNonEmptyString(data, 'inputContract', issues, 'AGENT');
  const outputContract = readRequiredNonEmptyString(data, 'outputContract', issues, 'AGENT');
  const handoffConditions = readStringArray(data, 'handoffConditions', true, issues, 'AGENT');
  const maxRetries = readRequiredInteger(data, 'maxRetries', { min: 0, max: 20 }, issues, 'AGENT');
  const requiresHumanApproval = readBoolean(
    data,
    'requiresHumanApproval',
    { required: true, defaultValue: false },
    issues,
    'AGENT',
  );

  requireNonEmptyBody(body, issues, 'AGENT');

  if (
    issues.length > 0 ||
    name === undefined ||
    role === undefined ||
    description === undefined ||
    responsibilities === undefined ||
    nonResponsibilities === undefined ||
    skills === undefined ||
    tools === undefined ||
    permissionProfile === undefined ||
    modelTier === undefined ||
    inputContract === undefined ||
    outputContract === undefined ||
    handoffConditions === undefined ||
    maxRetries === undefined ||
    requiresHumanApproval === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      name,
      role,
      description,
      responsibilities,
      nonResponsibilities,
      skills,
      tools,
      permissionProfile,
      modelTier,
      inputContract,
      outputContract,
      handoffConditions,
      maxRetries,
      requiresHumanApproval,
      body,
      sourcePath,
    },
  };
}
