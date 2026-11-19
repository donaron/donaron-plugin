import { readFileSync } from 'node:fs';
import type { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { satisfies, valid, validRange } from 'semver';
import type { DonAronManifest, ValidationIssue, ValidationResult } from '../types.js';

export const SUPPORTED_MANIFEST_VERSION = '1';

const MANIFEST_SCHEMA_URL = new URL(
  '../../../../schemas/donaron-plugin.v1.schema.json',
  import.meta.url,
);

const MANIFEST_SCHEMA = JSON.parse(readFileSync(MANIFEST_SCHEMA_URL, 'utf8')) as AnySchemaObject;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);

const validateManifestSchema: ValidateFunction<DonAronManifest> =
  ajv.compile<DonAronManifest>(MANIFEST_SCHEMA);

function joinJsonPointer(basePath: string, segment: string): string {
  const escaped = segment.replaceAll('~', '~0').replaceAll('/', '~1');
  return basePath === '' ? `/${escaped}` : `${basePath}/${escaped}`;
}

function getStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatSchemaIssue(error: ErrorObject): ValidationIssue {
  const basePath = error.instancePath || '/';

  if (error.keyword === 'additionalProperties') {
    const extraProperty = getStringParam(error.params, 'additionalProperty');
    return {
      code: 'MANIFEST_ADDITIONAL_PROPERTY',
      path: extraProperty ? joinJsonPointer(error.instancePath, extraProperty) : basePath,
      message: extraProperty
        ? `Unexpected property "${extraProperty}".`
        : (error.message ?? 'Unexpected additional property.'),
    };
  }

  if (error.keyword === 'required') {
    const missingProperty = getStringParam(error.params, 'missingProperty');
    return {
      code: 'MANIFEST_MISSING_PROPERTY',
      path: missingProperty ? joinJsonPointer(error.instancePath, missingProperty) : basePath,
      message: error.message ?? `Missing required property "${missingProperty ?? ''}".`,
    };
  }

  if (error.instancePath === '/manifestVersion' && error.keyword === 'const') {
    return {
      code: 'MANIFEST_UNSUPPORTED_VERSION',
      path: '/manifestVersion',
      message: `Unsupported manifestVersion; expected "${SUPPORTED_MANIFEST_VERSION}".`,
    };
  }

  return {
    code: `MANIFEST_SCHEMA_${error.keyword.toUpperCase()}`,
    path: basePath,
    message: error.message ?? 'Manifest failed JSON Schema validation.',
  };
}

function collectSchemaIssues(errors: readonly ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors || errors.length === 0) {
    return [
      {
        code: 'MANIFEST_SCHEMA_ERROR',
        path: '/',
        message: 'Manifest failed JSON Schema validation.',
      },
    ];
  }

  const minLengthPaths = new Set(
    errors.filter((error) => error.keyword === 'minLength').map((error) => error.instancePath),
  );

  return errors
    .filter(
      (error) =>
        !(
          error.keyword === 'pattern' &&
          getStringParam(error.params, 'pattern') === '\\S' &&
          minLengthPaths.has(error.instancePath)
        ),
    )
    .map(formatSchemaIssue);
}

function isValidSemverRange(range: string): boolean {
  return range.trim().length > 0 && validRange(range) !== null;
}

function collectSemverIssues(manifest: DonAronManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (valid(manifest.version) === null) {
    issues.push({
      code: 'MANIFEST_INVALID_SEMVER',
      path: '/version',
      message: `Invalid semantic version "${manifest.version}".`,
    });
  }

  if (!isValidSemverRange(manifest.compatibility.donaronPlugin)) {
    issues.push({
      code: 'MANIFEST_INVALID_SEMVER_RANGE',
      path: '/compatibility/donaronPlugin',
      message: `Invalid compatibility semver range "${manifest.compatibility.donaronPlugin}".`,
    });
  }

  for (const [index, dependency] of (manifest.dependencies ?? []).entries()) {
    if (!isValidSemverRange(dependency.versionRange)) {
      issues.push({
        code: 'MANIFEST_INVALID_SEMVER_RANGE',
        path: `/dependencies/${String(index)}/versionRange`,
        message: `Invalid dependency semver range "${dependency.versionRange}".`,
      });
    }
  }

  return issues;
}

/**
 * Validates an unknown manifest payload against DonAron manifest schema v1
 * and semantic version / range rules.
 */
export function validateManifest(raw: unknown): ValidationResult<DonAronManifest> {
  if (!validateManifestSchema(raw)) {
    return {
      ok: false,
      issues: collectSchemaIssues(validateManifestSchema.errors),
    };
  }

  const semverIssues = collectSemverIssues(raw);
  if (semverIssues.length > 0) {
    return {
      ok: false,
      issues: semverIssues,
    };
  }

  return {
    ok: true,
    value: raw,
  };
}

/**
 * Checks whether a manifest's `compatibility.donaronPlugin` semver range
 * is satisfied by the given `@donaron/core` version. Never throws.
 */
export function isCompatibleWithCoreVersion(
  manifest: DonAronManifest,
  coreVersion: string,
): boolean {
  if (coreVersion.trim().length === 0) {
    return false;
  }

  const normalizedCore = valid(coreVersion);
  if (normalizedCore === null) {
    return false;
  }

  const range = manifest.compatibility.donaronPlugin;
  if (!isValidSemverRange(range)) {
    return false;
  }

  try {
    return satisfies(normalizedCore, range);
  } catch {
    return false;
  }
}
