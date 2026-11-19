import { describe, expect, it } from 'vitest';
import { DONARON_ADAPTERS_VERSION, getAdaptersModuleInfo } from './index.js';

describe('@donaron/adapters baseline', () => {
  it('returns adapters module metadata resolving @donaron/core and @donaron/gates', () => {
    expect(getAdaptersModuleInfo()).toEqual({
      name: '@donaron/adapters',
      version: DONARON_ADAPTERS_VERSION,
      dependencies: ['@donaron/core@0.1.0', '@donaron/gates@0.1.0'],
    });
  });
});
