import { readFileSync } from 'node:fs';
import { resolveSafePluginPath } from '@donaron/core';
import { computePlanHash } from '../hashing/scoped-hash.js';
import type { EvidenceStore } from '../store/evidence-store.js';
import type { GateCheckResult, GateDecisionRecord, GateFinding } from '../types.js';

export interface Gate01Input {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly store: EvidenceStore;
}

interface RequiredSectionSpec {
  readonly label: string;
  readonly headingRegex: RegExp;
}

const REQUIRED_SECTIONS: readonly RequiredSectionSpec[] = [
  { label: 'Requirements', headingRegex: /(?:^|\n)\s*(?:#{1,6}|\*\*)\s*Requirements\b/i },
  { label: 'Specification', headingRegex: /(?:^|\n)\s*(?:#{1,6}|\*\*)\s*Specification\b/i },
  { label: 'Architecture', headingRegex: /(?:^|\n)\s*(?:#{1,6}|\*\*)\s*Architecture\b/i },
  {
    label: 'Task Plan',
    headingRegex: /(?:^|\n)\s*(?:#{1,6}|\*\*)\s*(?:Task Plan|Implementation Plan|Tasks)\b/i,
  },
  {
    label: 'Acceptance Criteria',
    headingRegex: /(?:^|\n)\s*(?:#{1,6}|\*\*)\s*Acceptance Criteria\b/i,
  },
];

function hasNonEmptySectionContent(markdown: string, headingRegex: RegExp): boolean {
  const match = headingRegex.exec(markdown);
  if (match === null) {
    return false;
  }
  const afterHeading = markdown.slice(match.index + match[0].length);
  const lineBreakIdx = afterHeading.indexOf('\n');
  if (lineBreakIdx === -1) {
    return false;
  }
  const rest = afterHeading.slice(lineBreakIdx + 1);
  const nextHeadingMatch = /(?:^|\n)\s*#{1,6}\s+\S/.exec(rest);
  const bodySlice = nextHeadingMatch !== null ? rest.slice(0, nextHeadingMatch.index) : rest;
  return bodySlice.trim().length > 0;
}

export function evaluateGate01Planning(input: Gate01Input): GateDecisionRecord {
  const now = new Date().toISOString();
  const stateResult = input.store.loadRunState(input.runId);
  if (!stateResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate01-planning' },
      checks: [
        {
          name: 'run-state',
          passed: false,
          summary: 'Workflow run state could not be loaded.',
        },
      ],
      evidenceRefs: [],
      findings: stateResult.issues.map((issue, idx) => ({
        id: `gate01-state-${String(idx + 1)}`,
        severity: 'critical',
        message: issue.message,
        ruleId: issue.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const state = stateResult.value;
  const planHashResult = computePlanHash(input.workspaceRoot, state.planFiles);
  if (!planHashResult.ok) {
    const failRecord: GateDecisionRecord = {
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: input.runId,
      evaluator: { type: 'deterministic', id: 'gate01-planning' },
      checks: [
        {
          name: 'plan-artifacts',
          passed: false,
          summary: 'Failed to validate planning artifact files.',
        },
      ],
      evidenceRefs: [...state.planFiles],
      findings: planHashResult.issues.map((issue, idx) => ({
        id: `gate01-plan-${String(idx + 1)}`,
        severity: 'high',
        message: issue.message,
        ruleId: issue.code,
      })),
      decision: 'FAIL',
      timestamp: now,
    };
    input.store.recordGateDecision(failRecord);
    return failRecord;
  }

  const planHash = planHashResult.value;
  const combinedTexts: string[] = [];
  for (const relPath of state.planFiles) {
    const resolved = resolveSafePluginPath(input.workspaceRoot, relPath, { mustExist: true });
    if (resolved.ok) {
      combinedTexts.push(readFileSync(resolved.value.absolutePath, 'utf8'));
    }
  }
  const combinedMarkdown = combinedTexts.join('\n\n');

  const checks: GateCheckResult[] = [];
  const findings: GateFinding[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const present = hasNonEmptySectionContent(combinedMarkdown, section.headingRegex);
    checks.push({
      name: `section:${section.label}`,
      passed: present,
      summary: present
        ? `Required section "${section.label}" is present and non-empty.`
        : `Missing or empty required planning section "${section.label}".`,
    });
    if (!present) {
      findings.push({
        id: `gate01-missing-${section.label.toLowerCase().replaceAll(/\s+/g, '-')}`,
        severity: 'high',
        message: `Planning documents are missing non-empty "${section.label}" section.`,
        ruleId: 'MISSING_PLANNING_SECTION',
      });
    }
  }

  const freshReviews = input.store
    .listReviews(input.runId, 'GATE_01')
    .filter((r) => r.planHash === planHash);

  for (const review of freshReviews) {
    for (const f of review.findings) {
      findings.push(f);
    }
  }

  const humanReviews = freshReviews.filter(
    (r) => r.role === 'human' && r.evaluator.type === 'human',
  );
  const latestHuman = humanReviews[humanReviews.length - 1];
  const hasApprovedHuman =
    latestHuman !== undefined &&
    latestHuman.approved &&
    !latestHuman.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

  const intakeReviews = freshReviews.filter((r) => r.role === 'intake-reviewer');
  const latestIntake = intakeReviews[intakeReviews.length - 1];
  const approvedIntake =
    latestIntake !== undefined &&
    latestIntake.approved &&
    !latestIntake.findings.some((f) => f.severity === 'critical' || f.severity === 'high')
      ? latestIntake
      : undefined;

  const archReviews = freshReviews.filter((r) => r.role === 'solutions-architect');
  const latestArch = archReviews[archReviews.length - 1];
  const approvedArch =
    latestArch !== undefined &&
    latestArch.approved &&
    !latestArch.findings.some((f) => f.severity === 'critical' || f.severity === 'high')
      ? latestArch
      : undefined;

  const reviewPassed =
    hasApprovedHuman ||
    (approvedIntake !== undefined &&
      approvedArch !== undefined &&
      approvedIntake.evaluator.id.trim().toLowerCase() !==
        approvedArch.evaluator.id.trim().toLowerCase());

  checks.push({
    name: 'independent-planning-review',
    passed: reviewPassed,
    summary: reviewPassed
      ? 'Required independent planning review approval recorded for current planHash.'
      : 'Missing fresh approval from intake-reviewer + solutions-architect (or human approver) for current planHash.',
  });

  if (!reviewPassed) {
    findings.push({
      id: 'gate01-missing-review',
      severity: 'high',
      message:
        'Gate 01 requires fresh approval from both intake-reviewer and solutions-architect (or explicit human approval).',
      ruleId: 'PLANNING_REVIEW_REQUIRED',
    });
  }

  const hasBlockingFinding = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const allChecksPassed = checks.every((c) => c.passed);

  const record: GateDecisionRecord = {
    gateId: 'GATE_01',
    gateVersion: '1.0.0',
    runId: input.runId,
    planHash,
    evaluator: { type: 'deterministic', id: 'gate01-planning' },
    checks,
    evidenceRefs: [...state.planFiles],
    findings,
    decision: allChecksPassed && !hasBlockingFinding ? 'PASS' : 'FAIL',
    timestamp: now,
  };

  input.store.recordGateDecision(record);
  return record;
}
