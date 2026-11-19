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
