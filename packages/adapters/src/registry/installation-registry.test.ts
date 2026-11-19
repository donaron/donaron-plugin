import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getHarnessAdapter,
  listHarnessAdapters,
  PluginInstallationRegistry,
} from './installation-registry.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'donaron-inst-reg-')));
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

describe('Adapter Registry & PluginInstallationRegistry', () => {
  it('lists and retrieves Antigravity and Claude Code adapters', () => {
    const all = listHarnessAdapters();
    expect(all.map((a) => a.id)).toEqual(['antigravity', 'claude-code']);
    expect(getHarnessAdapter('antigravity').id).toBe('antigravity');
    expect(getHarnessAdapter('claude-code').id).toBe('claude-code');
  });

  it('persists installed plugin receipts, upgrades idempotently, and uninstalls safely', () => {
    const root = createTempDir();
    const registryPath = join(root, '.donaron', 'registry.json');
    const registry = new PluginInstallationRegistry(registryPath);

    expect(registry.listInstalled()).toEqual([]);

    const agyInstallDir = join(root, 'agy-plugins', 'donaron-dev');
    const ccInstallDir = join(root, 'cc-plugins', 'donaron-dev');
    mkdirSync(agyInstallDir, { recursive: true });
    mkdirSync(ccInstallDir, { recursive: true });
    writeFileSync(join(agyInstallDir, 'plugin.json'), '{}', 'utf8');
    writeFileSync(join(ccInstallDir, 'CLAUDE.md'), '# Rules', 'utf8');

    registry.recordInstall({
      harnessId: 'antigravity',
      pluginId: 'donaron.dev',
      pluginName: 'donaron-dev',
      version: '0.1.0',
      installedPath: agyInstallDir,
      sourceDigest: 'sha256:111',
      permissions: ['fs:read', 'cmd:exec'],
      installedAt: '2026-11-19T00:00:00.000Z',
    });

    // Upgrade same (harnessId, pluginName) -> replaces in place rather than duplicating
    registry.recordInstall({
      harnessId: 'antigravity',
      pluginId: 'donaron.dev',
      pluginName: 'donaron-dev',
      version: '0.2.0',
      installedPath: agyInstallDir,
      sourceDigest: 'sha256:222',
      permissions: ['fs:read', 'cmd:exec'],
      installedAt: '2026-11-19T01:00:00.000Z',
    });

    registry.recordInstall({
      harnessId: 'claude-code',
      pluginId: 'donaron.dev',
      pluginName: 'donaron-dev',
      version: '0.2.0',
      installedPath: ccInstallDir,
      sourceDigest: 'sha256:222',
      permissions: ['fs:read', 'cmd:exec'],
      installedAt: '2026-11-19T01:00:00.000Z',
    });

    expect(registry.listInstalled()).toHaveLength(2);
    expect(registry.listInstalled('antigravity')).toHaveLength(1);
    expect(registry.listInstalled('antigravity')[0]?.version).toBe('0.2.0');

    // Rejects path traversal in pluginName
    expect(registry.uninstallPlugin('../escape').ok).toBe(false);

    // Rejects unknown pluginName
    expect(registry.uninstallPlugin('nonexistent-plugin').ok).toBe(false);

    // Uninstalls antigravity copy while preserving claude-code copy
    const uninstalled = registry.uninstallPlugin('donaron-dev', 'antigravity');
    expect(uninstalled.ok).toBe(true);
    if (uninstalled.ok) {
      expect(uninstalled.value).toHaveLength(1);
    }
    expect(existsSync(agyInstallDir)).toBe(false);
    expect(existsSync(ccInstallDir)).toBe(true);
    expect(registry.listInstalled()).toHaveLength(1);
  });
});
