# DonAron Manifest Schema Reference (v1)

Canonical schema file: [donaron-plugin.v1.schema.json](../schemas/donaron-plugin.v1.schema.json)
Validator module: [validator.ts](../packages/core/src/manifest/validator.ts)
TypeScript types: [types.ts](../packages/core/src/types.ts)

> [!NOTE]
> **Status:** Universal manifest v1 validation (`SUPPORTED_MANIFEST_VERSION = '1'`) and semver compatibility checks are **Implemented** in `@donaron/core` (Phase 2). Automated CLI install prompts and provenance registry tracking remain **Planned** for Phase 5.

## 1. JSON Schema Overview

- **Draft:** JSON Schema Draft 2020-12 (`https://json-schema.org/draft/2020-12/schema`)
- **Schema `$id`:** `https://donaron.dev/schemas/donaron-plugin.v1.schema.json`
- **Validator:** `Ajv2020` (`allErrors: true`, `strict: true`) + `ajv-formats`
- **Unknown Fields Policy:** `additionalProperties: false` is enforced on the root manifest object, `author` (object form), `repository` (object form), `compatibility`, `capabilities`, and each `dependencies[]` item. Unknown properties fail loudly with `MANIFEST_ADDITIONAL_PROPERTY`.

## 2. Field Reference

### 2.1 Root Properties

| Field              | Required | Type / Format                                                   | Constraints & Validation Rules                                                               |
| ------------------ | -------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `$schema`          | No       | `string`                                                        | Optional JSON Schema reference URI                                                           |
| `manifestVersion`  | **Yes**  | `'1'`                                                           | Must equal `'1'`; other values fail with `MANIFEST_UNSUPPORTED_VERSION`                      |
| `id`               | **Yes**  | `string`                                                        | Unique plugin ID matching `^[a-z0-9][a-z0-9._-]{1,127}$` (2–128 chars)                       |
| `name`             | **Yes**  | `string`                                                        | Non-empty string containing non-whitespace (`minLength: 1`, `\S`)                            |
| `displayName`      | No       | `string`                                                        | Non-empty string (`\S`)                                                                      |
| `version`          | **Yes**  | `string`                                                        | Non-empty string AND valid semantic version per `semver.valid()` (`MANIFEST_INVALID_SEMVER`) |
| `description`      | **Yes**  | `string`                                                        | Non-empty string (`\S`)                                                                      |
| `author`           | No       | `string \| { name: string; url?: string }`                      | Object form requires `name`, allows optional HTTPS `url`, `additionalProperties: false`      |
| `license`          | No       | `string`                                                        | Non-empty string (`\S`)                                                                      |
| `homepage`         | No       | `string`                                                        | Valid `uri` format matching `^https://[^\s/]+`                                               |
| `repository`       | No       | `string \| { type: 'git'; url: string }`                        | HTTPS URL string or `{ type: 'git', url }` (`additionalProperties: false`)                   |
| `logo`             | No       | `string`                                                        | Safe relative path ending in `.png`, `.svg`, `.jpg`, `.jpeg`, or `.webp`                     |
| `suggestedPrompts` | No       | `string[]`                                                      | At most `3` non-empty strings (`maxItems: 3`)                                                |
| `compatibility`    | **Yes**  | `{ donaronPlugin: string; harnesses?: Record<string, string> }` | See §2.2                                                                                     |
| `permissions`      | **Yes**  | `Permission[]`                                                  | Unique array of `'fs:read' \| 'fs:write' \| 'cmd:exec' \| 'net:outbound' \| 'env:read'`      |
| `capabilities`     | **Yes**  | `PluginCapabilities`                                            | Object of safe relative path arrays; see §2.3                                                |
| `dependencies`     | No       | `PluginDependency[]`                                            | Array of `{ id, versionRange }`; see §2.4                                                    |

### 2.2 `compatibility` Object

- `donaronPlugin` (**required**): Non-empty semver range validated via `semver.validRange()` (`MANIFEST_INVALID_SEMVER_RANGE` when invalid). Checked at runtime by `isCompatibleWithCoreVersion(manifest, coreVersion)` (never throws; returns `false` on invalid `coreVersion` or range).
- `harnesses` (optional): Object mapping non-empty harness names to non-empty compatibility strings.

### 2.3 `capabilities` Object

All capability arrays are optional and enforce `safeRelativePath` on every item:

- `skills`: Directories containing `SKILL.md`, explicit `SKILL.md` paths, or `.`
- `agents`: Agent definition Markdown files (`agents/*.md`)
- `rules`: Guidance rule Markdown files (`rules/*.md`)
- `hooks`: Declarative hook JSON files (`hooks/hooks.json`)
- `tools`: Tool / MCP JSON config paths
- `policies`: Structured JSON policy files (`policies/*.json`)

**`safeRelativePath` Schema Rule:** Non-empty string (`minLength: 1`) disallowing leading `/` or `\`, Windows drive prefixes (`^[a-zA-Z]:`), whitespace-only strings, `..` traversal segments, colons (`:`), and ASCII control characters (`\u0000-\u001f`, `\u007f`). During bundle loading (`loadPlugin`), `resolveSafePluginPath` additionally enforces disk-level canonical containment inside `pluginRoot`.

### 2.4 `dependencies` Array

Each entry enforces `additionalProperties: false` and requires:

- `id`: Matches `pluginId` (`^[a-z0-9][a-z0-9._-]{1,127}$`).
- `versionRange`: Non-empty string validated via `semver.validRange()`.

## 3. Versioning & Compatibility Policy

1. `SUPPORTED_MANIFEST_VERSION` is `'1'`.
2. Non-breaking v1 schema additions must remain optional in `donaron-plugin.v1.schema.json`.
3. Any breaking field removal, rename, or semantic change requires incrementing `manifestVersion` to `'2'` with a dedicated schema file (`donaron-plugin.v2.schema.json`) and explicit migration guidance.
4. `loadPlugin(pluginRoot, { coreVersion })` rejects plugins whose `compatibility.donaronPlugin` range does not satisfy `coreVersion` (`INCOMPATIBLE_CORE_VERSION`).

## 4. Structured Validation Error Codes

`validateManifest(raw)` returns `ValidationResult<DonAronManifest>` with structured `ValidationIssue` entries (`{ code, path, message }`):

- `MANIFEST_ADDITIONAL_PROPERTY`: Unknown top-level or nested field.
- `MANIFEST_MISSING_PROPERTY`: Missing required field.
- `MANIFEST_UNSUPPORTED_VERSION`: `manifestVersion` is not `'1'`.
- `MANIFEST_SCHEMA_<KEYWORD>`: JSON Schema constraint failure (e.g., `MANIFEST_SCHEMA_PATTERN`, `MANIFEST_SCHEMA_ENUM`, `MANIFEST_SCHEMA_MAXITEMS`, `MANIFEST_SCHEMA_UNIQUEITEMS`, `MANIFEST_SCHEMA_FORMAT`).
- `MANIFEST_INVALID_SEMVER`: `version` fails `semver.valid()`.
- `MANIFEST_INVALID_SEMVER_RANGE`: `compatibility.donaronPlugin` or `dependencies[i].versionRange` fails `semver.validRange()`.

## 5. Examples

### 5.1 Valid Manifest (Fixture: `tests/fixtures/plugins/valid-sample/plugin.json`)

```json
{
  "$schema": "https://donaron.dev/schemas/donaron-plugin.v1.schema.json",
  "manifestVersion": "1",
  "id": "valid-sample",
  "name": "valid-sample",
  "displayName": "Valid Sample Plugin",
  "version": "1.0.0",
  "description": "Valid sample plugin fixture for safe discovery, bundle loading, and policy checks.",
  "compatibility": {
    "donaronPlugin": "^0.1.0"
  },
  "permissions": ["fs:read"],
  "capabilities": {
    "skills": ["skills/sample-skill"],
    "agents": ["agents/developer.md"],
    "rules": ["rules/security.md"],
    "hooks": ["hooks/hooks.json"],
    "policies": ["policies/custom.json"]
  }
}
```

### 5.2 Invalid Manifest (Fixture: `tests/fixtures/plugins/invalid-manifest/plugin.json`)

```json
{
  "manifestVersion": "1",
  "id": "Invalid_ID",
  "name": "",
  "version": "not-semver",
  "description": "Invalid manifest fixture for rejection tests.",
  "compatibility": {
    "donaronPlugin": "^0.1.0"
  },
  "permissions": ["fs:read"],
  "capabilities": {}
}
```

Why it fails:

- `id`: Uppercase letters (`I`, `I`, `D`) violate `^[a-z0-9][a-z0-9._-]{1,127}$` (`MANIFEST_SCHEMA_PATTERN` at `/id`).
- `name`: Empty string violates `minLength: 1` (`MANIFEST_SCHEMA_MINLENGTH` at `/name`).
- `version`: `'not-semver'` passes schema string check and is rejected by `semver.valid()` (`MANIFEST_INVALID_SEMVER` at `/version` when schema checks pass first).
