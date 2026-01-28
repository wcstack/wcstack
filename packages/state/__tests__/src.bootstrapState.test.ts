import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/registerComponents', () => ({
  registerComponents: vi.fn()
}));
vi.mock('../src/registerHandler', () => ({
  registerHandler: vi.fn()
}));

import { bootstrapState } from '../src/bootstrapState';
import { registerComponents } from '../src/registerComponents';
import { registerHandler } from '../src/registerHandler';

const registerComponentsMock = vi.mocked(registerComponents);
const registerHandlerMock = vi.mocked(registerHandler);

describe('bootstrapState', () => {
  it('registerComponentsとregisterHandlerを呼ぶこと', () => {
    bootstrapState();
    expect(registerComponentsMock).toHaveBeenCalledTimes(1);
    expect(registerHandlerMock).toHaveBeenCalledTimes(1);
  });
});
