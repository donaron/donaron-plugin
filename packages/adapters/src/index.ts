import { getCoreModuleInfo, type ModuleInfo } from '@donaron/core';
import { getGatesModuleInfo } from '@donaron/gates';

export const DONARON_ADAPTERS_VERSION = '0.1.0';

export function getAdaptersModuleInfo(): ModuleInfo {
  const core = getCoreModuleInfo();
  const gates = getGatesModuleInfo();
  return {
    name: '@donaron/adapters',
    version: DONARON_ADAPTERS_VERSION,
    dependencies: [`${core.name}@${core.version}`, `${gates.name}@${gates.version}`],
  };
}
