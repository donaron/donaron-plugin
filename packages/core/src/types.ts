export type Permission = 'fs:read' | 'fs:write' | 'cmd:exec' | 'net:outbound' | 'env:read';

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface PluginDependency {
  readonly id: string;
  readonly versionRange: string;
}

export interface PluginCapabilities {
  readonly skills?: readonly string[];
  readonly agents?: readonly string[];
  readonly rules?: readonly string[];
  readonly hooks?: readonly string[];
  readonly tools?: readonly string[];
  readonly policies?: readonly string[];
}

export interface DonAronManifest {
  readonly $schema?: string;
  readonly manifestVersion: '1';
  readonly id: string;
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string | { readonly name: string; readonly url?: string };
  readonly license?: string;
  readonly homepage?: string;
  readonly repository?: string | { readonly type: 'git'; readonly url: string };
  readonly logo?: string;
  readonly suggestedPrompts?: readonly string[];
  readonly compatibility: {
    readonly donaronPlugin: string;
    readonly harnesses?: Readonly<Record<string, string>>;
  };
  readonly permissions: readonly Permission[];
  readonly capabilities: PluginCapabilities;
  readonly dependencies?: readonly PluginDependency[];
}
