import type { ValidationResult } from '@donaron/core';
import { computeCodeHash, computePlanHash } from '../hashing/scoped-hash.js';
import {
  evaluateRecordFreshness,
  EvidenceStore,
  type WorkflowRunState,
} from '../store/evidence-store.js';
import type { GateDecisionRecord, GateId, WorkflowState, WorkflowTier } from '../types.js';

export interface StartWorkflowOptions {
  readonly runId: string;
  readonly taskDescription: string;
  readonly planFiles: readonly string[];
  readonly actorType: 'agent' | 'human';
  readonly actorId: string;
  readonly tier?: WorkflowTier;
  readonly maxRetries?: number;
}

export interface OverrideGateOptions {
  readonly runId: string;
  readonly gateId: GateId;
  readonly actorType: 'agent' | 'human';
  readonly approver: string;
  readonly reason: string;
  readonly isInteractiveTty: boolean;
  readonly confirmed: boolean;
}

export interface StopHookGateContext {
  readonly runId?: string;
  readonly terminationReason: string;
  readonly continuationActive: boolean;
}

export interface StopHookGateDecision {
  readonly decision: 'allow_stop' | 'continue';
  readonly reason?: string;
}

const TERMINAL_STATES = new Set<WorkflowState>(['COMPLETED', 'REJECTED', 'CANCELLED']);

const INTERACTIVE_OR_WAITING_STATES = new Set<WorkflowState>([
  'INTAKE',
  'REQUIREMENTS_REVIEW',
  'ARCHITECTURE',
  'PLANNING',
  'GATE_01',
  'RESEARCH',
  'NEEDS_HUMAN_APPROVAL',
  'BLOCKED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);

const LEGAL_NEXT_STATES: Readonly<Record<WorkflowState, ReadonlySet<WorkflowState>>> = {
  INTAKE: new Set(['REQUIREMENTS_REVIEW', 'PLANNING']),
  REQUIREMENTS_REVIEW: new Set(['ARCHITECTURE', 'INTAKE']),
  ARCHITECTURE: new Set(['PLANNING', 'REQUIREMENTS_REVIEW']),
  PLANNING: new Set(['GATE_01']),
  GATE_01: new Set(['RESEARCH', 'IMPLEMENTATION', 'PLANNING']),
  RESEARCH: new Set(['IMPLEMENTATION', 'PLANNING']),
  IMPLEMENTATION: new Set(['PRE_TEST_REVIEW', 'SECURITY_REVIEW', 'GATE_03']),
  PRE_TEST_REVIEW: new Set(['GATE_02', 'IMPLEMENTATION']),
  GATE_02: new Set(['SECURITY_REVIEW', 'IMPLEMENTATION']),
  SECURITY_REVIEW: new Set(['GATE_03', 'IMPLEMENTATION']),
  GATE_03: new Set(['TESTING', 'IMPLEMENTATION']),
  TESTING: new Set(['GATE_04', 'PRE_TEST_REVIEW', 'IMPLEMENTATION']),
  GATE_04: new Set(['FINAL_REVIEW', 'COMPLETED', 'PRE_TEST_REVIEW', 'IMPLEMENTATION']),
  FINAL_REVIEW: new Set(['GATE_05', 'IMPLEMENTATION']),
  GATE_05: new Set(['COMPLETED', 'IMPLEMENTATION']),
  NEEDS_HUMAN_APPROVAL: new Set([
    'PLANNING',
    'IMPLEMENTATION',
    'GATE_01',
    'GATE_02',
    'GATE_03',
    'GATE_04',
    'GATE_05',
  ]),
  BLOCKED: new Set(['PLANNING', 'IMPLEMENTATION', 'GATE_03']),
  COMPLETED: new Set([]),
  REJECTED: new Set([]),
  CANCELLED: new Set([]),
};

const REQUIRED_GATES_BY_TIER: Readonly<Record<WorkflowTier, readonly GateId[]>> = {
  strict: ['GATE_01', 'GATE_02', 'GATE_03', 'GATE_04', 'GATE_05'],
  standard: ['GATE_01', 'GATE_03', 'GATE_04', 'GATE_05'],
  quick: ['GATE_03', 'GATE_04'],
};

export class WorkflowOrchestrator {
  readonly workspaceRoot: string;
  readonly store: EvidenceStore;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.store = new EvidenceStore(workspaceRoot);
  }

  startWorkflow(options: StartWorkflowOptions): ValidationResult<WorkflowRunState> {
    const tier: WorkflowTier = options.tier ?? 'strict';
    if (tier !== 'strict' && options.actorType !== 'human') {
      return {
        ok: false,
        issues: [
          {
            code: 'TIER_DOWNGRADE_FORBIDDEN',
            path: 'tier',
            message: `Agent "${options.actorId}" is not permitted to downgrade workflow tier from "strict" to "${tier}".`,
          },
        ],
      };
    }

    if (tier !== 'quick' && options.planFiles.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'EMPTY_PLAN_FILES',
            path: 'planFiles',
            message: `Workflow tier "${tier}" requires at least one planning artifact file.`,
          },
        ],
      };
    }

    return this.store.initRun({
      runId: options.runId,
      tier,
      taskDescription: options.taskDescription,
      planFiles: options.planFiles,
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      actorId: options.actorId,
    });
  }

  private computeCurrentHashes(state: WorkflowRunState): ValidationResult<{
    readonly planHash?: string;
    readonly codeHash: string;
  }> {
    const codeRes = computeCodeHash(this.workspaceRoot, { planFiles: state.planFiles });
    if (!codeRes.ok) {
      return codeRes;
    }
    if (state.tier === 'quick') {
      return { ok: true, value: { codeHash: codeRes.value.codeHash } };
    }
    const planRes = computePlanHash(this.workspaceRoot, state.planFiles);
    if (!planRes.ok) {
      return planRes;
    }
    return {
      ok: true,
      value: {
        planHash: planRes.value,
        codeHash: codeRes.value.codeHash,
      },
    };
  }

  private isGateFresh(
    runId: string,
    gateId: GateId,
    hashes: { readonly planHash?: string; readonly codeHash: string },
  ): boolean {
    const latest = this.store.getLatestGateDecision(runId, gateId);
    return evaluateRecordFreshness(latest, hashes) === 'FRESH';
  }

  transitionState(
    runId: string,
    targetState: WorkflowState,
    actorId: string,
  ): ValidationResult<WorkflowRunState> {
    const loaded = this.store.loadRunState(runId);
    if (!loaded.ok) {
      return loaded;
    }
    const state = loaded.value;

    if (TERMINAL_STATES.has(state.state)) {
      return {
        ok: false,
        issues: [
          {
            code: 'ILLEGAL_STATE_TRANSITION',
            path: 'targetState',
            message: `Cannot transition from terminal state "${state.state}" to "${targetState}".`,
          },
        ],
      };
    }

    if (
      targetState === 'CANCELLED' ||
      targetState === 'BLOCKED' ||
      targetState === 'NEEDS_HUMAN_APPROVAL' ||
      targetState === 'REJECTED'
    ) {
      return this.store.saveRunState(
        { ...state, state: targetState },
        actorId,
        `Transitioned to ${targetState}`,
      );
    }

    const allowedNext = LEGAL_NEXT_STATES[state.state];
    if (!allowedNext.has(targetState)) {
      return {
        ok: false,
        issues: [
          {
            code: 'ILLEGAL_STATE_TRANSITION',
            path: 'targetState',
            message: `Illegal workflow state transition from "${state.state}" to "${targetState}".`,
          },
        ],
      };
    }

    const hashesRes = this.computeCurrentHashes(state);
    if (!hashesRes.ok) {
      return hashesRes;
    }
    const hashes = hashesRes.value;

    // Gate 01 guard before RESEARCH or IMPLEMENTATION
    if (
      (state.state === 'GATE_01' || state.state === 'RESEARCH') &&
      (targetState === 'RESEARCH' || targetState === 'IMPLEMENTATION') &&
      state.tier !== 'quick'
    ) {
      if (!this.isGateFresh(runId, 'GATE_01', hashes)) {
        return {
          ok: false,
          issues: [
            {
              code: 'GATE_NOT_PASSED',
              path: 'GATE_01',
              message:
                'Cannot enter RESEARCH or IMPLEMENTATION before Gate 01 has fresh PASS evidence for current planHash.',
            },
          ],
        };
      }
    }

    // Gate 02 guard before SECURITY_REVIEW
    if (state.state === 'GATE_02' && targetState === 'SECURITY_REVIEW') {
      if (!this.isGateFresh(runId, 'GATE_02', hashes)) {
        return {
          ok: false,
          issues: [
            {
              code: 'GATE_NOT_PASSED',
              path: 'GATE_02',
              message:
                'Cannot enter SECURITY_REVIEW before Gate 02 has fresh PASS evidence for current codeHash.',
            },
          ],
        };
      }
    }

    // Gate 03 guard before TESTING
    if (state.state === 'GATE_03' && targetState === 'TESTING') {
      if (!this.isGateFresh(runId, 'GATE_03', hashes)) {
        return {
          ok: false,
          issues: [
            {
              code: 'GATE_NOT_PASSED',
              path: 'GATE_03',
              message:
                'Cannot enter TESTING before Gate 03 has fresh PASS evidence for current codeHash.',
            },
          ],
        };
      }
    }

    // Stale codeHash check when moving from TESTING to GATE_04
    if (state.state === 'TESTING' && targetState === 'GATE_04') {
      const priorCodeGates: readonly GateId[] =
        state.tier === 'strict' ? ['GATE_02', 'GATE_03'] : ['GATE_03'];
      const staleGates = priorCodeGates.filter((g) => !this.isGateFresh(runId, g, hashes));
      if (staleGates.length > 0) {
        return {
          ok: false,
          issues: [
            {
              code: 'STALE_PRIOR_GATE_EVIDENCE',
              path: 'targetState',
              message: `Code or tests changed during TESTING, invalidating ${staleGates.join(', ')}. Re-verify prior code gates before Gate 04.`,
            },
          ],
        };
      }
    }

    // Gate 04 guard before FINAL_REVIEW (or COMPLETED in quick tier)
    if (
      state.state === 'GATE_04' &&
      (targetState === 'FINAL_REVIEW' || targetState === 'COMPLETED')
    ) {
      if (targetState === 'COMPLETED' && state.tier !== 'quick') {
        return {
          ok: false,
          issues: [
            {
              code: 'ILLEGAL_STATE_TRANSITION',
              path: 'targetState',
              message: `Tier "${state.tier}" must pass FINAL_REVIEW and GATE_05 before COMPLETED.`,
            },
          ],
        };
      }
      const requiredSoFar: readonly GateId[] =
        state.tier === 'strict'
          ? ['GATE_01', 'GATE_02', 'GATE_03', 'GATE_04']
          : state.tier === 'standard'
            ? ['GATE_01', 'GATE_03', 'GATE_04']
            : ['GATE_03', 'GATE_04'];
      const notFresh = requiredSoFar.filter((g) => !this.isGateFresh(runId, g, hashes));
      if (notFresh.length > 0) {
        return {
          ok: false,
          issues: [
            {
              code: 'GATE_NOT_PASSED',
              path: 'GATE_04',
              message: `Cannot advance past Gate 04; missing or stale PASS evidence for: ${notFresh.join(', ')}.`,
            },
          ],
        };
      }
    }

    // Gate 05 guard before COMPLETED
    if (state.state === 'GATE_05' && targetState === 'COMPLETED') {
      const requiredAll = REQUIRED_GATES_BY_TIER[state.tier];
      const notFresh = requiredAll.filter((g) => !this.isGateFresh(runId, g, hashes));
      if (notFresh.length > 0) {
        return {
          ok: false,
          issues: [
            {
              code: 'GATE_NOT_PASSED',
              path: 'GATE_05',
              message: `Cannot complete workflow; missing or stale PASS evidence for: ${notFresh.join(', ')}.`,
            },
          ],
        };
      }
    }

    return this.store.saveRunState(
      { ...state, state: targetState },
      actorId,
      `Transitioned from ${state.state} to ${targetState}`,
    );
  }

  handleGateResult(
    runId: string,
    record: GateDecisionRecord,
    actorId: string,
  ): ValidationResult<WorkflowRunState> {
    const loaded = this.store.loadRunState(runId);
    if (!loaded.ok) {
      return loaded;
    }
    const state = loaded.value;

    if (record.decision === 'PASS' || record.decision === 'NOT_APPLICABLE') {
      return { ok: true, value: state };
    }

    if (record.decision === 'BLOCKED' || record.decision === 'NEEDS_HUMAN_APPROVAL') {
      return this.store.saveRunState(
        { ...state, state: record.decision },
        actorId,
        `Gate ${record.gateId} returned ${record.decision}`,
      );
    }

    // FAIL -> increment retry count and route bounded rework
    const prevCount = state.retryCounts[record.gateId];
    const nextCount = prevCount + 1;
    const updatedRetries = {
      ...state.retryCounts,
      [record.gateId]: nextCount,
    };

    const nextState: WorkflowState =
      nextCount >= state.maxRetries
        ? 'NEEDS_HUMAN_APPROVAL'
        : record.gateId === 'GATE_01'
          ? 'PLANNING'
          : 'IMPLEMENTATION';

    return this.store.saveRunState(
      {
        ...state,
        state: nextState,
        retryCounts: updatedRetries,
      },
      actorId,
      `Gate ${record.gateId} FAILED (attempt ${String(nextCount)}/${String(state.maxRetries)}) -> routed to ${nextState}`,
    );
  }

  overrideGate(options: OverrideGateOptions): ValidationResult<GateDecisionRecord> {
    if (options.actorType !== 'human') {
      return {
        ok: false,
        issues: [
          {
            code: 'AGENT_OVERRIDE_FORBIDDEN',
            path: 'actorType',
            message: 'Only a human actor can execute a gate override.',
          },
        ],
      };
    }

    if (!options.isInteractiveTty) {
      return {
        ok: false,
        issues: [
          {
            code: 'TTY_REQUIRED_FOR_OVERRIDE',
            path: 'isInteractiveTty',
            message: 'Gate overrides require an interactive terminal session (isTTY).',
          },
        ],
      };
    }

    if (!options.confirmed) {
      return {
        ok: false,
        issues: [
          {
            code: 'OVERRIDE_NOT_CONFIRMED',
            path: 'confirmed',
            message: 'Gate override was not confirmed by the user.',
          },
        ],
      };
    }

    const approver = options.approver.trim();
    if (approver.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'INVALID_APPROVER',
            path: 'approver',
            message: 'Approver identifier must be non-empty.',
          },
        ],
      };
    }

    const reason = options.reason.trim();
    if (reason.length < 10) {
      return {
        ok: false,
        issues: [
          {
            code: 'INVALID_OVERRIDE_REASON',
            path: 'reason',
            message: 'Gate override reason must be at least 10 characters.',
          },
        ],
      };
    }

    const loaded = this.store.loadRunState(options.runId);
    if (!loaded.ok) {
      return loaded;
    }
    const state = loaded.value;

    if (options.gateId === 'GATE_03') {
      const latestG3 = this.store.getLatestGateDecision(options.runId, 'GATE_03');
      if (latestG3 === undefined || latestG3.findings.some((f) => f.severity === 'critical')) {
        return {
          ok: false,
          issues: [
            {
              code: 'CRITICAL_SECURITY_NON_OVERRIDABLE',
              path: 'gateId',
              message:
                'Gate 03 critical security findings (or un-evaluated Gate 03 state) cannot be overridden.',
            },
          ],
        };
      }
    }

    const hashesRes = this.computeCurrentHashes(state);
    if (!hashesRes.ok) {
      return hashesRes;
    }
    const { planHash, codeHash } = hashesRes.value;
    const now = new Date().toISOString();

    const overrideRecord: GateDecisionRecord = {
      gateId: options.gateId,
      gateVersion: '1.0.0',
      runId: options.runId,
      ...(planHash !== undefined ? { planHash } : {}),
      codeHash,
      evaluator: { type: 'human', id: approver },
      checks: [
        {
          name: 'human-emergency-override',
          passed: true,
          summary: `Overridden by human "${approver}": ${reason}`,
        },
      ],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: now,
      humanApproval: {
        approver,
        reason,
        timestamp: now,
        isOverride: true,
      },
    };

    const recorded = this.store.recordGateDecision(overrideRecord);
    if (!recorded.ok) {
      return recorded;
    }

    this.store.appendAuditEntry(options.runId, 'GATE_OVERRIDDEN', approver, {
      gateId: options.gateId,
      reason,
      evidencePath: recorded.value,
    });

    return { ok: true, value: overrideRecord };
  }

  evaluateStopHookGate(context: StopHookGateContext): StopHookGateDecision {
    if (context.continuationActive || context.terminationReason !== 'NO_TOOL_CALL') {
      return { decision: 'allow_stop' };
    }

    const runId = context.runId ?? this.store.getActiveRunId();
    if (runId === undefined) {
      return { decision: 'allow_stop' };
    }

    const loaded = this.store.loadRunState(runId);
    if (!loaded.ok) {
      return { decision: 'allow_stop' };
    }
    const state = loaded.value;

    if (INTERACTIVE_OR_WAITING_STATES.has(state.state)) {
      return { decision: 'allow_stop' };
    }

    const hashesRes = this.computeCurrentHashes(state);
    if (!hashesRes.ok) {
      return {
        decision: 'continue',
        reason: `DonAron workflow (${state.tier}) in state ${state.state}: workspace hashes could not be verified.`,
      };
    }

    const requiredGates = REQUIRED_GATES_BY_TIER[state.tier];
    const missingOrStale = requiredGates.filter(
      (gateId) => !this.isGateFresh(runId, gateId, hashesRes.value),
    );

    if (missingOrStale.length === 0) {
      return { decision: 'allow_stop' };
    }

    return {
      decision: 'continue',
      reason: `DonAron ${state.tier} workflow in state ${state.state}: missing or stale PASS evidence for ${missingOrStale.join(', ')}.`,
    };
  }
}
