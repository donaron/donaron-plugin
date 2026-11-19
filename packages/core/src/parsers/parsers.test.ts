import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAgentFile } from './agent-parser.js';
import { parseMarkdownFrontmatter } from './frontmatter.js';
import { parseHooksFile } from './hook-parser.js';
import { parseRuleFile } from './rule-parser.js';
import { parseSkillFile } from './skill-parser.js';

const tempDirs: string[] = [];

function createTempPluginDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function writePluginFile(pluginRoot: string, relativePath: string, content: string): void {
  const fullPath = join(pluginRoot, ...relativePath.split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('parseMarkdownFrontmatter', () => {
  it('parses valid LF, CRLF, and UTF-8 BOM frontmatter cleanly and consistently', () => {
    const lfInput = [
      '---',
      'name: node-react-planning',
      'tags:',
      '  - planning',
      '  - strict',
      '---',
      '',
      '# Planning Skill',
      '',
      'Follow the checklist --- carefully.',
      '',
    ].join('\n');

    const crlfInput = lfInput.replaceAll('\n', '\r\n');
    const bomCrlfInput = `\uFEFF${crlfInput}`;

    const lfResult = parseMarkdownFrontmatter(lfInput);
    const crlfResult = parseMarkdownFrontmatter(crlfInput);
    const bomResult = parseMarkdownFrontmatter(bomCrlfInput);

    expect(lfResult.ok).toBe(true);
    expect(crlfResult).toEqual(lfResult);
    expect(bomResult).toEqual(lfResult);

    if (lfResult.ok) {
      expect(lfResult.value.data).toEqual({
        name: 'node-react-planning',
        tags: ['planning', 'strict'],
      });
      expect(lfResult.value.body).toContain('# Planning Skill');
      expect(lfResult.value.body).toContain('Follow the checklist --- carefully.');
    }
  });

  it('ignores horizontal rule delimiters inside the markdown body', () => {
    const input = ['---', 'id: rule-1', '---', '# Title', '---', 'Second section'].join('\n');

    const result = parseMarkdownFrontmatter(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toEqual({ id: 'rule-1' });
      expect(result.value.body).toBe('# Title\n---\nSecond section');
    }
  });

  it('rejects missing frontmatter, leading blank lines, and unclosed frontmatter', () => {
    for (const missing of [
      '',
      '# Just markdown\n',
      '\n---\nid: late\n---\nBody\n',
      '---not-a-fence\n',
    ]) {
      const result = parseMarkdownFrontmatter(missing);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    }

    const trailingFenceSpace = ['---   ', 'id: spaced', '---  ', 'Body'].join('\n');
    expect(parseMarkdownFrontmatter(trailingFenceSpace)).toEqual({
      ok: true,
      value: { data: { id: 'spaced' }, body: 'Body' },
    });

    const unclosed = ['---', 'id: unclosed', 'scope: repo', '# Forgot closing fence'].join('\n');
    const unclosedResult = parseMarkdownFrontmatter(unclosed);
    expect(unclosedResult.ok).toBe(false);
    if (!unclosedResult.ok) {
      expect(unclosedResult.issues[0]?.code).toBe('FRONTMATTER_UNCLOSED');
    }
  });

  it('rejects invalid YAML syntax, duplicate keys, and non-object YAML values', () => {
    const badYaml = ['---', 'name: [unclosed', '---', 'Body'].join('\n');
    const badYamlRes = parseMarkdownFrontmatter(badYaml);
    expect(badYamlRes.ok).toBe(false);
    if (!badYamlRes.ok) {
      expect(badYamlRes.issues[0]?.code).toBe('FRONTMATTER_INVALID_YAML');
    }

    const duplicateKeys = ['---', 'name: first', 'name: second', '---', 'Body'].join('\n');
    expect(parseMarkdownFrontmatter(duplicateKeys).ok).toBe(false);

    for (const nonObjectYaml of [
      '- item',
      '"scalar string"',
      '42',
      'true',
      '!!timestamp 2026-11-19',
      '# only comment',
      '',
    ]) {
      const doc = ['---', nonObjectYaml, '---', 'Body'].join('\n');
      const res = parseMarkdownFrontmatter(doc);
      expect(res.ok, `Expected non-object YAML to fail: ${nonObjectYaml}`).toBe(false);
      if (!res.ok) {
        expect(res.issues[0]?.code).toBe('FRONTMATTER_NOT_OBJECT');
      }
    }
  });
});

describe('parseSkillFile', () => {
  function validSkillContent(extraLines: readonly string[] = []): string {
    return [
      '---',
      'name: node-react-planning',
      'description: Produces strict implementation plans for Node + React.',
      'purpose: Ensure requirements and architecture are verified before coding.',
      'activation: When planning a new feature or architectural change.',
      'inputs:',
      '  - User prompt',
      'outputs:',
      '  - Approved plan markdown',
      'constraints:',
      '  - Never skip Gate 01',
      'completionCriteria:',
      '  - Acceptance criteria are testable',
      ...extraLines,
      '---',
      '',
      '# Node + React Planning',
      '',
      'Analyze requirements thoroughly before writing code.',
      '',
    ].join('\n');
  }

  it('parses a valid skill with references and scripts marked requiresPolicyApproval: true', () => {
    const pluginRoot = createTempPluginDir('donaron-skill-valid-');
    writePluginFile(
      pluginRoot,
      'skills/planning/references/checklist.md',
      '# Checklist\n- Verify inputs\n',
    );
    writePluginFile(pluginRoot, 'skills/planning/scripts/verify-plan.mjs', 'console.log("ok");\n');
    writePluginFile(
      pluginRoot,
      'skills/planning/SKILL.md',
      validSkillContent([
        'version: "1.0.0"',
        'references:',
        '  - ./references/checklist.md',
        'scripts:',
        '  - scripts/verify-plan.mjs',
      ]),
    );

    const result = parseSkillFile(pluginRoot, './skills\\planning/SKILL.md');
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'node-react-planning',
        description: 'Produces strict implementation plans for Node + React.',
        purpose: 'Ensure requirements and architecture are verified before coding.',
        activation: 'When planning a new feature or architectural change.',
        inputs: ['User prompt'],
        outputs: ['Approved plan markdown'],
        constraints: ['Never skip Gate 01'],
        completionCriteria: ['Acceptance criteria are testable'],
        references: ['skills/planning/references/checklist.md'],
        scripts: [
          {
            path: 'skills/planning/scripts/verify-plan.mjs',
            requiresPolicyApproval: true,
          },
        ],
        version: '1.0.0',
        body: '# Node + React Planning\n\nAnalyze requirements thoroughly before writing code.',
        sourcePath: 'skills/planning/SKILL.md',
      },
    });
  });

  it('defaults optional references and scripts to empty arrays and omits absent version', () => {
    const pluginRoot = createTempPluginDir('donaron-skill-minimal-');
    writePluginFile(pluginRoot, 'skills/minimal/SKILL.md', validSkillContent());

    const result = parseSkillFile(pluginRoot, 'skills/minimal/SKILL.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.references).toEqual([]);
      expect(result.value.scripts).toEqual([]);
      expect('version' in result.value).toBe(false);
    }
  });

  it('rejects missing required fields, unknown keys, invalid optional fields, and empty body', () => {
    const pluginRoot = createTempPluginDir('donaron-skill-invalid-');

    const missingField = [
      '---',
      'name: incomplete-skill',
      'description: Missing several required fields',
      '---',
      'Body text.',
    ].join('\n');
    writePluginFile(pluginRoot, 'skills/missing/SKILL.md', missingField);
    const missingRes = parseSkillFile(pluginRoot, 'skills/missing/SKILL.md');
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.issues.length).toBeGreaterThanOrEqual(6);
    }

    writePluginFile(
      pluginRoot,
      'skills/unknown/SKILL.md',
      validSkillContent(['unexpectedKey: true']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/unknown/SKILL.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'skills/blank-version/SKILL.md',
      validSkillContent(['version: "   "']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/blank-version/SKILL.md').ok).toBe(false);

    const emptyBody = validSkillContent().replace(
      '# Node + React Planning\n\nAnalyze requirements thoroughly before writing code.',
      '   \n\t',
    );
    writePluginFile(pluginRoot, 'skills/empty-body/SKILL.md', emptyBody);
    expect(parseSkillFile(pluginRoot, 'skills/empty-body/SKILL.md').ok).toBe(false);
  });

  it('rejects references and scripts that escape pluginRoot or do not exist or point to directories', () => {
    const workspace = createTempPluginDir('donaron-skill-escape-');
    const pluginRoot = join(workspace, 'plugin');
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(join(workspace, 'secret.txt'), 'TOP_SECRET', 'utf8');
    mkdirSync(join(pluginRoot, 'skills', 'bad', 'references'), { recursive: true });

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-ref-escape.md',
      validSkillContent(['references:', '  - ../../../secret.txt']),
    );
    const refEscape = parseSkillFile(pluginRoot, 'skills/bad/SKILL-ref-escape.md');
    expect(refEscape.ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-script-escape.md',
      validSkillContent(['scripts:', '  - ../../../secret.txt']),
    );
    const scriptEscape = parseSkillFile(pluginRoot, 'skills/bad/SKILL-script-escape.md');
    expect(scriptEscape.ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-nested-dotdot.md',
      validSkillContent(['references:', '  - references/../../secret.txt']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/bad/SKILL-nested-dotdot.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-abs.md',
      validSkillContent(['scripts:', '  - /etc/passwd']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/bad/SKILL-abs.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-missing-ref.md',
      validSkillContent(['references:', '  - references/does-not-exist.md']),
    );
    const missingRef = parseSkillFile(pluginRoot, 'skills/bad/SKILL-missing-ref.md');
    expect(missingRef.ok).toBe(false);
    if (!missingRef.ok) {
      expect(missingRef.issues[0]?.code).toBe('PATH_NOT_FOUND');
    }

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-dir-ref.md',
      validSkillContent(['references:', '  - references']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/bad/SKILL-dir-ref.md').ok).toBe(false);

    for (const badAsset of [
      'C:\\evil.txt',
      'references/foo\0bar.md',
      'https://example.com/ref.md',
    ]) {
      writePluginFile(
        pluginRoot,
        'skills/bad/SKILL-unsafe-asset.md',
        validSkillContent(['references:', `  - ${JSON.stringify(badAsset)}`]),
      );
      expect(parseSkillFile(pluginRoot, 'skills/bad/SKILL-unsafe-asset.md').ok).toBe(false);
    }

    writePluginFile(
      pluginRoot,
      'skills/bad/SKILL-bad-arrays.md',
      validSkillContent(['references: "not-an-array"', 'scripts:', '  - "   "']),
    );
    expect(parseSkillFile(pluginRoot, 'skills/bad/SKILL-bad-arrays.md').ok).toBe(false);

    expect(parseSkillFile(pluginRoot, 'skills/bad').ok).toBe(false);
    expect(parseSkillFile(pluginRoot, '../outside.md').ok).toBe(false);
    expect(parseSkillFile(pluginRoot, 'skills/bad/MISSING.md').ok).toBe(false);
  });

  it('resolves root-level skill assets and safe sibling references inside pluginRoot', () => {
    const pluginRoot = createTempPluginDir('donaron-skill-root-');
    writePluginFile(pluginRoot, 'references/guide.md', '# Guide\n');
    writePluginFile(pluginRoot, 'shared/common.md', '# Common\n');
    writePluginFile(pluginRoot, 'scripts/check.mjs', 'export {};\n');
    writePluginFile(
      pluginRoot,
      'SKILL.md',
      validSkillContent([
        'references:',
        '  - references/guide.md',
        'scripts:',
        '  - ./scripts/check.mjs',
      ]),
    );
    writePluginFile(
      pluginRoot,
      'skills/sub/SKILL.md',
      validSkillContent(['references:', '  - ../../shared/common.md']),
    );

    const rootRes = parseSkillFile(pluginRoot, 'SKILL.md');
    expect(rootRes.ok).toBe(true);
    if (rootRes.ok) {
      expect(rootRes.value.references).toEqual(['references/guide.md']);
      expect(rootRes.value.scripts).toEqual([
        { path: 'scripts/check.mjs', requiresPolicyApproval: true },
      ]);
    }

    const siblingRes = parseSkillFile(pluginRoot, 'skills/sub/SKILL.md');
    expect(siblingRes.ok).toBe(true);
    if (siblingRes.ok) {
      expect(siblingRes.value.references).toEqual(['shared/common.md']);
    }
  });
});

describe('parseAgentFile', () => {
  function validAgentContent(overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
      name: 'code-reviewer',
      role: 'Independent Final Code Reviewer',
      description: 'Performs Gate 05 final verification of code, tests, and evidence.',
      responsibilities: '\n  - Review diffs against plan and acceptance criteria',
      nonResponsibilities: '\n  - Never modify production files directly',
      skills: '\n  - code-review',
      tools: '\n  - read_file\n  - grep_search',
      permissionProfile: 'readonly',
      modelTier: 'reasoning',
      inputContract: 'Run ID, diff summary, and Gate 01-04 evidence paths',
      outputContract: 'Structured Gate 05 decision JSON',
      handoffConditions: '\n  - Escalate to human when critical findings remain after maxRetries',
      maxRetries: '3',
      requiresHumanApproval: 'false',
      ...overrides,
    };

    const lines = ['---'];
    for (const [key, value] of Object.entries(fields)) {
      lines.push(`${key}:${value.startsWith('\n') ? value : ` ${value}`}`);
    }
    lines.push('---', '', 'You are the independent code reviewer.', '');
    return lines.join('\n');
  }

  it('parses valid agent definitions across all allowed modelTier values and retry bounds', () => {
    const pluginRoot = createTempPluginDir('donaron-agent-valid-');

    for (const [index, tier] of (['fast', 'balanced', 'reasoning'] as const).entries()) {
      const retries = index === 0 ? '0' : index === 1 ? '20' : '3';
      const relPath = `agents/agent-${tier}.md`;
      writePluginFile(
        pluginRoot,
        relPath,
        validAgentContent({
          modelTier: tier,
          maxRetries: retries,
          requiresHumanApproval: index === 2 ? 'true' : 'false',
        }),
      );

      const res = parseAgentFile(pluginRoot, relPath);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.modelTier).toBe(tier);
        expect(res.value.maxRetries).toBe(Number(retries));
        expect(res.value.requiresHumanApproval).toBe(index === 2);
        expect(res.value.sourcePath).toBe(relPath);
        expect(res.value.body).toBe('You are the independent code reviewer.');
      }
    }
  });

  it('rejects invalid modelTier, negative or excessive maxRetries, missing nonResponsibilities, and unknown keys', () => {
    const pluginRoot = createTempPluginDir('donaron-agent-invalid-');

    writePluginFile(pluginRoot, 'agents/bad-tier.md', validAgentContent({ modelTier: 'gpt-4' }));
    expect(parseAgentFile(pluginRoot, 'agents/bad-tier.md').ok).toBe(false);

    writePluginFile(pluginRoot, 'agents/neg-retries.md', validAgentContent({ maxRetries: '-1' }));
    expect(parseAgentFile(pluginRoot, 'agents/neg-retries.md').ok).toBe(false);

    writePluginFile(pluginRoot, 'agents/high-retries.md', validAgentContent({ maxRetries: '21' }));
    expect(parseAgentFile(pluginRoot, 'agents/high-retries.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'agents/float-retries.md',
      validAgentContent({ maxRetries: '1.5' }),
    );
    expect(parseAgentFile(pluginRoot, 'agents/float-retries.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'agents/bad-approval.md',
      validAgentContent({ requiresHumanApproval: '"false"' }),
    );
    expect(parseAgentFile(pluginRoot, 'agents/bad-approval.md').ok).toBe(false);

    const missingNonResp = validAgentContent().replace(
      'nonResponsibilities:\n  - Never modify production files directly\n',
      '',
    );
    writePluginFile(pluginRoot, 'agents/missing-nonresp.md', missingNonResp);
    expect(parseAgentFile(pluginRoot, 'agents/missing-nonresp.md').ok).toBe(false);

    writePluginFile(pluginRoot, 'agents/unknown-key.md', validAgentContent({ temperature: '0.1' }));
    expect(parseAgentFile(pluginRoot, 'agents/unknown-key.md').ok).toBe(false);

    const emptyBody = validAgentContent().replace('You are the independent code reviewer.', '   ');
    writePluginFile(pluginRoot, 'agents/empty-body.md', emptyBody);
    expect(parseAgentFile(pluginRoot, 'agents/empty-body.md').ok).toBe(false);
  });
});

describe('parseRuleFile', () => {
  it('parses valid rule files for all supported categories', () => {
    const pluginRoot = createTempPluginDir('donaron-rule-valid-');

    for (const [index, category] of (
      ['routing', 'security', 'development', 'writing'] as const
    ).entries()) {
      const relPath = `rules/${category}.md`;
      const content = [
        '---',
        `id: rule-${category}`,
        `category: ${category}`,
        'scope: repository',
        `priority: ${String((index + 1) * 10)}`,
        '---',
        '',
        `Follow ${category} guidance strictly.`,
        '',
      ].join('\n');
      writePluginFile(pluginRoot, relPath, content);

      const res = parseRuleFile(pluginRoot, relPath);
      expect(res).toEqual({
        ok: true,
        value: {
          id: `rule-${category}`,
          category,
          scope: 'repository',
          priority: (index + 1) * 10,
          body: `Follow ${category} guidance strictly.`,
          sourcePath: relPath,
        },
      });
    }
  });

  it('rejects invalid category, non-integer priority, empty body, and unknown keys including enforcement', () => {
    const pluginRoot = createTempPluginDir('donaron-rule-invalid-');

    writePluginFile(
      pluginRoot,
      'rules/bad-category.md',
      [
        '---',
        'id: r1',
        'category: compliance',
        'scope: repository',
        'priority: 10',
        '---',
        'Guidance.',
      ].join('\n'),
    );
    expect(parseRuleFile(pluginRoot, 'rules/bad-category.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'rules/enforcement.md',
      [
        '---',
        'id: r2',
        'category: security',
        'scope: repository',
        'priority: 100',
        'enforcement: policy',
        '---',
        'Do not enforce policy via markdown rules.',
      ].join('\n'),
    );
    const enforcementRes = parseRuleFile(pluginRoot, 'rules/enforcement.md');
    expect(enforcementRes.ok).toBe(false);
    if (!enforcementRes.ok) {
      expect(enforcementRes.issues.some((issue) => issue.path === '/enforcement')).toBe(true);
    }

    writePluginFile(
      pluginRoot,
      'rules/float-priority.md',
      [
        '---',
        'id: r3',
        'category: writing',
        'scope: docs',
        'priority: 1.5',
        '---',
        'Write clearly.',
      ].join('\n'),
    );
    expect(parseRuleFile(pluginRoot, 'rules/float-priority.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'rules/empty-body.md',
      ['---', 'id: r4', 'category: routing', 'scope: all', 'priority: 1', '---', '   '].join('\n'),
    );
    expect(parseRuleFile(pluginRoot, 'rules/empty-body.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'rules/missing-fields.md',
      ['---', 'id: "   "', 'scope: ""', '---', 'Guidance.'].join('\n'),
    );
    expect(parseRuleFile(pluginRoot, 'rules/missing-fields.md').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'rules/negative-priority.md',
      ['---', 'id: r5', 'category: routing', 'scope: all', 'priority: -5', '---', 'Guidance.'].join(
        '\n',
      ),
    );
    const negRes = parseRuleFile(pluginRoot, 'rules/negative-priority.md');
    expect(negRes.ok).toBe(true);
    if (negRes.ok) {
      expect(negRes.value.priority).toBe(-5);
    }
  });
});

describe('parseHooksFile', () => {
  it('parses valid declarative hooks JSON and defaults enabled to true', () => {
    const pluginRoot = createTempPluginDir('donaron-hooks-valid-');
    writePluginFile(
      pluginRoot,
      'hooks/hooks.json',
      `\uFEFF${JSON.stringify(
        {
          hooks: [
            {
              id: 'session-init',
              event: 'SessionStart',
              handler: 'session-context',
              timeoutSec: 1,
              failurePolicy: 'warn',
            },
            {
              id: 'guard-tools',
              event: 'PreToolUse',
              handler: 'policy-guard',
              matcher: 'run_command|write_file',
              timeoutSec: 120,
              failurePolicy: 'fail_closed',
              enabled: false,
            },
            {
              id: 'track-edits',
              event: 'PostToolUse',
              handler: 'stale-tracker',
              timeoutSec: 15,
              failurePolicy: 'warn',
            },
            {
              id: 'gate-stop',
              event: 'Stop',
              handler: 'gate-stop-guard',
              timeoutSec: 10,
              failurePolicy: 'fail_closed',
            },
          ],
        },
        null,
        2,
      )}`,
    );

    const res = parseHooksFile(pluginRoot, 'hooks/hooks.json');
    expect(res).toEqual({
      ok: true,
      value: [
        {
          id: 'session-init',
          event: 'SessionStart',
          handler: 'session-context',
          timeoutSec: 1,
          failurePolicy: 'warn',
          enabled: true,
        },
        {
          id: 'guard-tools',
          event: 'PreToolUse',
          handler: 'policy-guard',
          matcher: 'run_command|write_file',
          timeoutSec: 120,
          failurePolicy: 'fail_closed',
          enabled: false,
        },
        {
          id: 'track-edits',
          event: 'PostToolUse',
          handler: 'stale-tracker',
          timeoutSec: 15,
          failurePolicy: 'warn',
          enabled: true,
        },
        {
          id: 'gate-stop',
          event: 'Stop',
          handler: 'gate-stop-guard',
          timeoutSec: 10,
          failurePolicy: 'fail_closed',
          enabled: true,
        },
      ],
    });
  });

  it('rejects arbitrary command fields, unknown handlers, invalid events, out-of-range timeouts, duplicate ids, unknown keys, and malformed JSON', () => {
    const pluginRoot = createTempPluginDir('donaron-hooks-invalid-');

    const baseHook = {
      id: 'h1',
      event: 'PreToolUse',
      handler: 'policy-guard',
      timeoutSec: 10,
      failurePolicy: 'fail_closed',
    };

    writePluginFile(
      pluginRoot,
      'hooks/arbitrary-command.json',
      JSON.stringify({ hooks: [{ ...baseHook, command: 'rm -rf /' }] }),
    );
    expect(parseHooksFile(pluginRoot, 'hooks/arbitrary-command.json').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'hooks/unknown-handler.json',
      JSON.stringify({ hooks: [{ ...baseHook, handler: 'rm -rf /' }] }),
    );
    expect(parseHooksFile(pluginRoot, 'hooks/unknown-handler.json').ok).toBe(false);

    writePluginFile(
      pluginRoot,
      'hooks/invalid-event.json',
      JSON.stringify({ hooks: [{ ...baseHook, event: 'OnSave' }] }),
    );
    expect(parseHooksFile(pluginRoot, 'hooks/invalid-event.json').ok).toBe(false);

    for (const badTimeout of [0, 300, 1.5, '10']) {
      writePluginFile(
        pluginRoot,
        'hooks/bad-timeout.json',
        JSON.stringify({ hooks: [{ ...baseHook, timeoutSec: badTimeout }] }),
      );
      expect(
        parseHooksFile(pluginRoot, 'hooks/bad-timeout.json').ok,
        `Expected timeout ${String(badTimeout)} to fail`,
      ).toBe(false);
    }

    writePluginFile(
      pluginRoot,
      'hooks/duplicate-ids.json',
      JSON.stringify({
        hooks: [baseHook, { ...baseHook, event: 'Stop', handler: 'gate-stop-guard' }],
      }),
    );
    const dupRes = parseHooksFile(pluginRoot, 'hooks/duplicate-ids.json');
    expect(dupRes.ok).toBe(false);
    if (!dupRes.ok) {
      expect(dupRes.issues.some((issue) => issue.code === 'HOOK_DUPLICATE_ID')).toBe(true);
    }

    writePluginFile(
      pluginRoot,
      'hooks/top-extra.json',
      JSON.stringify({ hooks: [baseHook], extra: true }),
    );
    expect(parseHooksFile(pluginRoot, 'hooks/top-extra.json').ok).toBe(false);

    writePluginFile(pluginRoot, 'hooks/malformed.json', '{ "hooks": [ ');
    const malformedRes = parseHooksFile(pluginRoot, 'hooks/malformed.json');
    expect(malformedRes.ok).toBe(false);
    if (!malformedRes.ok) {
      expect(malformedRes.issues[0]?.code).toBe('HOOKS_INVALID_JSON');
    }

    writePluginFile(pluginRoot, 'hooks/empty.json', JSON.stringify({ hooks: [] }));
    expect(parseHooksFile(pluginRoot, 'hooks/empty.json')).toEqual({ ok: true, value: [] });

    for (const invalidPayload of [
      [],
      null,
      'string',
      {},
      { hooks: 'not-array' },
      { hooks: [null] },
      { hooks: [{ ...baseHook, failurePolicy: 'ignore' }] },
      { hooks: [{ ...baseHook, matcher: '   ' }] },
      { hooks: [{ ...baseHook, enabled: 'true' }] },
      { hooks: [{ ...baseHook, id: '' }] },
    ]) {
      writePluginFile(pluginRoot, 'hooks/invalid-shape.json', JSON.stringify(invalidPayload));
      expect(parseHooksFile(pluginRoot, 'hooks/invalid-shape.json').ok).toBe(false);
    }

    expect(parseHooksFile(pluginRoot, 'hooks').ok).toBe(false);
    expect(parseHooksFile(pluginRoot, '../hooks.json').ok).toBe(false);
    expect(parseHooksFile(pluginRoot, 'hooks/missing.json').ok).toBe(false);
  });
});
