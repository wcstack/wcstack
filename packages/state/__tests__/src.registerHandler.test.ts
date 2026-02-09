import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/structural/collectStructuralFragments', () => ({
  collectStructuralFragments: vi.fn()
}));
vi.mock('../src/bindings/initializeBindings', () => ({
  initializeBindings: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../src/waitForStateInitialize', () => ({
  waitForStateInitialize: vi.fn().mockResolvedValue(undefined)
}));

import { registerHandler } from '../src/registerHandler';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { initializeBindings } from '../src/bindings/initializeBindings';
import { waitForStateInitialize } from '../src/waitForStateInitialize';

const collectMock = vi.mocked(collectStructuralFragments);
const initMock = vi.mocked(initializeBindings);
const waitMock = vi.mocked(waitForStateInitialize);

describe('registerHandler', () => {
  it('DOMContentLoadedで初期化処理を呼ぶこと', async () => {
    const addListenerSpy = vi.spyOn(document, 'addEventListener');
    let callback: any = null;

    addListenerSpy.mockImplementation((type: any, cb: any) => {
      if (type === 'DOMContentLoaded') {
        callback = cb as () => void;
      }
    });

    registerHandler();
    expect(addListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));

    await callback?.();

    expect(waitMock).toHaveBeenCalledWith(document);
    expect(collectMock).toHaveBeenCalledWith(document);
    expect(initMock).toHaveBeenCalledWith(document.body, null);

    addListenerSpy.mockRestore();
  });
});
