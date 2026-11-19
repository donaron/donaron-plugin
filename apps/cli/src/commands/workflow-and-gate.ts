import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  type AgentReviewRecord,
  computeCodeHash,
  computePlanHash,
  evaluateGate01Planning,
  evaluateGate02Pretest,
  evaluateGate03Security,
  evaluateGate04Testing,
  evaluateGate05Signoff,
  evaluateRecordFreshness,
  type GateDecisionRecord,
  type GateId,
  type PretestCheckRunner,
  WorkflowOrchestrator,
  type WorkflowState,
  type WorkflowTier,
} from '@donaron/gates';
import {
  formatCliError,
  formatCliOutput,
  getBooleanFlag,
  getStringArrayFlag,
  getStringFlag,
} from '../args.js';
import type { CliExecutionContext, CliRunResult, ParsedCliArgs } from '../types.js';

const ALL_GATES: readonly GateId[] = ['GATE_01', 'GATE_02', 'GATE_03', 'GATE_04', 'GATE_05'];

const VALID_TIERS = new Set<WorkflowTier>(['strict', 'standard', 'quick']);

const VALID_REVIEW_GATES = new Set<'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05'>([
  'GATE_01',
  'GATE_02',
  'GATE_03',
  'GATE_05',
]);

const VALID_REVIEW_ROLES = new Set<AgentReviewRecord['role']>([
  'intake-reviewer',
  'solutions-architect',
  'reviewer',
  'code-reviewer',
  'human',
]);

function normalizeGateId(raw: string): GateId | undefined {
  const upper = raw.trim().toUpperCase();
  if (upper === '01' || upper === '1' || upper === 'GATE_01') return 'GATE_01';
  if (upper === '02' || upper === '2' || upper === 'GATE_02') return 'GATE_02';
  if (upper === '03' || upper === '3' || upper === 'GATE_03') return 'GATE_03';
  if (upper === '04' || upper === '4' || upper === 'GATE_04') return 'GATE_04';
  if (upper === '05' || upper === '5' || upper === 'GATE_05') return 'GATE_05';
  return undefined;
}

function createDefaultPretestRunner(): PretestCheckRunner {
  return {
    runTypecheck(workspaceRoot: string) {
      const proc = spawnSync('pnpm run typecheck', {
        cwd: workspaceRoot,
        encoding: 'utf8',
        shell: true,
        timeout: 60000,
      });
      return {
        passed: proc.status === 0,
        output: `${proc.stdout || ''}${proc.stderr || ''}`.trim(),
      };
    },
    runLint(workspaceRoot: string) {
      const proc = spawnSync('pnpm run lint', {
        cwd: workspaceRoot,
        encoding: 'utf8',
        shell: true,
        timeout: 60000,
      });
      return {
        passed: proc.status === 0,
        output: `${proc.stdout || ''}${proc.stderr || ''}`.trim(),
      };
    },
  };
}

function resolveRunId(
  parsed: ParsedCliArgs,
  orchestrator: WorkflowOrchestrator,
): string | undefined {
  return getStringFlag(parsed, 'run-id') ?? orchestrator.store.getActiveRunId();
}

export function handleWorkflowCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const cwd = resolve(context.cwd ?? process.cwd());
  const orchestrator = new WorkflowOrchestrator(cwd);
  const subcommand = parsed.positionals[1];

  if (subcommand === 'start') {
    const runId = getStringFlag(parsed, 'run-id') ?? `run-${String(Date.now())}`;
    const taskDescription = getStringFlag(parsed, 'task') ?? 'DonAron workflow run';
    const tierRaw = getStringFlag(parsed, 'tier') ?? 'strict';
    if (!VALID_TIERS.has(tierRaw as WorkflowTier)) {
      return formatCliError(
        'INVALID_TIER',
        `Invalid workflow tier "${tierRaw}". Allowed: strict, standard, quick.`,
        parsed.json,
      );
    }
    const tier = tierRaw as WorkflowTier;
    const actorFlag = getStringFlag(parsed, 'actor');
    const isVerifiedHuman =
      actorFlag !== 'agent' && (context.isInteractiveTty === true || context.actorType === 'human');
    const actorType: 'agent' | 'human' =
      tier === 'strict'
        ? actorFlag === 'agent' || context.actorType === 'agent'
          ? 'agent'
          : 'human'
        : isVerifiedHuman
          ? 'human'
          : 'agent';
    const actorId = getStringFlag(parsed, 'actor-id') ?? 'cli-user';
    const planFiles = getStringArrayFlag(parsed, 'plan');

    const started = orchestrator.startWorkflow({
      runId,
      taskDescription,
      planFiles,
      actorType,
      actorId,
      tier,
    });

    if (!started.ok) {
      return formatCliError(
        started.issues[0]?.code ?? 'WORKFLOW_START_FAILED',
        started.issues.map((i) => i.message).join('; '),
        parsed.json,
        { issues: started.issues },
      );
    }

    const s = started.value;
    const human = `Started workflow "${s.runId}" [tier=${s.tier}, state=${s.state}]`;
    return formatCliOutput({ ok: true, workflow: s }, human, parsed.json);
  }

  if (subcommand === 'status') {
    const runId = resolveRunId(parsed, orchestrator);
    if (runId === undefined) {
      return formatCliError(
        'NO_ACTIVE_WORKFLOW',
        'No active workflow run found in workspace.',
        parsed.json,
      );
    }

    const loaded = orchestrator.store.loadRunState(runId);
    if (!loaded.ok) {
      return formatCliError(
        loaded.issues[0]?.code ?? 'RUN_LOAD_FAILED',
        loaded.issues.map((i) => i.message).join('; '),
        parsed.json,
      );
    }

    const state = loaded.value;
    const codeRes = computeCodeHash(cwd, { planFiles: state.planFiles });
    const planRes = state.tier !== 'quick' ? computePlanHash(cwd, state.planFiles) : undefined;
    const currentHashes = {
      ...(planRes?.ok ? { planHash: planRes.value } : {}),
      codeHash: codeRes.ok ? codeRes.value.codeHash : 'unknown',
    };

    const gateFreshness: Record<string, string> = {};
    for (const gateId of ALL_GATES) {
      const latest = orchestrator.store.getLatestGateDecision(runId, gateId);
      gateFreshness[gateId] = evaluateRecordFreshness(latest, currentHashes);
    }

    const payload = {
      ok: true,
      runId: state.runId,
      tier: state.tier,
      state: state.state,
      taskDescription: state.taskDescription,
      planFiles: state.planFiles,
      retryCounts: state.retryCounts,
      hashes: currentHashes,
      gateFreshness,
    };
    const human = [
      `Workflow: ${state.runId} (tier=${state.tier}, state=${state.state})`,
      `  Task: ${state.taskDescription}`,
      `  Gates: ${ALL_GATES.map((g) => `${g}=${gateFreshness[g] ?? 'MISSING'}`).join(', ')}`,
    ].join('\n');
    return formatCliOutput(payload, human, parsed.json);
  }

  if (subcommand === 'advance') {
    const targetState = parsed.positionals[2];
    if (targetState === undefined || targetState.trim().length === 0) {
      return formatCliError(
        'MISSING_TARGET_STATE',
        'Usage: donaron workflow advance <targetState> [--run-id <id>] [--json]',
        parsed.json,
      );
    }

    const runId = resolveRunId(parsed, orchestrator);
    if (runId === undefined) {
      return formatCliError('NO_ACTIVE_WORKFLOW', 'No active workflow run found.', parsed.json);
    }
    const actorId = getStringFlag(parsed, 'actor-id') ?? 'cli-user';
    const transitioned = orchestrator.transitionState(
      runId,
      targetState.trim() as WorkflowState,
      actorId,
    );
    if (!transitioned.ok) {
      return formatCliError(
        transitioned.issues[0]?.code ?? 'TRANSITION_FAILED',
        transitioned.issues.map((i) => i.message).join('; '),
        parsed.json,
        { issues: transitioned.issues },
      );
    }
    return formatCliOutput(
      { ok: true, workflow: transitioned.value },
      `Workflow "${runId}" advanced to ${transitioned.value.state}.`,
      parsed.json,
    );
  }

  if (subcommand === 'register-author') {
    const runId = resolveRunId(parsed, orchestrator);
    const kind = getStringFlag(parsed, 'kind');
    const actorId = getStringFlag(parsed, 'actor-id');
    if (runId === undefined || (kind !== 'plan' && kind !== 'code') || actorId === undefined) {
      return formatCliError(
        'INVALID_REGISTER_AUTHOR_ARGS',
        'Usage: donaron workflow register-author --kind <plan|code> --actor-id <id> [--run-id <id>] [--json]',
        parsed.json,
      );
    }

    const reg = orchestrator.store.registerArtifactAuthor(runId, kind, actorId);
    if (!reg.ok) {
      return formatCliError(
        reg.issues[0]?.code ?? 'REGISTER_AUTHOR_FAILED',
        reg.issues.map((i) => i.message).join('; '),
        parsed.json,
      );
    }
    return formatCliOutput(
      { ok: true, workflow: reg.value },
      `Registered ${kind} author "${actorId}" on run "${runId}".`,
      parsed.json,
    );
  }

  if (subcommand === 'record-review') {
    const runId = resolveRunId(parsed, orchestrator);
    const gateRaw = getStringFlag(parsed, 'gate');
    const roleRaw = getStringFlag(parsed, 'role');
    const reviewerId = getStringFlag(parsed, 'reviewer-id');
    const summary = getStringFlag(parsed, 'summary') ?? 'Recorded via donaron CLI';
    const approved = !getBooleanFlag(parsed, 'rejected');

    const normalizedGate = gateRaw !== undefined ? normalizeGateId(gateRaw) : undefined;
    if (
      runId === undefined ||
      normalizedGate === undefined ||
      !VALID_REVIEW_GATES.has(normalizedGate as 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05') ||
      roleRaw === undefined ||
      !VALID_REVIEW_ROLES.has(roleRaw as AgentReviewRecord['role']) ||
      reviewerId === undefined
    ) {
      return formatCliError(
        'INVALID_RECORD_REVIEW_ARGS',
        'Usage: donaron workflow record-review --gate <GATE_01|02|03|05> --role <role> --reviewer-id <id> [--approved|--rejected] --summary <text> [--json]',
        parsed.json,
      );
    }

    const loaded = orchestrator.store.loadRunState(runId);
    if (!loaded.ok) {
      return formatCliError('RUN_NOT_FOUND', `Workflow run "${runId}" not found.`, parsed.json);
    }

    const planRes = computePlanHash(cwd, loaded.value.planFiles);
    const codeRes = computeCodeHash(cwd, { planFiles: loaded.value.planFiles });
    const checklists = getStringArrayFlag(parsed, 'checklists');
    const scope = getStringFlag(parsed, 'scope');
    const limitations = getStringFlag(parsed, 'limitations');

    const review: AgentReviewRecord = {
      gateId: normalizedGate as 'GATE_01' | 'GATE_02' | 'GATE_03' | 'GATE_05',
      runId,
      role: roleRaw as AgentReviewRecord['role'],
      evaluator: {
        type: roleRaw === 'human' ? 'human' : 'agent',
        id: reviewerId,
      },
      approved,
      summary,
      findings: [],
      ...(planRes.ok ? { planHash: planRes.value } : {}),
      ...(codeRes.ok ? { codeHash: codeRes.value.codeHash } : {}),
      ...(checklists.length > 0 ? { checklistVersions: checklists } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(limitations !== undefined ? { limitations } : {}),
      timestamp: new Date().toISOString(),
    };

    const recorded = orchestrator.store.recordReview(review);
    if (!recorded.ok) {
      return formatCliError(
        recorded.issues[0]?.code ?? 'RECORD_REVIEW_FAILED',
        recorded.issues.map((i) => i.message).join('; '),
        parsed.json,
        { issues: recorded.issues },
      );
    }

    return formatCliOutput(
      { ok: true, review: recorded.value },
      `Recorded ${recorded.value.role} review for ${recorded.value.gateId} by "${reviewerId}".`,
      parsed.json,
    );
  }

  return formatCliError(
    'INVALID_WORKFLOW_SUBCOMMAND',
    'Usage: donaron workflow <start|status|advance|register-author|record-review> ...',
    parsed.json,
  );
}

export function handleGateCommand(
  parsed: ParsedCliArgs,
  context: CliExecutionContext,
): CliRunResult {
  const cwd = resolve(context.cwd ?? process.cwd());
  const orchestrator = new WorkflowOrchestrator(cwd);
  const subcommand = parsed.positionals[1];

  if (subcommand === 'run') {
    const targetArg = parsed.positionals[2];
    const runId = resolveRunId(parsed, orchestrator);
    if (targetArg === undefined || runId === undefined) {
      return formatCliError(
        'INVALID_GATE_RUN_ARGS',
        'Usage: donaron gate run <01|02|03|04|05|all> [--run-id <id>] [--json]',
        parsed.json,
      );
    }

    let gatesToRun: readonly GateId[];
    if (targetArg.toLowerCase() === 'all') {
      gatesToRun = ALL_GATES;
    } else {
      const single = normalizeGateId(targetArg);
      if (single === undefined) {
        return formatCliError('UNKNOWN_GATE_ID', `Unknown gate "${targetArg}".`, parsed.json);
      }
      gatesToRun = [single];
    }

    const runner = context.pretestRunner ?? createDefaultPretestRunner();
    const actorId = getStringFlag(parsed, 'actor-id') ?? 'cli-user';
    const results: GateDecisionRecord[] = [];

    for (const gateId of gatesToRun) {
      let decision: GateDecisionRecord;
      if (gateId === 'GATE_01') {
        decision = evaluateGate01Planning({
          workspaceRoot: cwd,
          runId,
          store: orchestrator.store,
        });
      } else if (gateId === 'GATE_02') {
        decision = evaluateGate02Pretest({
          workspaceRoot: cwd,
          runId,
          store: orchestrator.store,
          runner,
        });
      } else if (gateId === 'GATE_03') {
        const offlineWaiver = getStringFlag(parsed, 'offline-waiver');
        decision = evaluateGate03Security({
          workspaceRoot: cwd,
          runId,
          store: orchestrator.store,
          ...(context.auditSummary !== undefined
            ? { auditSummary: context.auditSummary }
            : offlineWaiver !== undefined
              ? {
                  auditSummary: {
                    executed: false,
                    offlineWaiverReason: offlineWaiver,
                    criticalCount: 0,
                    highCount: 0,
                    moderateCount: 0,
                    lowCount: 0,
                  },
                }
              : {}),
          ...(context.auditReportJson !== undefined
            ? { auditReportJson: context.auditReportJson }
            : {}),
        });
      } else if (gateId === 'GATE_04') {
        const reqPackages = context.requiredPackages ?? getStringArrayFlag(parsed, 'packages');
        decision = evaluateGate04Testing({
          workspaceRoot: cwd,
          runId,
          store: orchestrator.store,
          ...(context.testRun !== undefined ? { testRun: context.testRun } : {}),
          ...(reqPackages.length > 0 ? { requiredPackages: reqPackages } : {}),
          allowSkippedTests: getBooleanFlag(parsed, 'allow-skipped'),
        });
      } else {
        decision = evaluateGate05Signoff({
          workspaceRoot: cwd,
          runId,
          store: orchestrator.store,
        });
      }

      orchestrator.handleGateResult(runId, decision, actorId);
      results.push(decision);
    }

    const allPassed = results.every(
      (r) => r.decision === 'PASS' || r.decision === 'NOT_APPLICABLE',
    );
    const human = results
      .map(
        (r) =>
          `${r.gateId}: ${r.decision} (${String(r.checks.filter((c) => c.passed).length)}/${String(r.checks.length)} checks passed, ${String(r.findings.length)} finding(s))`,
      )
      .join('\n');

    return formatCliOutput({ ok: allPassed, results }, human, parsed.json, allPassed ? 0 : 1);
  }

  if (subcommand === 'status') {
    const runId = resolveRunId(parsed, orchestrator);
    if (runId === undefined) {
      return formatCliError('NO_ACTIVE_WORKFLOW', 'No active workflow run found.', parsed.json);
    }

    const loaded = orchestrator.store.loadRunState(runId);
    if (!loaded.ok) {
      return formatCliError('RUN_NOT_FOUND', `Run "${runId}" not found.`, parsed.json);
    }

    const codeRes = computeCodeHash(cwd, { planFiles: loaded.value.planFiles });
    const planRes =
      loaded.value.tier !== 'quick' ? computePlanHash(cwd, loaded.value.planFiles) : undefined;
    const hashes = {
      ...(planRes?.ok ? { planHash: planRes.value } : {}),
      codeHash: codeRes.ok ? codeRes.value.codeHash : 'unknown',
    };

    const gates = ALL_GATES.map((gateId) => {
      const latest = orchestrator.store.getLatestGateDecision(runId, gateId);
      const freshness = evaluateRecordFreshness(latest, hashes);
      return {
        gateId,
        freshness,
        latestDecision: latest?.decision ?? 'NONE',
        findingsCount: latest?.findings.length ?? 0,
      };
    });

    const human = gates
      .map(
        (g) =>
          `${g.gateId}: freshness=${g.freshness}, decision=${g.latestDecision}, findings=${String(g.findingsCount)}`,
      )
      .join('\n');
    return formatCliOutput({ ok: true, runId, gates }, human, parsed.json);
  }

  if (subcommand === 'override') {
    const gateRaw = parsed.positionals[2];
    const runId = resolveRunId(parsed, orchestrator);
    const reason = getStringFlag(parsed, 'reason') ?? '';
    const approver = getStringFlag(parsed, 'approver') ?? '';
    const gateId = gateRaw !== undefined ? normalizeGateId(gateRaw) : undefined;

    if (gateId === undefined || runId === undefined) {
      return formatCliError(
        'INVALID_GATE_OVERRIDE_ARGS',
        'Usage: donaron gate override <gateId> --reason <text> --approver <name> [--yes] [--json]',
        parsed.json,
      );
    }

    const isInteractiveTty = context.isInteractiveTty === true;
    const actorType: 'agent' | 'human' =
      context.actorType ?? (isInteractiveTty ? 'human' : 'agent');
    const confirmed = getBooleanFlag(parsed, 'yes') || context.confirmed === true;

    const overridden = orchestrator.overrideGate({
      runId,
      gateId,
      actorType,
      approver,
      reason,
      isInteractiveTty,
      confirmed,
    });

    if (!overridden.ok) {
      return formatCliError(
        overridden.issues[0]?.code ?? 'GATE_OVERRIDE_FAILED',
        overridden.issues.map((i) => i.message).join('; '),
        parsed.json,
        { issues: overridden.issues },
      );
    }

    return formatCliOutput(
      { ok: true, record: overridden.value },
      `Overrode ${gateId} on run "${runId}" (approver: ${approver}).`,
      parsed.json,
    );
  }

  return formatCliError(
    'INVALID_GATE_SUBCOMMAND',
    'Usage: donaron gate <run|status|override> ...',
    parsed.json,
  );
}
