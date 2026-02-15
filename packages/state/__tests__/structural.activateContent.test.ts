import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));
vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => ({
  getAbsoluteStateAddressByBinding: vi.fn(),
  clearAbsoluteStateAddressByBinding: vi.fn()
}));
vi.mock('../src/binding/getBindingSetByAbsoluteStateAddress', () => ({
  addBindingByAbsoluteStateAddress: vi.fn(),
  removeBindingByAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/binding/getStateAddressByBindingInfo', () => ({
  clearStateAddressByBindingInfo: vi.fn()
}));
vi.mock('../src/bindings/bindingsByContent', () => ({
  getBindingsByContent: vi.fn()
}));
vi.mock('../src/bindings/bindLoopContextToContent', () => ({
  bindLoopContextToContent: vi.fn(),
  unbindLoopContextToContent: vi.fn()
}));

import { activateContent, deactivateContent } from '../src/structural/activateContent';
import { applyChange } from '../src/apply/applyChange';
import { getAbsoluteStateAddressByBinding, clearAbsoluteStateAddressByBinding } from '../src/binding/getAbsoluteStateAddressByBinding';
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from '../src/binding/getBindingSetByAbsoluteStateAddress';
import { clearStateAddressByBindingInfo } from '../src/binding/getStateAddressByBindingInfo';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { bindLoopContextToContent, unbindLoopContextToContent } from '../src/bindings/bindLoopContextToContent';

const applyChangeMock = vi.mocked(applyChange);
const getAbsoluteStateAddressByBindingMock = vi.mocked(getAbsoluteStateAddressByBinding);
const clearAbsoluteStateAddressByBindingMock = vi.mocked(clearAbsoluteStateAddressByBinding);
const addBindingByAbsoluteStateAddressMock = vi.mocked(addBindingByAbsoluteStateAddress);
const removeBindingByAbsoluteStateAddressMock = vi.mocked(removeBindingByAbsoluteStateAddress);
const clearStateAddressByBindingInfoMock = vi.mocked(clearStateAddressByBindingInfo);
const getBindingsByContentMock = vi.mocked(getBindingsByContent);
const bindLoopContextToContentMock = vi.mocked(bindLoopContextToContent);
const unbindLoopContextToContentMock = vi.mocked(unbindLoopContextToContent);

describe('activateContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('activateContent', () => {
    it('バインディングを登録して変更を適用すること', () => {
      const content = { mounted: true } as any;
      const loopContext = { index: 0 } as any;
      const context = {} as any;
      const binding1 = { id: 1 } as any;
      const binding2 = { id: 2 } as any;
      const absAddress1 = { path: 'path1' } as any;
      const absAddress2 = { path: 'path2' } as any;

      getBindingsByContentMock.mockReturnValue([binding1, binding2]);
      getAbsoluteStateAddressByBindingMock
        .mockReturnValueOnce(absAddress1)
        .mockReturnValueOnce(absAddress2);

      activateContent(content, loopContext, context);

      expect(bindLoopContextToContentMock).toHaveBeenCalledWith(content, loopContext);
      expect(getBindingsByContentMock).toHaveBeenCalledWith(content);
      expect(getAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding1);
      expect(getAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding2);
      expect(addBindingByAbsoluteStateAddressMock).toHaveBeenCalledWith(absAddress1, binding1);
      expect(addBindingByAbsoluteStateAddressMock).toHaveBeenCalledWith(absAddress2, binding2);
      expect(applyChangeMock).toHaveBeenCalledWith(binding1, context);
      expect(applyChangeMock).toHaveBeenCalledWith(binding2, context);
    });

    it('loopContextがnullでも動作すること', () => {
      const content = { mounted: true } as any;
      const context = {} as any;
      const binding = { id: 1 } as any;
      const absAddress = { path: 'path1' } as any;

      getBindingsByContentMock.mockReturnValue([binding]);
      getAbsoluteStateAddressByBindingMock.mockReturnValue(absAddress);

      activateContent(content, null, context);

      expect(bindLoopContextToContentMock).toHaveBeenCalledWith(content, null);
      expect(applyChangeMock).toHaveBeenCalledWith(binding, context);
    });

    it('バインディングが空配列でも動作すること', () => {
      const content = { mounted: true } as any;
      const loopContext = { index: 0 } as any;
      const context = {} as any;

      getBindingsByContentMock.mockReturnValue([]);

      activateContent(content, loopContext, context);

      expect(bindLoopContextToContentMock).toHaveBeenCalledWith(content, loopContext);
      expect(getBindingsByContentMock).toHaveBeenCalledWith(content);
      expect(addBindingByAbsoluteStateAddressMock).not.toHaveBeenCalled();
      expect(applyChangeMock).not.toHaveBeenCalled();
    });
  });

  describe('deactivateContent', () => {
    it('バインディングを解除すること', () => {
      const content = { mounted: true } as any;
      const binding1 = { id: 1 } as any;
      const binding2 = { id: 2 } as any;
      const absAddress1 = { path: 'path1' } as any;
      const absAddress2 = { path: 'path2' } as any;

      getBindingsByContentMock.mockReturnValue([binding1, binding2]);
      getAbsoluteStateAddressByBindingMock
        .mockReturnValueOnce(absAddress1)
        .mockReturnValueOnce(absAddress2);

      deactivateContent(content);

      expect(getBindingsByContentMock).toHaveBeenCalledWith(content);
      expect(getAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding1);
      expect(getAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding2);
      expect(removeBindingByAbsoluteStateAddressMock).toHaveBeenCalledWith(absAddress1, binding1);
      expect(removeBindingByAbsoluteStateAddressMock).toHaveBeenCalledWith(absAddress2, binding2);
      expect(clearAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding1);
      expect(clearAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding2);
      expect(clearStateAddressByBindingInfoMock).toHaveBeenCalledWith(binding1);
      expect(clearStateAddressByBindingInfoMock).toHaveBeenCalledWith(binding2);
      expect(unbindLoopContextToContentMock).toHaveBeenCalledWith(content);
    });

    it('contentがマウントされていない場合は早期リターンすること', () => {
      const content = { mounted: false } as any;

      deactivateContent(content);

      expect(getBindingsByContentMock).not.toHaveBeenCalled();
      expect(unbindLoopContextToContentMock).not.toHaveBeenCalled();
    });

    it('バインディングが空配列でも動作すること', () => {
      const content = { mounted: true } as any;

      getBindingsByContentMock.mockReturnValue([]);

      deactivateContent(content);

      expect(getBindingsByContentMock).toHaveBeenCalledWith(content);
      expect(removeBindingByAbsoluteStateAddressMock).not.toHaveBeenCalled();
      expect(clearAbsoluteStateAddressByBindingMock).not.toHaveBeenCalled();
      expect(clearStateAddressByBindingInfoMock).not.toHaveBeenCalled();
      expect(unbindLoopContextToContentMock).toHaveBeenCalledWith(content);
    });
  });
});
