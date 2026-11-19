import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluatePolicy, parsePolicyFile, type PolicyAction, type PolicyRule } from '@donaron/core';
import { EvidenceStore, WorkflowOrchestrator } from '@donaron/gates';
import type { NormalizedHookDecision, NormalizedHookInput, NormalizedToolCall } from '../types.js';

const COMMAND_TOOL_NAMES = new Set(['run_command', 'bash', 'execute_command', 'shell']);

const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'write',
  'edit',
  'multiedit',
  'notebookedit',
  'create_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

const DELETE_TOOL_NAMES = new Set(['delete_file', 'remove_file']);

const READ_TOOL_NAMES = new Set(['read_file', 'read', 'view_file']);

function extractStringArg(
  args: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === 'string') {
      return val;
    }
  }
  return undefined;
}

function classifyToolAction(toolCall: NormalizedToolCall): {
  readonly action?: PolicyAction;
  readonly targetPath?: string;
  readonly command?: string;
} {
  const normalizedName = toolCall.name.trim().toLowerCase();

  if (COMMAND_TOOL_NAMES.has(normalizedName)) {
    const command = extractStringArg(toolCall.args, ['CommandLine', 'command', 'cmd']);
    return {
      action: 'cmd:exec',
      ...(command !== undefined ? { command } : {}),
    };
  }

  if (WRITE_TOOL_NAMES.has(normalizedName)) {
    const targetPath = extractStringArg(toolCall.args, [
      'Path',
      'file_path',
      'path',
      'TargetFile',
      'notebook_path',
    ]);
    return {
      action: 'fs:write',
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  }

  if (DELETE_TOOL_NAMES.has(normalizedName)) {
    const targetPath = extractStringArg(toolCall.args, ['Path', 'file_path', 'path', 'TargetFile']);
    return {
      action: 'fs:delete',
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  }

  if (READ_TOOL_NAMES.has(normalizedName)) {
    const targetPath = extractStringArg(toolCall.args, ['Path', 'file_path', 'path', 'TargetFile']);
    return {
      action: 'fs:read',
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  }

  return {};
}

export function executeNormalizedHook(input: NormalizedHookInput): NormalizedHookDecision {
  try {
    const workspaceRoot = input.workspaceRoot.trim();

    if (input.event === 'SessionStart') {
      if (workspaceRoot.length === 0 || !existsSync(workspaceRoot)) {
        return { event: 'SessionStart', decision: 'allow' };
      }
      const store = new EvidenceStore(workspaceRoot);
      const activeRunId = store.getActiveRunId();
      if (activeRunId === undefined) {
        return { event: 'SessionStart', decision: 'allow' };
      }
      const loaded = store.loadRunState(activeRunId);
      if (!loaded.ok) {
        return { event: 'SessionStart', decision: 'allow' };
      }
      const runState = loaded.value;
      return {
        event: 'SessionStart',
        decision: 'allow',
        systemMessage: `DonAron workflow active — runId: "${runState.runId}", tier: "${runState.tier}", state: "${runState.state}", task: "${runState.taskDescription}". All required gates for tier "${runState.tier}" must have fresh PASS evidence before completion.`,
      };
    }

    if (input.event === 'PreToolUse') {
      if (workspaceRoot.length === 0 || !existsSync(workspaceRoot)) {
        return {
          event: 'PreToolUse',
          decision: 'deny',
          reason: 'Fail-closed: workspaceRoot is missing or does not exist.',
        };
      }
      if (input.toolCall === undefined || input.toolCall.name.trim().length === 0) {
        return {
          event: 'PreToolUse',
          decision: 'deny',
          reason: 'Fail-closed: PreToolUse event is missing toolCall descriptor.',
        };
      }

      const classified = classifyToolAction(input.toolCall);
      if (classified.action === undefined) {
        return {
          event: 'PreToolUse',
          decision: 'allow',
        };
      }

      let extraRules: readonly PolicyRule[] | undefined;
      if (existsSync(join(workspaceRoot, '.donaron', 'policy.json'))) {
        const parsedPolicy = parsePolicyFile(workspaceRoot, '.donaron/policy.json');
        if (!parsedPolicy.ok) {
          return {
            event: 'PreToolUse',
            decision: 'deny',
            reason: `Fail-closed: workspace .donaron/policy.json is invalid (${parsedPolicy.issues.map((i) => i.message).join('; ')}).`,
          };
        }
        extraRules = parsedPolicy.value;
      }

      const policyResult = evaluatePolicy(
        {
          action: classified.action,
          actorType: 'agent',
          workspaceRoot,
          ...(classified.targetPath !== undefined ? { targetPath: classified.targetPath } : {}),
          ...(classified.command !== undefined ? { command: classified.command } : {}),
        },
        extraRules,
      );

      if (policyResult.effect === 'DENY') {
        return {
          event: 'PreToolUse',
          decision: 'deny',
          reason: policyResult.reason,
          matchedRuleId: policyResult.matchedRuleId,
        };
      }

      if (policyResult.effect === 'REQUIRE_APPROVAL') {
        return {
          event: 'PreToolUse',
          decision: 'ask',
          reason: policyResult.reason,
          matchedRuleId: policyResult.matchedRuleId,
        };
      }

      return {
        event: 'PreToolUse',
        decision: 'allow',
        matchedRuleId: policyResult.matchedRuleId,
      };
    }

    if (input.event === 'PostToolUse') {
      return {
        event: 'PostToolUse',
        decision: 'allow',
      };
    }

    // Stop event
    if (workspaceRoot.length === 0 || !existsSync(workspaceRoot)) {
      return {
        event: 'Stop',
        decision: 'allow_stop',
      };
    }
    const orchestrator = new WorkflowOrchestrator(workspaceRoot);
    const stopRes = orchestrator.evaluateStopHookGate({
      terminationReason: input.terminationReason ?? 'NO_TOOL_CALL',
      continuationActive: input.continuationActive === true,
    });
    if (stopRes.decision === 'continue') {
      return {
        event: 'Stop',
        decision: 'block_stop',
        ...(stopRes.reason !== undefined ? { reason: stopRes.reason } : {}),
      };
    }
    return {
      event: 'Stop',
      decision: 'allow_stop',
    };
  } catch (error: unknown) {
    if (input.event === 'PreToolUse') {
      return {
        event: 'PreToolUse',
        decision: 'deny',
        reason: `Fail-closed hook evaluation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (input.event === 'Stop') {
      return {
        event: 'Stop',
        decision: 'allow_stop',
      };
    }
    return {
      event: input.event,
      decision: 'allow',
    };
  }
}
