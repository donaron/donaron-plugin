import { describe, expect, it } from 'vitest';
import { DONARON_GATES_VERSION, getGatesModuleInfo } from './index.js';

describe('@donaron/gates baseline', () => {
  it('returns gates module metadata resolving @donaron/core', () => {
    expect(getGatesModuleInfo()).toEqual({
      name: '@donaron/gates',
      version: DONARON_GATES_VERSION,
      dependencies: ['@donaron/core@0.1.0'],
    });
  });
});
