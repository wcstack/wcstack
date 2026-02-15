import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/registerComponents', () => ({
  registerComponents: vi.fn()
}));

import { bootstrapState } from '../src/bootstrapState';
import { registerComponents } from '../src/registerComponents';

const registerComponentsMock = vi.mocked(registerComponents);

describe('bootstrapState', () => {
  it('registerComponentsを呼ぶこと', () => {
    bootstrapState();
    expect(registerComponentsMock).toHaveBeenCalledTimes(1);
  });
});
