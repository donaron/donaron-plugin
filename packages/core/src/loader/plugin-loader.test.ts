import type * as nodeFs from 'node:fs';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DonAronManifest, PluginDependency } from '../types.js';
import { computePluginDigest } from './digest.js';
import {
  type LoadedPlugin,
  discoverPlugins,
  loadPlugin,
  validatePluginDependencies,
} from './plugin-loader.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES_PLUGINS_DIR = resolve(REPO_ROOT, 'tests/fixtures/plugins');
const VALID_SAMPLE_DIR = resolve(FIXTURES_PLUGINS_DIR, 'valid-sample');
const INVALID_MANIFEST_DIR = resolve(FIXTURES_PLUGINS_DIR, 'invalid-manifest');

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function writePluginFile(pluginRoot: string, relativePath: string, content: string): void {
  const fullPath = join(pluginRoot, ...relativePath.split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function validSkillMarkdown(name: string, extraLines: readonly string[] = []): string {
  return [
    '---',
    `name: ${name}`,
    'description: Skill description.',
    'purpose: Skill purpose.',
    'activation: On demand.',
    'inputs:',
    '  - Request',
    'outputs:',
    '  - Output',
    'constraints:',
    '  - Stay safe',
    'completionCriteria:',
    '  - Done',
    ...extraLines,
    '---',
    '',
    `# ${name}`,
    '',
    'Skill instructions.',
    '',
  ].join('\n');
}

function validAgentMarkdown(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'role: Specialist',
    'description: Agent description.',
    'responsibilities:',
    '  - Execute task',
    'nonResponsibilities:',
    '  - Self-approve',
    'skills:',
    '  - sample-skill',
    'tools:',
    '  - read_file',
    'permissionProfile: readonly',
    'modelTier: balanced',
    'inputContract: Task input',
    'outputContract: Task output',
    'handoffConditions:',
    '  - Escalate blockers',
    'maxRetries: 2',
    'requiresHumanApproval: false',
    '---',
    '',
    `# ${name}`,
    '',
    'Agent prompt.',
    '',
  ].join('\n');
}

function validRuleMarkdown(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'category: security',
    'scope: repository',
    'priority: 50',
    '---',
    '',
    'Follow rule.',
    '',
  ].join('\n');
}

function createManifest(
  id: string,
  version: string,
  capabilities: DonAronManifest['capabilities'] = {},
  extra: Partial<Pick<DonAronManifest, 'logo' | 'dependencies'>> = {},
): DonAronManifest {
  return {
    manifestVersion: '1',
    id,
    name: id,
    version,
    description: `Plugin ${id}`,
    compatibility: {
      donaronPlugin: '^0.1.0',
    },
    permissions: ['fs:read'],
    capabilities,
    ...(extra.logo !== undefined ? { logo: extra.logo } : {}),
    ...(extra.dependencies !== undefined ? { dependencies: extra.dependencies } : {}),
  };
}

function createSyntheticLoadedPlugin(
  id: string,
  version: string,
  dependencies?: readonly PluginDependency[],
): LoadedPlugin {
  return {
    rootDir: `/virtual/${id}`,
    manifest: createManifest(id, version, {}, dependencies !== undefined ? { dependencies } : {}),
    digest: `sha256:${'0'.repeat(64)}`,
    skills: [],
    agents: [],
    rules: [],
    hooks: [],
    toolConfigPaths: [],
    policyPaths: [],
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

describe('discoverPlugins', () => {
  it('discovers valid-sample and invalid-manifest in fixtures and sorts deterministically by dir', () => {
    const entries = discoverPlugins([FIXTURES_PLUGINS_DIR]);

    expect(entries).toEqual([
      {
        dir: INVALID_MANIFEST_DIR,
        manifestPath: resolve(INVALID_MANIFEST_DIR, 'plugin.json'),
      },
      {
        dir: VALID_SAMPLE_DIR,
        manifestPath: resolve(VALID_SAMPLE_DIR, 'plugin.json'),
      },
    ]);
  });

  it('skips non-plugin directories, files, directory plugin.json, missing searchDirs, and deduplicates searchDirs', () => {
    const workspace = createTempDir('donaron-discover-');
    const searchA = join(workspace, 'plugins-a');
    const searchB = join(workspace, 'plugins-b');
    mkdirSync(searchA, { recursive: true });
    mkdirSync(searchB, { recursive: true });

    writePluginFile(join(searchA, 'zeta'), 'plugin.json', '{}');
    writePluginFile(join(searchA, 'alpha'), 'plugin.json', '{}');
    mkdirSync(join(searchA, 'not-a-plugin'), { recursive: true });
    writeFileSync(join(searchA, 'not-a-plugin', 'README.md'), '# Ignore\n', 'utf8');
    writeFileSync(join(searchA, 'stray-file.txt'), 'ignore', 'utf8');
    mkdirSync(join(searchA, 'dir-manifest', 'plugin.json'), { recursive: true });

    writePluginFile(join(searchB, 'beta'), 'plugin.json', '{}');

    const regularFileAsSearchDir = join(workspace, 'single-file.txt');
    writeFileSync(regularFileAsSearchDir, 'not a dir', 'utf8');

    const entries = discoverPlugins([
      '',
      '   ',
      join(workspace, 'missing-dir'),
      regularFileAsSearchDir,
      searchB,
      searchA,
      searchA,
    ]);

    const expected = [
      {
        dir: join(searchA, 'alpha'),
        manifestPath: join(searchA, 'alpha', 'plugin.json'),
      },
      {
        dir: join(searchA, 'zeta'),
        manifestPath: join(searchA, 'zeta', 'plugin.json'),
      },
      {
        dir: join(searchB, 'beta'),
        manifestPath: join(searchB, 'beta', 'plugin.json'),
      },
    ].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

    expect(entries).toEqual(expected);
  });

  it('skips subdirectories whose plugin.json escapes plugin root when resolved', async () => {
    const workspace = createTempDir('donaron-discover-escape-');
    const searchDir = join(workspace, 'plugins');
    const pluginDir = join(searchDir, 'escaped-plugin');
    const outsideDir = join(workspace, 'outside');
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    const escapedManifest = join(pluginDir, 'plugin.json');
    const outsideManifest = join(outsideDir, 'plugin.json');
    writeFileSync(escapedManifest, '{}', 'utf8');
    writeFileSync(outsideManifest, '{}', 'utf8');

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actualFs = await vi.importActual<typeof nodeFs>('node:fs');
      return {
        ...actualFs,
        realpathSync: Object.assign(
          (targetPath: Parameters<typeof actualFs.realpathSync>[0]) => {
            if (
              typeof targetPath === 'string' &&
              resolve(targetPath) === resolve(escapedManifest)
            ) {
              return outsideManifest;
            }
            return actualFs.realpathSync(targetPath);
          },
          { native: actualFs.realpathSync.native },
        ),
      };
    });

    try {
      const { discoverPlugins: discoverWithMockedFs } = await import('./plugin-loader.js');
      expect(discoverWithMockedFs([searchDir])).toEqual([]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});

describe('loadPlugin', () => {
  it('loads valid-sample with parsed skill, agent, rule, hook, policyPaths, and sha256 digest', () => {
    const result = loadPlugin(VALID_SAMPLE_DIR, { coreVersion: '0.1.0' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const expectedDigest = computePluginDigest(VALID_SAMPLE_DIR, [
      'plugin.json',
      'skills/sample-skill/SKILL.md',
      'skills/sample-skill/references/guide.md',
      'agents/developer.md',
      'rules/security.md',
      'hooks/hooks.json',
      'policies/custom.json',
    ]);

    expect(result.value.rootDir).toBe(VALID_SAMPLE_DIR);
    expect(result.value.manifest.id).toBe('valid-sample');
    expect(result.value.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.digest).toBe(expectedDigest);
    expect(result.value.skills).toHaveLength(1);
    expect(result.value.skills[0]?.name).toBe('sample-skill');
    expect(result.value.skills[0]?.sourcePath).toBe('skills/sample-skill/SKILL.md');
    expect(result.value.skills[0]?.references).toEqual(['skills/sample-skill/references/guide.md']);
    expect(result.value.agents).toHaveLength(1);
    expect(result.value.agents[0]?.name).toBe('developer');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]?.id).toBe('sample-security-rule');
    expect(result.value.hooks).toHaveLength(1);
    expect(result.value.hooks[0]?.id).toBe('sample-policy-guard');
    expect(result.value.toolConfigPaths).toEqual([]);
    expect(result.value.policyPaths).toEqual(['policies/custom.json']);
  });

  it('supports explicit SKILL.md and root "." skill paths, logo, tool configs, and skill scripts without executing scripts', () => {
    const workspace = createTempDir('donaron-load-explicit-');
    const pluginRoot = join(workspace, 'plugin');
    mkdirSync(pluginRoot, { recursive: true });

    const scriptMarker = join(workspace, 'executed.txt');
    writePluginFile(
      pluginRoot,
      'skills/explicit-skill/SKILL.md',
      validSkillMarkdown('explicit-skill', [
        'references:',
        '  - references/notes.md',
        'scripts:',
        '  - scripts/helper.mjs',
      ]),
    );
    writePluginFile(pluginRoot, 'skills/explicit-skill/references/notes.md', '# Notes\n');
    writePluginFile(
      pluginRoot,
      'skills/explicit-skill/scripts/helper.mjs',
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(scriptMarker)}, 'ran');\n`,
    );
    writePluginFile(pluginRoot, 'assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    writePluginFile(pluginRoot, 'tools/mcp.json', '{"mcpServers":{}}\n');
    writePluginFile(pluginRoot, 'policies/extra.json', '{"rules":[]}\n');
    writePluginFile(
      pluginRoot,
      'plugin.json',
      JSON.stringify(
        createManifest(
          'explicit-plugin',
          '1.0.0',
          {
            skills: ['./skills/explicit-skill/SKILL.md'],
            tools: ['./tools\\mcp.json'],
            policies: ['policies/extra.json'],
          },
          { logo: 'assets/logo.svg' },
        ),
      ),
    );

    const first = loadPlugin(pluginRoot);
    expect(first.ok).toBe(true);
    expect(existsSync(scriptMarker)).toBe(false);
    if (!first.ok) {
      return;
    }

    expect(first.value.skills[0]?.sourcePath).toBe('skills/explicit-skill/SKILL.md');
    expect(first.value.skills[0]?.scripts).toEqual([
      { path: 'skills/explicit-skill/scripts/helper.mjs', requiresPolicyApproval: true },
    ]);
    expect(first.value.toolConfigPaths).toEqual(['tools/mcp.json']);
    expect(first.value.policyPaths).toEqual(['policies/extra.json']);

    // Modifying a reference, script, logo, or tool config must alter the plugin digest.
    writePluginFile(
      pluginRoot,
      'skills/explicit-skill/scripts/helper.mjs',
      'console.log("safe");\n',
    );
    const afterScriptEdit = loadPlugin(pluginRoot);
    expect(afterScriptEdit.ok).toBe(true);
    if (afterScriptEdit.ok) {
      expect(afterScriptEdit.value.digest).not.toBe(first.value.digest);
    }

    writePluginFile(pluginRoot, 'assets/logo.svg', '<svg viewBox="0 0 1 1"/>\n');
    const afterLogoEdit = loadPlugin(pluginRoot);
    expect(afterLogoEdit.ok && afterScriptEdit.ok).toBe(true);
    if (afterLogoEdit.ok && afterScriptEdit.ok) {
      expect(afterLogoEdit.value.digest).not.toBe(afterScriptEdit.value.digest);
    }

    const rootSkillPlugin = join(workspace, 'root-skill-plugin');
    writePluginFile(rootSkillPlugin, 'SKILL.md', validSkillMarkdown('root-skill'));
    writePluginFile(
      rootSkillPlugin,
      'plugin.json',
      JSON.stringify(createManifest('root-skill-plugin', '1.0.0', { skills: ['.'] })),
    );
    const rootSkillRes = loadPlugin(rootSkillPlugin);
    expect(rootSkillRes.ok).toBe(true);
    if (rootSkillRes.ok) {
      expect(rootSkillRes.value.skills[0]?.sourcePath).toBe('SKILL.md');
    }
  });

  it('rejects invalid-manifest fixture and incompatible or invalid coreVersion', () => {
    const invalidRes = loadPlugin(INVALID_MANIFEST_DIR);
    expect(invalidRes.ok).toBe(false);
    if (!invalidRes.ok) {
      expect(invalidRes.issues.length).toBeGreaterThan(0);
    }

    const incompatibleRes = loadPlugin(VALID_SAMPLE_DIR, { coreVersion: '2.0.0' });
    expect(incompatibleRes.ok).toBe(false);
    if (!incompatibleRes.ok) {
      expect(incompatibleRes.issues[0]?.code).toBe('INCOMPATIBLE_CORE_VERSION');
    }

    const invalidCoreRes = loadPlugin(VALID_SAMPLE_DIR, { coreVersion: 'not-semver' });
    expect(invalidCoreRes.ok).toBe(false);
    if (!invalidCoreRes.ok) {
      expect(invalidCoreRes.issues[0]?.code).toBe('INCOMPATIBLE_CORE_VERSION');
    }
  });

  it('rejects missing root, non-directory root, missing/directory/malformed plugin.json', () => {
    const workspace = createTempDir('donaron-load-bad-root-');

    expect(loadPlugin(join(workspace, 'does-not-exist')).ok).toBe(false);

    const fileRoot = join(workspace, 'file-root');
    writeFileSync(fileRoot, 'hello', 'utf8');
    expect(loadPlugin(fileRoot).ok).toBe(false);

    const noManifestDir = join(workspace, 'no-manifest');
    mkdirSync(noManifestDir, { recursive: true });
    expect(loadPlugin(noManifestDir).ok).toBe(false);

    const dirManifestRoot = join(workspace, 'dir-manifest');
    mkdirSync(join(dirManifestRoot, 'plugin.json'), { recursive: true });
    expect(loadPlugin(dirManifestRoot).ok).toBe(false);

    const malformedJsonRoot = join(workspace, 'malformed-json');
    writePluginFile(malformedJsonRoot, 'plugin.json', '{ bad json');
    const malformedRes = loadPlugin(malformedJsonRoot);
    expect(malformedRes.ok).toBe(false);
    if (!malformedRes.ok) {
      expect(malformedRes.issues[0]?.code).toBe('MANIFEST_INVALID_JSON');
    }
  });

  it('rejects missing capability files, non-regular-file assets, invalid capability payloads, and non-SKILL.md skill files', () => {
    const workspace = createTempDir('donaron-load-missing-cap-');

    const cases: {
      readonly name: string;
      readonly setup: (root: string) => void;
    }[] = [
      {
        name: 'missing skill directory',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-skill-dir', '1.0.0', { skills: ['skills/nope'] }),
            ),
          );
        },
      },
      {
        name: 'skill directory missing SKILL.md',
        setup: (root) => {
          mkdirSync(join(root, 'skills', 'empty-skill'), { recursive: true });
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('empty-skill-dir', '1.0.0', { skills: ['skills/empty-skill'] }),
            ),
          );
        },
      },
      {
        name: 'regular file not named SKILL.md',
        setup: (root) => {
          writePluginFile(root, 'skills/bad/other.md', validSkillMarkdown('bad'));
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('non-skill-md', '1.0.0', { skills: ['skills/bad/other.md'] }),
            ),
          );
        },
      },
      {
        name: 'invalid skill markdown frontmatter',
        setup: (root) => {
          writePluginFile(root, 'skills/broken/SKILL.md', '---\nname: broken\n---\nBody\n');
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('broken-skill', '1.0.0', { skills: ['skills/broken/SKILL.md'] }),
            ),
          );
        },
      },
      {
        name: 'missing agent file',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-agent', '1.0.0', { agents: ['agents/missing.md'] }),
            ),
          );
        },
      },
      {
        name: 'invalid agent markdown',
        setup: (root) => {
          writePluginFile(root, 'agents/broken.md', 'no frontmatter');
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('broken-agent', '1.0.0', { agents: ['agents/broken.md'] }),
            ),
          );
        },
      },
      {
        name: 'missing rule file',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-rule', '1.0.0', { rules: ['rules/missing.md'] }),
            ),
          );
        },
      },
      {
        name: 'invalid rule markdown',
        setup: (root) => {
          writePluginFile(root, 'rules/broken.md', '---\nid: r1\n---\nBody\n');
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(createManifest('broken-rule', '1.0.0', { rules: ['rules/broken.md'] })),
          );
        },
      },
      {
        name: 'missing hooks file',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-hooks', '1.0.0', { hooks: ['hooks/missing.json'] }),
            ),
          );
        },
      },
      {
        name: 'invalid hooks command property',
        setup: (root) => {
          writePluginFile(
            root,
            'hooks/hooks.json',
            JSON.stringify({
              hooks: [
                {
                  id: 'bad-hook',
                  event: 'PreToolUse',
                  handler: 'policy-guard',
                  timeoutSec: 5,
                  failurePolicy: 'fail_closed',
                  command: 'echo pwn',
                },
              ],
            }),
          );
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(createManifest('bad-hooks', '1.0.0', { hooks: ['hooks/hooks.json'] })),
          );
        },
      },
      {
        name: 'missing tool config',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(createManifest('missing-tool', '1.0.0', { tools: ['tools/mcp.json'] })),
          );
        },
      },
      {
        name: 'directory passed as tool config',
        setup: (root) => {
          mkdirSync(join(root, 'tools', 'mcp.json'), { recursive: true });
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(createManifest('dir-tool', '1.0.0', { tools: ['tools/mcp.json'] })),
          );
        },
      },
      {
        name: 'missing policy file',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-policy', '1.0.0', { policies: ['policies/p.json'] }),
            ),
          );
        },
      },
      {
        name: 'directory passed as policy file',
        setup: (root) => {
          mkdirSync(join(root, 'policies', 'p.json'), { recursive: true });
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('dir-policy', '1.0.0', { policies: ['policies/p.json'] }),
            ),
          );
        },
      },
      {
        name: 'missing logo file',
        setup: (root) => {
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(
              createManifest('missing-logo', '1.0.0', {}, { logo: 'assets/logo.png' }),
            ),
          );
        },
      },
      {
        name: 'directory passed as logo',
        setup: (root) => {
          mkdirSync(join(root, 'assets', 'logo.png'), { recursive: true });
          writePluginFile(
            root,
            'plugin.json',
            JSON.stringify(createManifest('dir-logo', '1.0.0', {}, { logo: 'assets/logo.png' })),
          );
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const root = join(workspace, `case-${String(index)}`);
      mkdirSync(root, { recursive: true });
      testCase.setup(root);
      const res = loadPlugin(root);
      expect(res.ok, `Expected failure for case: ${testCase.name}`).toBe(false);
    }
  });

  it('rejects escaping capability paths resolved outside pluginRoot', async () => {
    const workspace = createTempDir('donaron-load-escape-');
    const pluginRoot = join(workspace, 'plugin');
    const outsideDir = join(workspace, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'escaped.json'), '{"rules":[]}', 'utf8');
    writePluginFile(pluginRoot, 'policies/escaped.json', '{"rules":[]}');
    writePluginFile(
      pluginRoot,
      'plugin.json',
      JSON.stringify(
        createManifest('escape-plugin', '1.0.0', {
          policies: ['policies/escaped.json'],
        }),
      ),
    );

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actualFs = await vi.importActual<typeof nodeFs>('node:fs');
      return {
        ...actualFs,
        realpathSync: Object.assign(
          (targetPath: Parameters<typeof actualFs.realpathSync>[0]) => {
            if (typeof targetPath === 'string' && basename(targetPath) === 'escaped.json') {
              return join(outsideDir, 'escaped.json');
            }
            return actualFs.realpathSync(targetPath);
          },
          { native: actualFs.realpathSync.native },
        ),
      };
    });

    try {
      const { loadPlugin: loadWithMockedFs } = await import('./plugin-loader.js');
      const res = loadWithMockedFs(pluginRoot);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues.some((issue) => issue.code === 'SYMLINK_ESCAPE')).toBe(true);
      }
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('rejects duplicate skill names, agent names, rule ids, and hook ids within the same bundle', () => {
    const workspace = createTempDir('donaron-load-dups-');

    // Duplicate skill name (across dir and explicit SKILL.md)
    const dupSkillRoot = join(workspace, 'dup-skill');
    cpSync(VALID_SAMPLE_DIR, dupSkillRoot, { recursive: true });
    writePluginFile(
      dupSkillRoot,
      'skills/another-dir/SKILL.md',
      validSkillMarkdown('sample-skill'),
    );
    writePluginFile(
      dupSkillRoot,
      'plugin.json',
      JSON.stringify(
        createManifest('dup-skill-plugin', '1.0.0', {
          skills: ['skills/sample-skill', 'skills/another-dir/SKILL.md'],
        }),
      ),
    );
    const dupSkillRes = loadPlugin(dupSkillRoot);
    expect(dupSkillRes.ok).toBe(false);
    if (!dupSkillRes.ok) {
      expect(dupSkillRes.issues.some((issue) => issue.code === 'DUPLICATE_SKILL_NAME')).toBe(true);
    }

    // Duplicate agent name
    const dupAgentRoot = join(workspace, 'dup-agent');
    writePluginFile(dupAgentRoot, 'agents/a1.md', validAgentMarkdown('reviewer'));
    writePluginFile(dupAgentRoot, 'agents/a2.md', validAgentMarkdown('reviewer'));
    writePluginFile(
      dupAgentRoot,
      'plugin.json',
      JSON.stringify(
        createManifest('dup-agent-plugin', '1.0.0', {
          agents: ['agents/a1.md', 'agents/a2.md'],
        }),
      ),
    );
    const dupAgentRes = loadPlugin(dupAgentRoot);
    expect(dupAgentRes.ok).toBe(false);
    if (!dupAgentRes.ok) {
      expect(dupAgentRes.issues.some((issue) => issue.code === 'DUPLICATE_AGENT_NAME')).toBe(true);
    }

    // Duplicate rule id
    const dupRuleRoot = join(workspace, 'dup-rule');
    writePluginFile(dupRuleRoot, 'rules/r1.md', validRuleMarkdown('same-rule-id'));
    writePluginFile(dupRuleRoot, 'rules/r2.md', validRuleMarkdown('same-rule-id'));
    writePluginFile(
      dupRuleRoot,
      'plugin.json',
      JSON.stringify(
        createManifest('dup-rule-plugin', '1.0.0', {
          rules: ['rules/r1.md', 'rules/r2.md'],
        }),
      ),
    );
    const dupRuleRes = loadPlugin(dupRuleRoot);
    expect(dupRuleRes.ok).toBe(false);
    if (!dupRuleRes.ok) {
      expect(dupRuleRes.issues.some((issue) => issue.code === 'DUPLICATE_RULE_ID')).toBe(true);
    }

    // Duplicate hook id across two hook files
    const dupHookRoot = join(workspace, 'dup-hook');
    const hookEntry = {
      id: 'shared-hook-id',
      event: 'PreToolUse',
      handler: 'policy-guard',
      timeoutSec: 10,
      failurePolicy: 'fail_closed',
    };
    writePluginFile(dupHookRoot, 'hooks/h1.json', JSON.stringify({ hooks: [hookEntry] }));
    writePluginFile(
      dupHookRoot,
      'hooks/h2.json',
      JSON.stringify({ hooks: [{ ...hookEntry, event: 'Stop', handler: 'gate-stop-guard' }] }),
    );
    writePluginFile(
      dupHookRoot,
      'plugin.json',
      JSON.stringify(
        createManifest('dup-hook-plugin', '1.0.0', {
          hooks: ['hooks/h1.json', 'hooks/h2.json'],
        }),
      ),
    );
    const dupHookRes = loadPlugin(dupHookRoot);
    expect(dupHookRes.ok).toBe(false);
    if (!dupHookRes.ok) {
      expect(dupHookRes.issues.some((issue) => issue.code === 'DUPLICATE_HOOK_ID')).toBe(true);
    }
  });
});

describe('validatePluginDependencies', () => {
  it('returns an empty list for zero plugins', () => {
    expect(validatePluginDependencies([])).toEqual({ ok: true, value: [] });
  });

  it('validates satisfied dependencies and returns plugins topologically ordered (deps before dependents)', () => {
    const core = createSyntheticLoadedPlugin('plugin-core', '1.2.0');
    const utils = createSyntheticLoadedPlugin('plugin-utils', '2.1.0', [
      { id: 'plugin-core', versionRange: '^1.0.0' },
    ]);
    const auth = createSyntheticLoadedPlugin('plugin-auth', '1.0.0', [
      { id: 'plugin-core', versionRange: '>=1.0.0 <2.0.0' },
    ]);
    const app = createSyntheticLoadedPlugin('plugin-app', '0.5.0', [
      { id: 'plugin-utils', versionRange: '^2.0.0' },
      { id: 'plugin-auth', versionRange: '^1.0.0' },
    ]);

    // Provide dependents before dependencies to confirm topological reordering.
    const result = validatePluginDependencies([app, utils, auth, core]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const orderedIds = result.value.map((plugin) => plugin.manifest.id);
    expect(orderedIds).toHaveLength(4);
    expect(orderedIds.indexOf('plugin-core')).toBeLessThan(orderedIds.indexOf('plugin-utils'));
    expect(orderedIds.indexOf('plugin-core')).toBeLessThan(orderedIds.indexOf('plugin-auth'));
    expect(orderedIds.indexOf('plugin-utils')).toBeLessThan(orderedIds.indexOf('plugin-app'));
    expect(orderedIds.indexOf('plugin-auth')).toBeLessThan(orderedIds.indexOf('plugin-app'));
  });

  it('rejects duplicate plugin IDs', () => {
    const p1 = createSyntheticLoadedPlugin('dup-id', '1.0.0');
    const p2 = createSyntheticLoadedPlugin('dup-id', '2.0.0');

    const result = validatePluginDependencies([p1, p2]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing dependencies and incompatible version ranges without throwing', () => {
    const missingDep = createSyntheticLoadedPlugin('plugin-a', '1.0.0', [
      { id: 'missing-plugin', versionRange: '^1.0.0' },
    ]);
    const missingRes = validatePluginDependencies([missingDep]);
    expect(missingRes.ok).toBe(false);

    const provider = createSyntheticLoadedPlugin('plugin-base', '2.0.0');
    const consumer = createSyntheticLoadedPlugin('plugin-consumer', '1.0.0', [
      { id: 'plugin-base', versionRange: '^1.0.0' },
    ]);
    const mismatchRes = validatePluginDependencies([consumer, provider]);
    expect(mismatchRes.ok).toBe(false);

    const invalidSemverTarget = createSyntheticLoadedPlugin('bad-ver', 'not-semver');
    const badRangeConsumer = createSyntheticLoadedPlugin('bad-range-consumer', '1.0.0', [
      { id: 'bad-ver', versionRange: '???' },
    ]);
    const invalidSemverRes = validatePluginDependencies([badRangeConsumer, invalidSemverTarget]);
    expect(invalidSemverRes.ok).toBe(false);
  });

  it('detects direct and indirect circular dependencies with CIRCULAR_DEPENDENCY', () => {
    const selfA = createSyntheticLoadedPlugin('self-a', '1.0.0', [
      { id: 'self-a', versionRange: '^1.0.0' },
    ]);
    const selfRes = validatePluginDependencies([selfA]);
    expect(selfRes.ok).toBe(false);
    if (!selfRes.ok) {
      expect(selfRes.issues.some((issue) => issue.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    }

    const cycleA = createSyntheticLoadedPlugin('cycle-a', '1.0.0', [
      { id: 'cycle-b', versionRange: '^1.0.0' },
    ]);
    const cycleB = createSyntheticLoadedPlugin('cycle-b', '1.0.0', [
      { id: 'cycle-a', versionRange: '^1.0.0' },
    ]);
    const pairRes = validatePluginDependencies([cycleA, cycleB]);
    expect(pairRes.ok).toBe(false);
    if (!pairRes.ok) {
      expect(pairRes.issues.some((issue) => issue.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    }

    const entry = createSyntheticLoadedPlugin('entry', '1.0.0', [
      { id: 'node-1', versionRange: '^1.0.0' },
    ]);
    const node1 = createSyntheticLoadedPlugin('node-1', '1.0.0', [
      { id: 'node-2', versionRange: '^1.0.0' },
    ]);
    const node2 = createSyntheticLoadedPlugin('node-2', '1.0.0', [
      { id: 'node-1', versionRange: '^1.0.0' },
    ]);
    const indirectRes = validatePluginDependencies([entry, node1, node2]);
    expect(indirectRes.ok).toBe(false);
    if (!indirectRes.ok) {
      expect(indirectRes.issues.some((issue) => issue.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    }
  });
});
