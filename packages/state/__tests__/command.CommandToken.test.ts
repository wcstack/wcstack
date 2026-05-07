import { describe, it, expect, vi } from 'vitest';
import { CommandToken, isCommandToken } from '../src/command/CommandToken';

describe('CommandToken', () => {
  it('指定した名前を保持すること', () => {
    const t = new CommandToken('fetchUsers');
    expect(t.name).toBe('fetchUsers');
  });

  it('subscriberを登録できsizeで件数を取得できること', () => {
    const t = new CommandToken('x');
    expect(t.size).toBe(0);
    t.subscribe(() => {});
    expect(t.size).toBe(1);
  });

  it('emitで全subscriberに引数を伝搬し戻り値の配列を返すこと', () => {
    const t = new CommandToken('x');
    const a = vi.fn().mockReturnValue('A');
    const b = vi.fn().mockReturnValue('B');
    t.subscribe(a);
    t.subscribe(b);
    const results = t.emit(1, 'foo');
    expect(a).toHaveBeenCalledWith(1, 'foo');
    expect(b).toHaveBeenCalledWith(1, 'foo');
    expect(results).toEqual(['A', 'B']);
  });

  it('subscribeの戻り値で解除できること', () => {
    const t = new CommandToken('x');
    const fn = vi.fn();
    const off = t.subscribe(fn);
    off();
    t.emit();
    expect(fn).not.toHaveBeenCalled();
    expect(t.size).toBe(0);
  });

  it('unsubscribeで個別に解除できること', () => {
    const t = new CommandToken('x');
    const a = vi.fn();
    const b = vi.fn();
    t.subscribe(a);
    t.subscribe(b);
    expect(t.unsubscribe(a)).toBe(true);
    expect(t.unsubscribe(a)).toBe(false);
    t.emit();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('subscriberが存在しなければemitは空配列を返すこと', () => {
    const t = new CommandToken('x');
    expect(t.emit()).toEqual([]);
  });

  it('isCommandTokenで判別できること', () => {
    expect(isCommandToken(new CommandToken('x'))).toBe(true);
    expect(isCommandToken({ name: 'x', emit: () => [], subscribe: () => () => {} })).toBe(false);
    expect(isCommandToken(null)).toBe(false);
    expect(isCommandToken(undefined)).toBe(false);
    expect(isCommandToken('x')).toBe(false);
  });
});
