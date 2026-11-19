export interface ModuleInfo {
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

export const DONARON_CORE_VERSION = '0.1.0';

export function getCoreModuleInfo(): ModuleInfo {
  return {
    name: '@donaron/core',
    version: DONARON_CORE_VERSION,
    dependencies: [],
  };
}
