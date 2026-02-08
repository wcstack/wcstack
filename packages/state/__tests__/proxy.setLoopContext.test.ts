import { describe, it, expect, vi, afterEach } from 'vitest';
import { setLoopContext, setLoopContextAsync } from '../src/proxy/methods/setLoopContext';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';

describe('proxy/methods/setLoopContext', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('既に loopContext が設定済みならエラーになること', () => {
    const handler = {
      loopContext: null,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    expect(() => setLoopContext(handler, null, () => {})).toThrow('already in loop context');
    expect(handler.setLoopContext).not.toHaveBeenCalled();
  });

  it('loopContext ありの場合に push/pop されること', () => {
    const handler = {
      loopContext: undefined,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    const loopContext = {
      pathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 1)
    } as any;

    const result = setLoopContext(handler, loopContext, () => 'ok');

    expect(handler.setLoopContext).toHaveBeenCalledWith(loopContext);
    expect(handler.pushAddress).toHaveBeenCalledTimes(1);
    expect(handler.popAddress).toHaveBeenCalledTimes(1);
    expect(handler.clearLoopContext).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('loopContext が null の場合でも clearLoopContext が呼ばれること', () => {
    const handler = {
      loopContext: undefined,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    expect(() => setLoopContext(handler, null, () => {
      throw new Error('fail');
    })).toThrow('fail');

    expect(handler.setLoopContext).toHaveBeenCalledWith(null);
    expect(handler.pushAddress).not.toHaveBeenCalled();
    expect(handler.popAddress).not.toHaveBeenCalled();
    expect(handler.clearLoopContext).toHaveBeenCalledTimes(1);
  });
});

describe('proxy/methods/setLoopContextAsync', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('既に loopContext が設定済みならエラーになること', async () => {
    const handler = {
      loopContext: null,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    await expect(setLoopContextAsync(handler, null, async () => {})).rejects.toThrow('already in loop context');
    expect(handler.setLoopContext).not.toHaveBeenCalled();
  });

  it('loopContext ありの場合に push/pop されること', async () => {
    const handler = {
      loopContext: undefined,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    const loopContext = {
      pathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 1)
    } as any;

    const result = await setLoopContextAsync(handler, loopContext, async () => 'ok');

    expect(handler.setLoopContext).toHaveBeenCalledWith(loopContext);
    expect(handler.pushAddress).toHaveBeenCalledTimes(1);
    expect(handler.popAddress).toHaveBeenCalledTimes(1);
    expect(handler.clearLoopContext).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('loopContext が null の場合でも clearLoopContext が呼ばれること', async () => {
    const handler = {
      loopContext: undefined,
      setLoopContext: vi.fn(),
      clearLoopContext: vi.fn(),
      pushAddress: vi.fn(),
      popAddress: vi.fn()
    } as any;

    await expect(setLoopContextAsync(handler, null, async () => {
      throw new Error('fail');
    })).rejects.toThrow('fail');

    expect(handler.setLoopContext).toHaveBeenCalledWith(null);
    expect(handler.pushAddress).not.toHaveBeenCalled();
    expect(handler.popAddress).not.toHaveBeenCalled();
    expect(handler.clearLoopContext).toHaveBeenCalledTimes(1);
  });
});