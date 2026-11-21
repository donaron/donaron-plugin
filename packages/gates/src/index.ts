import { getCoreModuleInfo, type ModuleInfo } from '@donaron/core';

export const DONARON_GATES_VERSION = '0.1.0';

export function getGatesModuleInfo(): ModuleInfo {
  const core = getCoreModuleInfo();
  return {
    name: '@donaron/gates',
    version: DONARON_GATES_VERSION,
    dependencies: [`${core.name}@${core.version}`],
  };
}

export type {
  AgentReviewRecord,
  FindingSeverity,
  GateCheckResult,
  GateDecisionRecord,
  GateDecisionStatus,
  GateEvaluator,
  GateFinding,
  GateId,
  HumanApprovalRecord,
  WorkflowState,
  WorkflowTier,
  WorkspaceHashes,
} from './types.js';

export {
  type CodeHashOptions,
  computeCodeHash,
  computePlanHash,
  computeWorkspaceHashes,
} from './hashing/scoped-hash.js';

export {
  type AuditEventType,
  type AuditLogEntry,
  type EvidenceFreshness,
  EvidenceStore,
  evaluateRecordFreshness,
  type WorkflowRunState,
} from './store/evidence-store.js';

export { evaluateGate01Planning, type Gate01Input } from './evaluators/gate01-planning.js';

export {
  evaluateGate02Pretest,
  type Gate02Input,
  type PretestCheckRunner,
} from './evaluators/gate02-pretest.js';

export {
  type DependencyAuditSummary,
  detectAiApplication,
  evaluateGate03Security,
  type Gate03Input,
  parseDependencyAuditJson,
  PINNED_OWASP_LLM_TOP_10_VERSION,
  PINNED_OWASP_TOP_10_VERSION,
  scanWorkspaceForSecrets,
} from './evaluators/gate03-security.js';

export {
  type CoverageFormat,
  detectWorkspaceStack,
  loadWorkspaceConfig,
  type TestResultsFormat,
  type WorkspaceStack,
  type WorkspaceStackConfig,
} from './config/workspace-config.js';

export {
  type CoverageThresholds,
  DEFAULT_COVERAGE_THRESHOLDS,
  evaluateGate04Testing,
  type Gate04Input,
  junitRunnerParser,
  type ParsedTestRun,
  parseLcovToSummaryMap,
  type TestRunnerParser,
  vitestRunnerParser,
} from './evaluators/gate04-testing.js';

export { evaluateGate05Signoff, type Gate05Input } from './evaluators/gate05-signoff.js';

export {
  type OverrideGateOptions,
  type StartWorkflowOptions,
  type StopHookGateContext,
  type StopHookGateDecision,
  WorkflowOrchestrator,
} from './orchestrator/workflow-orchestrator.js';
