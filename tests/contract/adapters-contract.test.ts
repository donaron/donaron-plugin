import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ANTIGRAVITY_MAX_RULES_BYTES,
  DONARON_ADAPTERS_VERSION,
  executeNormalizedHook,
  getAdaptersModuleInfo,
  getHarnessAdapter,
  listHarnessAdapters,
  mapModelTierToClaudeAlias,
  PluginInstallationRegistry,
} from '../../packages/adapters/src/index.js';
import { loadPlugin } from '../../packages/core/src/index.js';
import { computePlanHash, WorkflowOrchestrator } from '../../packages/gates/src/index.js';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-contract-')));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const SAMPLE_PLUGIN_DIR = resolve(import.meta.dirname, '..', 'fixtures', 'plugins', 'valid-sample');

describe('Phase 4 Harness Adapters Golden Contract & Hook Round-Trip Suite', () => {
  it('preserves @donaron/adapters module metadata and exposes both v1 harness adapters', () => {
    expect(DONARON_ADAPTERS_VERSION).toBe('0.1.0');
    expect(getAdaptersModuleInfo().name).toBe('@donaron/adapters');
    expect(listHarnessAdapters().map((a) => a.id)).toEqual(['antigravity', 'claude-code']);
  });

  it('exports golden bundles and records provenance installations for both Antigravity and Claude Code', () => {
    const loaded = loadPlugin(SAMPLE_PLUGIN_DIR);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const root = createTempDir();
    const registry = new PluginInstallationRegistry(join(root, 'registry.json'));

    for (const harnessId of ['antigravity', 'claude-code'] as const) {
      const adapter = getHarnessAdapter(harnessId);
      expect(adapter.validateCompatibility(loaded.value).ok).toBe(true);

      const installed = adapter.installPlugin(loaded.value, {
        targetPluginRootDir: join(root, harnessId),
        cliEntryPath: 'C:/donaron/apps/cli/dist/cli.js',
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      registry.recordInstall(installed.value);

      if (harnessId === 'antigravity') {
        expect(existsSync(join(installed.value.installedPath, 'plugin.json'))).toBe(true);
        expect(existsSync(join(installed.value.installedPath, 'hooks.json'))).toBe(true);
        const rulesBytes = Buffer.byteLength(
          readFileSync(join(installed.value.installedPath, 'rules', 'AGENTS.md'), 'utf8'),
          'utf8',
        );
        expect(rulesBytes).toBeLessThan(ANTIGRAVITY_MAX_RULES_BYTES);
      } else {
        expect(
          existsSync(join(installed.value.installedPath, '.claude-plugin', 'plugin.json')),
        ).toBe(true);
        expect(existsSync(join(installed.value.installedPath, 'hooks', 'hooks.json'))).toBe(true);
        expect(existsSync(join(installed.value.installedPath, 'CLAUDE.md'))).toBe(true);
        for (const agent of loaded.value.agents) {
          const agentContent = readFileSync(
            join(installed.value.installedPath, 'agents', `${agent.name}.md`),
            'utf8',
          );
          expect(agentContent).toContain(`model: ${mapModelTierToClaudeAlias(agent.modelTier)}`);
        }
      }
    }

    expect(registry.listInstalled()).toHaveLength(2);
  });

  it('executes full stdin -> translateHookInput -> executeNormalizedHook -> translateHookOutput round-trips for both harnesses', () => {
    const workspace = createTempDir();
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'docs', 'plan.md'), '# Plan\nDetails\n', 'utf8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const ok = 1;\n', 'utf8');

    const agy = getHarnessAdapter('antigravity');
    const cc = getHarnessAdapter('claude-code');

    // 1. Choice 2A in a repo without an active workflow:
    // PreToolUse blocks .env read and .donaron write, while Stop allows stopping
    const agyEnvIn = agy.translateHookInput(
      'PreToolUse',
      JSON.stringify({
        cwd: workspace,
        toolCall: { name: 'read_file', args: { Path: join(workspace, '.env') } },
      }),
    );
    expect(agyEnvIn.ok).toBe(true);
    if (!agyEnvIn.ok) return;
    const agyEnvOut = agy.translateHookOutput('PreToolUse', executeNormalizedHook(agyEnvIn.value));
    expect(agyEnvOut.decision).toBe('deny');

    const ccOverrideIn = cc.translateHookInput(
      'PreToolUse',
      JSON.stringify({
        cwd: workspace,
        tool_name: 'Bash',
        tool_input: { command: 'donaron gate override GATE_03 --reason test --approver bot' },
      }),
    );
    expect(ccOverrideIn.ok).toBe(true);
    if (!ccOverrideIn.ok) return;
    const ccOverrideOut = cc.translateHookOutput(
      'PreToolUse',
      executeNormalizedHook(ccOverrideIn.value),
    );
    expect(ccOverrideOut.decision).toBe('block');

    const agyStopNoWorkflowIn = agy.translateHookInput(
      'Stop',
      JSON.stringify({
        cwd: workspace,
        terminationReason: 'NO_TOOL_CALL',
        continuationActive: false,
      }),
    );
    expect(agyStopNoWorkflowIn.ok).toBe(true);
    if (!agyStopNoWorkflowIn.ok) return;
    expect(
      agy.translateHookOutput('Stop', executeNormalizedHook(agyStopNoWorkflowIn.value)),
    ).toEqual({ decision: '' });

    // 2. Start strict workflow and advance to IMPLEMENTATION -> Stop hook blocks stop in both harnesses
    const orchestrator = new WorkflowOrchestrator(workspace);
    orchestrator.startWorkflow({
      runId: 'contract-run-1',
      taskDescription: 'Contract test workflow',
      planFiles: ['docs/plan.md'],
      actorType: 'human',
      actorId: 'u',
    });
    const planHashRes = computePlanHash(workspace, ['docs/plan.md']);
    if (!planHashRes.ok) return;
    orchestrator.store.recordGateDecision({
      gateId: 'GATE_01',
      gateVersion: '1.0.0',
      runId: 'contract-run-1',
      planHash: planHashRes.value,
      evaluator: { type: 'deterministic', id: 'g1' },
      checks: [],
      evidenceRefs: [],
      findings: [],
      decision: 'PASS',
      timestamp: '2026-11-19T00:00:00.000Z',
    });
    orchestrator.transitionState('contract-run-1', 'PLANNING', 'u');
    orchestrator.transitionState('contract-run-1', 'GATE_01', 'u');
    orchestrator.transitionState('contract-run-1', 'IMPLEMENTATION', 'u');

    const agyStopActive = agy.translateHookOutput(
      'Stop',
      executeNormalizedHook(agyStopNoWorkflowIn.value),
    );
    expect(agyStopActive.decision).toBe('continue');

    const ccStopActiveIn = cc.translateHookInput(
      'Stop',
      JSON.stringify({
        cwd: workspace,
        stop_hook_active: false,
      }),
    );
    expect(ccStopActiveIn.ok).toBe(true);
    if (!ccStopActiveIn.ok) return;
    const ccStopActive = cc.translateHookOutput(
      'Stop',
      executeNormalizedHook(ccStopActiveIn.value),
    );
    expect(ccStopActive.decision).toBe('block');

    // 3. continuationActive / stop_hook_active === true yields allow_stop
    const ccStopLoopGuardIn = cc.translateHookInput(
      'Stop',
      JSON.stringify({
        cwd: workspace,
        stop_hook_active: true,
      }),
    );
    expect(ccStopLoopGuardIn.ok).toBe(true);
    if (!ccStopLoopGuardIn.ok) return;
    expect(cc.translateHookOutput('Stop', executeNormalizedHook(ccStopLoopGuardIn.value))).toEqual(
      {},
    );
  });
});
