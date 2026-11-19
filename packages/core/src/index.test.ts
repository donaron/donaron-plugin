import { describe, expect, it } from 'vitest';
import { DONARON_CORE_VERSION, getCoreModuleInfo } from './index.js';

describe('@donaron/core baseline', () => {
  it('returns core module metadata with zero internal dependencies', () => {
    expect(getCoreModuleInfo()).toEqual({
      name: '@donaron/core',
      version: DONARON_CORE_VERSION,
      dependencies: [],
    });
  });
});
