import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidationResult } from '@donaron/core';
import { computeCodeHash } from '../hashing/scoped-hash.js';
import type { EvidenceStore } from '../store/evidence-store.js';
import type { GateCheckResult, GateDecisionRecord, GateFinding } from '../types.js';

export const PINNED_OWASP_TOP_10_VERSION = 'OWASP-Top-10:2021';
export const PINNED_OWASP_LLM_TOP_10_VERSION = 'OWASP-LLM-Top-10:2025';

export interface DependencyAuditSummary {
  readonly executed: boolean;
  readonly offlineWaiverReason?: string;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly moderateCount: number;
  readonly lowCount: number;
}

export interface Gate03Input {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly store: EvidenceStore;
  readonly auditReportJson?: string;
  readonly auditSummary?: DependencyAuditSummary;
  readonly forceAiChecklist?: boolean;
  readonly requireOwaspReview?: boolean;
}

interface SecretRuleSpec {
  readonly ruleId: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const SECRET_RULES: readonly SecretRuleSpec[] = [
  {
    ruleId: 'SECRET_AWS_ACCESS_KEY',
    description: 'Potential AWS Access Key ID detected',
    pattern: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/,
  },
  {
    ruleId: 'SECRET_GITHUB_TOKEN',
    description: 'Potential GitHub Personal Access Token detected',
    pattern: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  },
  {
    ruleId: 'SECRET_OPENAI_ANTHROPIC_KEY',
    description: 'Potential OpenAI or Anthropic API key detected',
    pattern: /(?<![A-Za-z0-9])sk-(?:ant-)?[A-Za-z0-9_-]{16,}/,
  },
  {
    ruleId: 'SECRET_GOOGLE_API_KEY',
    description: 'Potential Google API key detected',
    pattern: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/,
  },
  {
    ruleId: 'SECRET_PRIVATE_KEY_BLOCK',
    description: 'PEM private key header detected',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
];

const IGNORED_DIRS = new Set(['.git', '.donaron', 'node_modules', 'dist', 'coverage']);

const AI_SDK_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/genai',
  '@google/generative-ai',
  'ai',
  'langchain',
];

function loadDonaronIgnorePrefixes(workspaceRoot: string): readonly string[] {
  const ignorePath = join(workspaceRoot, '.donaronignore');
  if (!existsSync(ignorePath)) {
    return [];
  }
  try {
    return readFileSync(ignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function isEnvIgnoredByGitignore(workspaceRoot: string): boolean {
  const gitignorePath = join(workspaceRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return false;
  }
  try {
    const content = readFileSync(gitignorePath, 'utf8');
    return /(?:^|\n)\s*\.env(?:\*|\.\*)?\s*(?:\r?\n|$)/.test(content);
  } catch {
    return false;
  }
}

export function scanWorkspaceForSecrets(workspaceRoot: string): readonly GateFinding[] {
  if (!existsSync(workspaceRoot)) {
    return [];
  }
  const ignorePrefixes = loadDonaronIgnorePrefixes(workspaceRoot);
  const envIgnored = isEnvIgnoredByGitignore(workspaceRoot);
  const findings: GateFinding[] = [];

  function isIgnored(relPosix: string): boolean {
    return ignorePrefixes.some(
      (prefix) => relPosix === prefix || relPosix.startsWith(`${prefix}/`),
    );
  }

  function walk(absDir: string, relPosixDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(absDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } catch {
      return;
    }

    for (const name of entries) {
      const childAbs = join(absDir, name);
      const childRel = relPosixDir.length > 0 ? `${relPosixDir}/${name}` : name;

      if (isIgnored(childRel)) {
        continue;
      }

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
        if (IGNORED_DIRS.has(name)) {
          continue;
        }
        walk(childAbs, childRel);
        continue;
      }
      if (!lstat.isFile() || name.endsWith('.tsbuildinfo')) {
        continue;
      }

      if (
        (name === '.env' ||
          (name.startsWith('.env.') && name !== '.env.example' && name !== '.env.template')) &&
        !envIgnored
      ) {
        findings.push({
          id: `secret-env-${childRel}`,
          severity: 'critical',
          message: `Unignored environment file "${childRel}" present in workspace.`,
          file: childRel,
          line: 1,
          ruleId: 'SECRET_ENV_FILE',
        });
      }

      let content: string;
      try {
        const buf = readFileSync(childAbs);
        if (buf.includes(0)) {
          continue; // skip binary files
        }
        content = buf.toString('utf8');
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (const [lineIdx, lineText] of lines.entries()) {
        for (const rule of SECRET_RULES) {
          if (rule.pattern.test(lineText)) {
            findings.push({
              id: `secret-${rule.ruleId}-${childRel}-${String(lineIdx + 1)}`,
              severity: 'critical',
              message: `${rule.description} in ${childRel}:${String(lineIdx + 1)} (value masked).`,
              file: childRel,
              line: lineIdx + 1,
              ruleId: rule.ruleId,
            });
          }
        }
      }
    }
  }

  walk(workspaceRoot, '');
  return findings;
}

function packageJsonHasAiSdk(pkgJsonPath: string): boolean {
  if (!existsSync(pkgJsonPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depNames = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    return depNames.some(
      (dep) =>
        AI_SDK_PACKAGES.includes(dep) ||
        dep.startsWith('@ai-sdk/') ||
        dep.startsWith('@langchain/'),
    );
  } catch {
    return false;
  }
}

export function detectAiApplication(workspaceRoot: string): boolean {
  const configPath = join(workspaceRoot, '.donaron', 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { aiApplication?: unknown };
      if (typeof cfg.aiApplication === 'boolean') {
        return cfg.aiApplication;
      }
    } catch {
      // fall through
    }
  }

  if (packageJsonHasAiSdk(join(workspaceRoot, 'package.json'))) {
    return true;
  }

  for (const container of ['packages', 'apps']) {
    const dir = join(workspaceRoot, container);
    if (!existsSync(dir)) {
      continue;
    }
    try {
      for (const sub of readdirSync(dir)) {
        if (packageJsonHasAiSdk(join(dir, sub, 'package.json'))) {
          return true;
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function asNonNegativeInt(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0 ? val : undefined;
}

export function parseDependencyAuditJson(
  rawJson: string,
): ValidationResult<DependencyAuditSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'AUDIT_INVALID_JSON',
          path: 'auditReportJson',
          message: 'Dependency audit output is not valid JSON.',
        },
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [
        {
          code: 'AUDIT_INVALID_FORMAT',
          path: 'auditReportJson',
          message: 'Dependency audit JSON must be an object.',
        },
      ],
    };
  }

  const record = parsed as Record<string, unknown>;
  const metadata = record.metadata;
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const vulns = (metadata as Record<string, unknown>).vulnerabilities;
    if (typeof vulns === 'object' && vulns !== null && !Array.isArray(vulns)) {
      const vObj = vulns as Record<string, unknown>;
      const criticalCount = asNonNegativeInt(vObj.critical);
      const highCount = asNonNegativeInt(vObj.high);
      const moderateCount = asNonNegativeInt(vObj.moderate);
      const lowCount = asNonNegativeInt(vObj.low);
      if (
        criticalCount !== undefined &&
        highCount !== undefined &&
        moderateCount !== undefined &&
        lowCount !== undefined
      ) {
        return {
          ok: true,
          value: {
            executed: true,
            criticalCount,
            highCount,
            moderateCount,
            lowCount,
          },
        };
      }
    }
  }

  const vulnerabilities = record.vulnerabilities;
  if (
    typeof vulnerabilities === 'object' &&
    vulnerabilities !== null &&
    !Array.isArray(vulnerabilities)
  ) {
    let criticalCount = 0;
    let highCount = 0;
    let moderateCount = 0;
    let lowCount = 0;
    for (const entry of Object.values(vulnerabilities as Record<string, unknown>)) {
      if (typeof entry === 'object' && entry !== null) {
        const sev = (entry as Record<string, unknown>).severity;
        if (sev === 'critical') criticalCount += 1;
        else if (sev === 'high') highCount += 1;
        else if (sev === 'moderate' || sev === 'medium') moderateCount += 1;
        else if (sev === 'low') lowCount += 1;
      }
    }
    return {
      ok: true,
      value: {
        executed: true,
        criticalCount,
        highCount,
        moderateCount,
        lowCount,
      },
    };
  }

  return {
    ok: false,
    issues: [
      {
        code: 'AUDIT_MISSING_COUNTS',
        path: 'auditReportJson',
        message: 'Dependency audit JSON does not contain recognizable vulnerability counts.',
      },
    ],
  };
}

export function evaluateGate03Security(input: Gate03Input): GateDecisionRecord {
  const now = new Date().toISOString();
  const stateResult = input.store.loadRunState(input.runId);
  if (!stateResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_03',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate03-security' },
      checks: [{ name: 'run-state', passed: false, summary: 'Workflow run state not found.' }],
      evidenceRefs: [],
      findings: stateResult.issues.map((i, idx) => ({
        id: `gate03-state-${String(idx + 1)}`,
        severity: 'critical',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const state = stateResult.value;
  const codeHashResult = computeCodeHash(input.workspaceRoot, { planFiles: state.planFiles });
  if (!codeHashResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_03',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate03-security' },
      checks: [{ name: 'code-hash', passed: false, summary: 'Failed to compute codeHash.' }],
      evidenceRefs: [],
      findings: codeHashResult.issues.map((i, idx) => ({
        id: `gate03-hash-${String(idx + 1)}`,
        severity: 'high',
        message: i.message,
        ruleId: i.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const { codeHash } = codeHashResult.value;
  const checks: GateCheckResult[] = [];
  const findings: GateFinding[] = [];

  // 1. Secret scan
  const secretFindings = scanWorkspaceForSecrets(input.workspaceRoot);
  for (const sf of secretFindings) {
    findings.push(sf);
  }
  checks.push({
    name: 'secret-scan',
    passed: secretFindings.length === 0,
    summary:
      secretFindings.length === 0
        ? 'Zero hardcoded secrets or unignored .env files detected.'
        : `Detected ${String(secretFindings.length)} secret exposure finding(s).`,
  });

  // 2. Dependency audit
  let auditSummary: DependencyAuditSummary | undefined = input.auditSummary;
  let auditParseFailed = false;
  if (auditSummary === undefined && input.auditReportJson !== undefined) {
    const parsed = parseDependencyAuditJson(input.auditReportJson);
    if (parsed.ok) {
      auditSummary = parsed.value;
    } else {
      auditParseFailed = true;
      for (const issue of parsed.issues) {
        findings.push({
          id: `gate03-audit-parse-${issue.code}`,
          severity: 'high',
          message: issue.message,
          ruleId: issue.code,
        });
      }
    }
  }

  let auditBlocked = false;
  if (auditParseFailed) {
    checks.push({
      name: 'dependency-audit',
      passed: false,
      summary: 'Dependency audit JSON could not be parsed.',
    });
  } else if (!auditSummary?.executed) {
    const waiver = auditSummary?.offlineWaiverReason?.trim();
    if (waiver !== undefined && waiver.length > 0) {
      checks.push({
        name: 'dependency-audit',
        passed: true,
        summary: `Dependency audit waived offline: ${waiver}`,
      });
      findings.push({
        id: 'gate03-audit-waived',
        severity: 'medium',
        message: `Dependency audit skipped with explicit offline waiver: ${waiver}`,
        ruleId: 'DEPENDENCY_AUDIT_WAIVED',
      });
    } else {
      auditBlocked = true;
      checks.push({
        name: 'dependency-audit',
        passed: false,
        summary: 'Dependency audit was not executed and no offline waiver was recorded.',
      });
      findings.push({
        id: 'gate03-audit-unexecuted',
        severity: 'high',
        message: 'Dependency vulnerability audit could not be executed (fail-closed BLOCKED).',
        ruleId: 'DEPENDENCY_AUDIT_BLOCKED',
      });
    }
  } else {
    const auditPassed = auditSummary.criticalCount === 0 && auditSummary.highCount === 0;
    checks.push({
      name: 'dependency-audit',
      passed: auditPassed,
      summary: `Vulnerabilities — critical: ${String(auditSummary.criticalCount)}, high: ${String(auditSummary.highCount)}, moderate: ${String(auditSummary.moderateCount)}, low: ${String(auditSummary.lowCount)}.`,
    });
    if (auditSummary.criticalCount > 0) {
      findings.push({
        id: 'gate03-audit-critical',
        severity: 'critical',
        message: `Dependency audit found ${String(auditSummary.criticalCount)} critical vulnerability advisory(s).`,
        ruleId: 'DEPENDENCY_CRITICAL_VULN',
      });
    }
    if (auditSummary.highCount > 0) {
      findings.push({
        id: 'gate03-audit-high',
        severity: 'high',
        message: `Dependency audit found ${String(auditSummary.highCount)} high vulnerability advisory(s).`,
        ruleId: 'DEPENDENCY_HIGH_VULN',
      });
    }
    if (auditSummary.moderateCount > 0) {
      findings.push({
        id: 'gate03-audit-moderate',
        severity: 'medium',
        message: `Dependency audit reported ${String(auditSummary.moderateCount)} moderate advisory(s).`,
        ruleId: 'DEPENDENCY_MODERATE_VULN',
      });
    }
  }

  // 3. Pinned OWASP checklist review (required in strict mode by default)
  const requireOwasp = input.requireOwaspReview ?? state.tier === 'strict';
  if (requireOwasp) {
    const isAiApp = input.forceAiChecklist === true || detectAiApplication(input.workspaceRoot);
    const requiredChecklists = isAiApp
      ? [PINNED_OWASP_TOP_10_VERSION, PINNED_OWASP_LLM_TOP_10_VERSION]
      : [PINNED_OWASP_TOP_10_VERSION];

    const freshReviews = input.store
      .listReviews(input.runId, 'GATE_03')
      .filter((r) => r.codeHash === codeHash);
    const latestReview = freshReviews[freshReviews.length - 1];

    if (latestReview !== undefined) {
      for (const f of latestReview.findings) {
        findings.push(f);
      }
    }

    const checklistsPresent =
      latestReview !== undefined &&
      requiredChecklists.every((reqVer) => latestReview.checklistVersions?.includes(reqVer));
    const hasScopeAndLimitations =
      typeof latestReview?.scope === 'string' &&
      latestReview.scope.trim().length > 0 &&
      typeof latestReview.limitations === 'string' &&
      latestReview.limitations.trim().length > 0;

    const owaspPassed =
      latestReview !== undefined &&
      latestReview.approved &&
      checklistsPresent &&
      hasScopeAndLimitations &&
      !latestReview.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

    checks.push({
      name: 'owasp-security-review',
      passed: owaspPassed,
      summary: owaspPassed
        ? `Security review verified against ${requiredChecklists.join(', ')} with scope and limitations.`
        : `Missing or incomplete security review for required checklists (${requiredChecklists.join(', ')}) with scope and limitations.`,
    });

    if (!owaspPassed) {
      findings.push({
        id: 'gate03-owasp-review-incomplete',
        severity: 'high',
        message: `Gate 03 requires a fresh approved security review covering ${requiredChecklists.join(', ')} with explicit scope and limitations.`,
        ruleId: 'OWASP_REVIEW_REQUIRED',
      });
    }
  }

  const hasBlockingFinding = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const allChecksPassed = checks.every((c) => c.passed);

  let decision: GateDecisionRecord['decision'];
  if (auditBlocked && secretFindings.length === 0) {
    decision = 'BLOCKED';
  } else if (allChecksPassed && !hasBlockingFinding) {
    decision = 'PASS';
  } else {
    decision = 'FAIL';
  }

  const record: GateDecisionRecord = {
    gateId: 'GATE_03',
    gateVersion: '1.0.0',
    runId: input.runId,
    codeHash,
    evaluator: { type: 'deterministic', id: 'gate03-security' },
    checks,
    evidenceRefs: [],
    findings,
    decision,
    timestamp: now,
  };

  input.store.recordGateDecision(record);
  return record;
}
