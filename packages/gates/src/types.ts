export type GateId = 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_04' | 'GATE_05';

export type GateDecisionStatus =
  | 'PASS'
  | 'FAIL'
  | 'NEEDS_HUMAN_APPROVAL'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type WorkflowTier = 'strict' | 'standard' | 'quick';

export type WorkflowState =
  | 'INTAKE'
  | 'REQUIREMENTS_REVIEW'
  | 'ARCHITECTURE'
  | 'PLANNING'
  | 'GATE_01'
  | 'RESEARCH'
  | 'IMPLEMENTATION'
  | 'PRE_TEST_REVIEW'
  | 'GATE_02'
  | 'SECURITY_REVIEW'
  | 'GATE_03'
  | 'TESTING'
  | 'GATE_04'
  | 'FINAL_REVIEW'
  | 'GATE_05'
  | 'COMPLETED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'NEEDS_HUMAN_APPROVAL';

export interface GateEvaluator {
  readonly type: 'deterministic' | 'agent' | 'human';
  readonly id: string;
}

export interface GateCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface GateFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly ruleId?: string;
}

export interface HumanApprovalRecord {
  readonly approver: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly isOverride: boolean;
}

export interface GateDecisionRecord {
  readonly gateId: GateId;
  readonly gateVersion: string;
  readonly runId: string;
  readonly planHash?: string;
  readonly codeHash?: string;
  readonly evaluator: GateEvaluator;
  readonly checks: readonly GateCheckResult[];
  readonly evidenceRefs: readonly string[];
  readonly findings: readonly GateFinding[];
  readonly decision: GateDecisionStatus;
  readonly timestamp: string;
  readonly humanApproval?: HumanApprovalRecord;
}

export interface AgentReviewRecord {
  readonly gateId: 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05';
  readonly runId: string;
  readonly role: 'intake-reviewer' | 'solutions-architect' | 'reviewer' | 'code-reviewer' | 'human';
  readonly evaluator: GateEvaluator;
  readonly approved: boolean;
  readonly summary: string;
  readonly findings: readonly GateFinding[];
  readonly planHash?: string;
  readonly codeHash?: string;
  readonly checklistVersions?: readonly string[];
  readonly scope?: string;
  readonly limitations?: string;
  readonly timestamp: string;
}

export interface WorkspaceHashes {
  readonly planHash: string;
  readonly codeHash: string;
  readonly gitHead: string;
}
