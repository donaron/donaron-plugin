export type PolicyEffect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export type PolicyAction =
  | 'fs:read'
  | 'fs:write'
  | 'fs:delete'
  | 'cmd:exec'
  | 'net:outbound'
  | 'env:read'
  | 'workflow:override'
  | 'workflow:record-review';

export type PolicyActorType = 'agent' | 'human' | 'system';

export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly priority: number;
  readonly effect: PolicyEffect;
  readonly actions: readonly PolicyAction[];
  readonly pathPatterns?: readonly string[];
  readonly commandPatterns?: readonly string[];
  readonly actorTypes?: readonly PolicyActorType[];
  readonly critical?: boolean;
}

/**
 * Built-in fail-closed security policies enforcing Choice 1A (workflow state and
 * override protection) and Choice 2A (global hazard protection in all repositories).
 */
export const DEFAULT_SECURITY_POLICIES: readonly PolicyRule[] = [
  {
    id: 'builtin-protect-donaron-state',
    description:
      'Block AI agents from writing or deleting .donaron state, config, workflow, and evidence files.',
    priority: 1000,
    effect: 'DENY',
    actions: ['fs:write', 'fs:delete'],
    actorTypes: ['agent'],
    pathPatterns: ['(?i:(^|/)\\.donaron(/|$))'],
    critical: true,
  },
  {
    id: 'builtin-block-agent-override-cmd',
    description: 'Block AI agents from invoking donaron gate override via shell commands.',
    priority: 1000,
    effect: 'DENY',
    actions: ['cmd:exec'],
    actorTypes: ['agent'],
    commandPatterns: ['(?i:\\bdonaron(?:\\.cmd|\\.exe)?\\s+gate\\s+override\\b)'],
    critical: true,
  },
  {
    id: 'builtin-block-agent-override-action',
    description: 'Block AI agents from performing workflow:override actions.',
    priority: 1000,
    effect: 'DENY',
    actions: ['workflow:override'],
    actorTypes: ['agent'],
    critical: true,
  },
  {
    id: 'builtin-human-override-approval',
    description: 'Require explicit interactive confirmation for human workflow overrides.',
    priority: 900,
    effect: 'REQUIRE_APPROVAL',
    actions: ['workflow:override'],
    actorTypes: ['human'],
  },
  {
    id: 'builtin-block-secret-files',
    description:
      'Block reading, writing, or deleting .env files (except .env.example) and private key material unless explicitly allowlisted.',
    priority: 900,
    effect: 'DENY',
    actions: ['fs:read', 'fs:write', 'fs:delete'],
    pathPatterns: [
      '(?i:(^|/)\\.env($|\\.(?!example$).+))',
      '(?i:\\.pem$)',
      '(?i:\\.key$)',
      '(?i:(^|/)id_(rsa|ed25519)$)',
    ],
  },
  {
    id: 'builtin-block-destructive-commands',
    description:
      'Block destructive filesystem deletion, force-push/hard-reset git commands, destructive SQL statements, and pipe-to-shell downloads.',
    priority: 950,
    effect: 'DENY',
    actions: ['cmd:exec'],
    commandPatterns: [
      'rm\\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\\s+(/|~|\\*)',
      'rm\\s+(?:-[a-zA-Z]*r[a-zA-Z]*\\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*\\s+-[a-zA-Z]*r[a-zA-Z]*)\\s+(/|~|\\*)',
      '(?i:Remove-Item\\b.*(?:-Recurse.*-Force|-Force.*-Recurse)\\s+[a-zA-Z]:[/\\\\])',
      '(?i:Remove-Item\\b.*\\s+[a-zA-Z]:[/\\\\].*(?:-Recurse.*-Force|-Force.*-Recurse))',
      'git\\s+push\\b.*(\\s--force\\b|\\s-f\\b|--force-with-lease\\b)',
      'git\\s+reset\\s+--hard\\b',
      '(?i:\\bDROP\\s+(TABLE|DATABASE|SCHEMA)\\b)',
      '(?i:\\bTRUNCATE\\s+TABLE\\b)',
      '(?i:(curl|wget|iwr|Invoke-WebRequest)\\b.*\\|\\s*(sh|bash|pwsh|powershell|iex)\\b)',
    ],
    critical: true,
  },
  {
    id: 'builtin-approval-external-release',
    description: 'Require explicit approval before pushing git branches or publishing packages.',
    priority: 800,
    effect: 'REQUIRE_APPROVAL',
    actions: ['cmd:exec'],
    commandPatterns: ['\\bgit\\s+push\\b', '\\b(npm|pnpm)\\s+publish\\b'],
  },
  {
    id: 'builtin-block-env-read',
    description: 'Block AI agents from reading environment variables directly.',
    priority: 850,
    effect: 'DENY',
    actions: ['env:read'],
    actorTypes: ['agent'],
  },
];
