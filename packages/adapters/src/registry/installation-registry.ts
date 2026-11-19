import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ValidationResult } from '@donaron/core';
import { AntigravityAdapter } from '../antigravity/antigravity-adapter.js';
import { ClaudeCodeAdapter } from '../claude-code/claude-code-adapter.js';
import type { HarnessAdapter, HarnessId, InstalledPluginReceipt } from '../types.js';

const ANTIGRAVITY_ADAPTER = new AntigravityAdapter();
const CLAUDE_CODE_ADAPTER = new ClaudeCodeAdapter();

const ADAPTERS_BY_ID: Readonly<Record<HarnessId, HarnessAdapter>> = {
  antigravity: ANTIGRAVITY_ADAPTER,
  'claude-code': CLAUDE_CODE_ADAPTER,
};

const SAFE_PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function getHarnessAdapter(id: HarnessId): HarnessAdapter {
  return ADAPTERS_BY_ID[id];
}

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return [ANTIGRAVITY_ADAPTER, CLAUDE_CODE_ADAPTER];
}

interface RegistryFileFormat {
  readonly version: '1';
  readonly installations: readonly InstalledPluginReceipt[];
}

export class PluginInstallationRegistry {
  readonly registryFilePath: string;

  constructor(registryFilePath: string) {
    this.registryFilePath = resolve(registryFilePath);
  }

  private loadAll(): InstalledPluginReceipt[] {
    if (!existsSync(this.registryFilePath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(this.registryFilePath, 'utf8')) as RegistryFileFormat;
      if (Array.isArray(parsed.installations)) {
        return [...parsed.installations];
      }
    } catch {
      // treat missing/corrupt registry as empty
    }
    return [];
  }

  private saveAll(installations: readonly InstalledPluginReceipt[]): void {
    mkdirSync(dirname(this.registryFilePath), { recursive: true });
    const payload: RegistryFileFormat = {
      version: '1',
      installations,
    };
    writeFileSync(this.registryFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  listInstalled(harnessId?: HarnessId): readonly InstalledPluginReceipt[] {
    const all = this.loadAll();
    if (harnessId === undefined) {
      return all;
    }
    return all.filter((entry) => entry.harnessId === harnessId);
  }

  recordInstall(receipt: InstalledPluginReceipt): void {
    const existing = this.loadAll();
    const filtered = existing.filter(
      (entry) =>
        !(entry.harnessId === receipt.harnessId && entry.pluginName === receipt.pluginName),
    );
    filtered.push(receipt);
    this.saveAll(filtered);
  }

  uninstallPlugin(
    pluginName: string,
    harnessId?: HarnessId,
  ): ValidationResult<readonly InstalledPluginReceipt[]> {
    const trimmed = pluginName.trim();
    if (!SAFE_PLUGIN_NAME_REGEX.test(trimmed) || trimmed.includes('..')) {
      return {
        ok: false,
        issues: [
          {
            code: 'INVALID_PLUGIN_NAME',
            path: 'pluginName',
            message: `Invalid plugin name "${pluginName}".`,
          },
        ],
      };
    }

    const existing = this.loadAll();
    const removed: InstalledPluginReceipt[] = [];
    const remaining: InstalledPluginReceipt[] = [];

    for (const entry of existing) {
      const matchesName = entry.pluginName === trimmed || entry.pluginId === trimmed;
      const matchesHarness = harnessId === undefined || entry.harnessId === harnessId;
      if (matchesName && matchesHarness) {
        removed.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    if (removed.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: 'PLUGIN_NOT_INSTALLED',
            path: 'pluginName',
            message: `Plugin "${trimmed}" is not installed${harnessId !== undefined ? ` for harness "${harnessId}"` : ''}.`,
          },
        ],
      };
    }

    for (const receipt of removed) {
      if (existsSync(receipt.installedPath)) {
        rmSync(receipt.installedPath, { recursive: true, force: true });
      }
    }

    this.saveAll(remaining);
    return { ok: true, value: removed };
  }
}
