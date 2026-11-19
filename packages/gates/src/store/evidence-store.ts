import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { redactObject, redactSecrets, type ValidationResult } from '@donaron/core';
import type {
  AgentReviewRecord,
  GateDecisionRecord,
  GateId,
  WorkflowState,
  WorkflowTier,
} from '../types.js';

export type EvidenceFreshness = 'FRESH' | 'STALE' | 'MISSING' | 'FAILED';

export interface WorkflowRunState {
  readonly runId: string;
  readonly tier: WorkflowTier;
  readonly state: WorkflowState;
  readonly taskDescription: string;
  readonly planFiles: readonly string[];
  readonly planAuthorIds: readonly string[];
  readonly implementerIds: readonly string[];
  readonly retryCounts: Readonly<Record<GateId, number>>;
  readonly maxRetries: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AuditEventType =
  | 'WORKFLOW_STARTED'
  | 'STATE_TRANSITION'
  | 'AUTHOR_REGISTERED'
  | 'REVIEW_RECORDED'
  | 'REVIEW_REJECTED'
  | 'GATE_EVALUATED'
  | 'GATE_OVERRIDDEN';

export interface AuditLogEntry {
  readonly timestamp: string;
  readonly runId: string;
  readonly eventType: AuditEventType;
  readonly actorId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const ALLOWED_ROLES_BY_GATE: Readonly<
  Record<'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05', ReadonlySet<AgentReviewRecord['role']>>
> = {
  GATE_01: new Set(['intake-reviewer', 'solutions-architect', 'human']),
  GATE_02: new Set(['reviewer', 'code-reviewer', 'human']),
  GATE_03: new Set(['reviewer', 'code-reviewer', 'human']),
  GATE_05: new Set(['code-reviewer', 'human']),
};

export function evaluateRecordFreshness(
  record: GateDecisionRecord | undefined,
  hashes: { readonly planHash?: string; readonly codeHash: string },
): EvidenceFreshness {
  if (record === undefined) {
    return 'MISSING';
  }
  if (record.decision !== 'PASS') {
    return 'FAILED';
  }

  if (record.gateId === 'GATE_01') {
    if (
      record.planHash !== undefined &&
      hashes.planHash !== undefined &&
      record.planHash === hashes.planHash
    ) {
      return 'FRESH';
    }
    return 'STALE';
  }

  if (record.gateId === 'GATE_02' || record.gateId === 'GATE_03' || record.gateId === 'GATE_04') {
    if (record.codeHash !== undefined && record.codeHash === hashes.codeHash) {
      return 'FRESH';
    }
    return 'STALE';
  }

  // GATE_05
  if (record.codeHash === undefined || record.codeHash !== hashes.codeHash) {
    return 'STALE';
  }
  if (
    (record.planHash !== undefined || hashes.planHash !== undefined) &&
    record.planHash !== hashes.planHash
  ) {
    return 'STALE';
  }
  return 'FRESH';
}

export class EvidenceStore {
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private validateRunId(runId: string): ValidationResult<string> {
    if (!RUN_ID_PATTERN.test(runId)) {
      return {
        ok: false,
        issues: [
          {
            code: 'INVALID_RUN_ID',
            path: 'runId',
            message: `Invalid runId "${runId}": must be alphanumeric with optional . _ - (1..128 chars).`,
          },
        ],
      };
    }
    return { ok: true, value: runId };
  }

  private getDonaronDir(): string {
    return join(this.workspaceRoot, '.donaron');
  }

  private getRunDir(runId: string): string {
    return join(this.getDonaronDir(), 'runs', runId);
  }

  appendAuditEntry(
    runId: string,
    eventType: AuditEventType,
    actorId: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    const runDir = this.getRunDir(runId);
    mkdirSync(runDir, { recursive: true });
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      runId,
      eventType,
      actorId: redactSecrets(actorId),
      details: redactObject(details),
    };
    appendFileSync(join(runDir, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  initRun(params: {
    readonly runId: string;
    readonly tier: WorkflowTier;
    readonly taskDescription: string;
    readonly planFiles: readonly string[];
    readonly maxRetries?: number;
    readonly actorId: string;
  }): ValidationResult<WorkflowRunState> {
    const validId = this.validateRunId(params.runId);
    if (!validId.ok) {
      return validId;
    }

    const now = new Date().toISOString();
    const initialState: WorkflowState = params.tier === 'quick' ? 'IMPLEMENTATION' : 'INTAKE';
    const state: WorkflowRunState = {
      runId: params.runId,
      tier: params.tier,
      state: initialState,
      taskDescription: redactSecrets(params.taskDescription),
      planFiles: [...params.planFiles],
      planAuthorIds: [],
      implementerIds: [],
      retryCounts: {
        GATE_01: 0,
        GATE_02: 0,
        GATE_03: 0,
        GATE_04: 0,
        GATE_05: 0,
      },
      maxRetries: params.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
    };

    const runDir = this.getRunDir(params.runId);
    mkdirSync(join(runDir, 'evidence'), { recursive: true });
    mkdirSync(join(runDir, 'reviews'), { recursive: true });

    writeFileSync(join(runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(this.getDonaronDir(), 'active-run.json'),
      `${JSON.stringify({ runId: params.runId }, null, 2)}\n`,
      'utf8',
    );

    this.appendAuditEntry(params.runId, 'WORKFLOW_STARTED', params.actorId, {
      tier: params.tier,
      state: initialState,
      taskDescription: state.taskDescription,
      planFiles: state.planFiles,
    });

    return { ok: true, value: state };
  }

  getActiveRunId(): string | undefined {
    const activePath = join(this.getDonaronDir(), 'active-run.json');
    if (!existsSync(activePath)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(readFileSync(activePath, 'utf8')) as { runId?: unknown };
      if (typeof parsed.runId === 'string' && RUN_ID_PATTERN.test(parsed.runId)) {
        return parsed.runId;
      }
    } catch {
      // ignore malformed active-run.json
    }
    return undefined;
  }

  loadRunState(runId: string): ValidationResult<WorkflowRunState> {
    const validId = this.validateRunId(runId);
    if (!validId.ok) {
      return validId;
    }
    const statePath = join(this.getRunDir(runId), 'state.json');
    if (!existsSync(statePath)) {
      return {
        ok: false,
        issues: [
          {
            code: 'RUN_NOT_FOUND',
            path: 'runId',
            message: `Workflow run "${runId}" was not found.`,
          },
        ],
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as WorkflowRunState;
      return { ok: true, value: parsed };
    } catch {
      return {
        ok: false,
        issues: [
          {
            code: 'RUN_STATE_CORRUPT',
            path: 'state.json',
            message: `Failed to parse workflow state for run "${runId}".`,
          },
        ],
      };
    }
  }

  saveRunState(
    state: WorkflowRunState,
    actorId: string,
    reason: string,
  ): ValidationResult<WorkflowRunState> {
    const validId = this.validateRunId(state.runId);
    if (!validId.ok) {
      return validId;
    }
    const updated: WorkflowRunState = {
      ...state,
      updatedAt: new Date().toISOString(),
    };
    const runDir = this.getRunDir(state.runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'state.json'), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    this.appendAuditEntry(state.runId, 'STATE_TRANSITION', actorId, {
      state: updated.state,
      reason,
      retryCounts: updated.retryCounts,
    });
    return { ok: true, value: updated };
  }

  registerArtifactAuthor(
    runId: string,
    kind: 'plan' | 'code',
    actorId: string,
  ): ValidationResult<WorkflowRunState> {
    const loaded = this.loadRunState(runId);
    if (!loaded.ok) {
      return loaded;
    }
    const trimmed = actorId.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'INVALID_ACTOR_ID',
            path: 'actorId',
            message: 'Actor ID must be non-empty.',
          },
        ],
      };
    }

    const state = loaded.value;
    const nextPlanAuthors =
      kind === 'plan' && !state.planAuthorIds.includes(trimmed)
        ? [...state.planAuthorIds, trimmed]
        : state.planAuthorIds;
    const nextImplementers =
      kind === 'code' && !state.implementerIds.includes(trimmed)
        ? [...state.implementerIds, trimmed]
        : state.implementerIds;

    const updated: WorkflowRunState = {
      ...state,
      planAuthorIds: nextPlanAuthors,
      implementerIds: nextImplementers,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(this.getRunDir(runId), 'state.json'),
      `${JSON.stringify(updated, null, 2)}\n`,
      'utf8',
    );
    this.appendAuditEntry(runId, 'AUTHOR_REGISTERED', trimmed, { kind, actorId: trimmed });
    return { ok: true, value: updated };
  }

  recordReview(review: AgentReviewRecord): ValidationResult<AgentReviewRecord> {
    const loaded = this.loadRunState(review.runId);
    if (!loaded.ok) {
      return loaded;
    }
    const state = loaded.value;

    const allowedRoles = ALLOWED_ROLES_BY_GATE[review.gateId];
    if (!allowedRoles.has(review.role)) {
      this.appendAuditEntry(review.runId, 'REVIEW_REJECTED', review.evaluator.id, {
        gateId: review.gateId,
        role: review.role,
        reason: 'UNAUTHORIZED_REVIEWER_ROLE',
      });
      return {
        ok: false,
        issues: [
          {
            code: 'UNAUTHORIZED_REVIEWER_ROLE',
            path: 'role',
            message: `Role "${review.role}" is not authorized to review ${review.gateId}.`,
          },
        ],
      };
    }

    const forbiddenAuthorList =
      review.gateId === 'GATE_01' ? state.planAuthorIds : state.implementerIds;
    if (forbiddenAuthorList.includes(review.evaluator.id)) {
      this.appendAuditEntry(review.runId, 'REVIEW_REJECTED', review.evaluator.id, {
        gateId: review.gateId,
        role: review.role,
        reason: 'SELF_APPROVAL_FORBIDDEN',
      });
      return {
        ok: false,
        issues: [
          {
            code: 'SELF_APPROVAL_FORBIDDEN',
            path: 'evaluator.id',
            message: `Actor "${review.evaluator.id}" authored the artifact under review and cannot approve ${review.gateId}.`,
          },
        ],
      };
    }

    const reviewsDir = join(this.getRunDir(review.runId), 'reviews');
    mkdirSync(reviewsDir, { recursive: true });
    const existing = readdirSync(reviewsDir).filter(
      (f) => f.startsWith(`${review.gateId}-`) && f.endsWith('.json'),
    );
    const seq = String(existing.length + 1).padStart(3, '0');
    const fileName = `${review.gateId}-${seq}.json`;
    const sanitized = redactObject(review);
    writeFileSync(join(reviewsDir, fileName), `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');

    this.appendAuditEntry(review.runId, 'REVIEW_RECORDED', review.evaluator.id, {
      gateId: review.gateId,
      role: review.role,
      approved: review.approved,
      fileName,
    });

    return { ok: true, value: sanitized };
  }

  listReviews(runId: string, gateId?: GateId): readonly AgentReviewRecord[] {
    const validId = this.validateRunId(runId);
    if (!validId.ok) {
      return [];
    }
    const reviewsDir = join(this.getRunDir(runId), 'reviews');
    if (!existsSync(reviewsDir)) {
      return [];
    }
    const files = readdirSync(reviewsDir)
      .filter((f) => f.endsWith('.json') && (gateId === undefined || f.startsWith(`${gateId}-`)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const results: AgentReviewRecord[] = [];
    for (const file of files) {
      try {
        results.push(JSON.parse(readFileSync(join(reviewsDir, file), 'utf8')) as AgentReviewRecord);
      } catch {
        // skip corrupted review entry
      }
    }
    return results;
  }

  recordGateDecision(record: GateDecisionRecord): ValidationResult<string> {
    const validId = this.validateRunId(record.runId);
    if (!validId.ok) {
      return validId;
    }
    const evidenceDir = join(this.getRunDir(record.runId), 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const existing = readdirSync(evidenceDir).filter(
      (f) => f.startsWith(`${record.gateId}-`) && f.endsWith('.json'),
    );
    const seq = String(existing.length + 1).padStart(3, '0');
    const fileName = `${record.gateId}-${seq}.json`;
    const sanitized = redactObject(record);
    writeFileSync(join(evidenceDir, fileName), `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');

    const relativePosixPath = `.donaron/runs/${record.runId}/evidence/${fileName}`;
    this.appendAuditEntry(record.runId, 'GATE_EVALUATED', record.evaluator.id, {
      gateId: record.gateId,
      decision: record.decision,
      evidencePath: relativePosixPath,
      findingsCount: record.findings.length,
    });

    return { ok: true, value: relativePosixPath };
  }

  listGateDecisions(runId: string, gateId?: GateId): readonly GateDecisionRecord[] {
    const validId = this.validateRunId(runId);
    if (!validId.ok) {
      return [];
    }
    const evidenceDir = join(this.getRunDir(runId), 'evidence');
    if (!existsSync(evidenceDir)) {
      return [];
    }
    const files = readdirSync(evidenceDir)
      .filter((f) => f.endsWith('.json') && (gateId === undefined || f.startsWith(`${gateId}-`)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const results: GateDecisionRecord[] = [];
    for (const file of files) {
      try {
        results.push(
          JSON.parse(readFileSync(join(evidenceDir, file), 'utf8')) as GateDecisionRecord,
        );
      } catch {
        // skip corrupted decision entry
      }
    }
    return results;
  }

  getLatestGateDecision(runId: string, gateId: GateId): GateDecisionRecord | undefined {
    const decisions = this.listGateDecisions(runId, gateId);
    return decisions[decisions.length - 1];
  }

  readAuditLog(runId: string): readonly AuditLogEntry[] {
    const validId = this.validateRunId(runId);
    if (!validId.ok) {
      return [];
    }
    const auditPath = join(this.getRunDir(runId), 'audit.jsonl');
    if (!existsSync(auditPath)) {
      return [];
    }
    const rawLines = readFileSync(auditPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const entries: AuditLogEntry[] = [];
    for (const line of rawLines) {
      try {
        entries.push(JSON.parse(line) as AuditLogEntry);
      } catch {
        // skip malformed line
      }
    }
    return entries;
  }
}
