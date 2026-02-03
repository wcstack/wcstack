import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { __private__ } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';
import { IAbsoluteStateAddress } from '../src/address/types';

vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

const { Updater } = __private__;

describe('updater/updater coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setStateElementByName('test', null);
  });

  it('_applyChange時にstateElementが見つからない場合はエラーになること', () => {
    // stateElementが存在しない状態でtestApplyChangeを呼ぶ
    const updater = new Updater();
    
    const mockAbsoluteAddress: IAbsoluteStateAddress = {
      stateName: 'nonexistent',
      address: { pathInfo: { path: 'count' } } as any,
    };

    expect(() => updater.testApplyChange([mockAbsoluteAddress]))
      .toThrow(/State element with name "nonexistent" not found for updater/);
  });
});
