import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { __private__ } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';
import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { IAbsoluteStateAddress } from '../src/address/types';

vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

const { Updater } = __private__;
const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

describe('updater/updater coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setStateElementByName(document, 'test', null);
  });

  it('_applyChangeでbindingが無い場合は空配列でapplyChangeFromBindingsが呼ばれること', () => {
    const updater = new Updater();

    const mockAbsoluteAddress: IAbsoluteStateAddress = {
      stateName: 'nonexistent',
      address: { pathInfo: { path: 'count' } } as any,
    };

    expect(() => updater.testApplyChange([mockAbsoluteAddress])).not.toThrow();
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([]);
  });
});
