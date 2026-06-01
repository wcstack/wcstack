import { describe, it, expect, vi } from 'vitest';
import { Token } from '../src/token/Token';

describe('Token (shared pub/sub primitive)', () => {
  it('nameを保持すること', () => {
    const token = new Token('myToken');
    expect(token.name).toBe('myToken');
  });

  it('subscribe後にsizeが増えること', () => {
    const token = new Token('t');
    expect(token.size).toBe(0);
    token.subscribe(() => {});
    expect(token.size).toBe(1);
  });

  it('emitでsubscriberが登録順に呼ばれ戻り値が配列で返ること', () => {
    const token = new Token('t');
    const calls: string[] = [];
    token.subscribe((...args) => { calls.push('a'); return args[0]; });
    token.subscribe(() => { calls.push('b'); return 'b-result'; });
    const results = token.emit('x', 1);
    expect(calls).toEqual(['a', 'b']);
    expect(results).toEqual(['x', 'b-result']);
  });

  it('subscribeが返す関数でunsubscribeできること', () => {
    const token = new Token('t');
    const fn = vi.fn();
    const off = token.subscribe(fn);
    off();
    token.emit();
    expect(fn).not.toHaveBeenCalled();
    expect(token.size).toBe(0);
  });

  it('unsubscribeメソッドで解除できること（成否を返す）', () => {
    const token = new Token('t');
    const fn = () => {};
    token.subscribe(fn);
    expect(token.unsubscribe(fn)).toBe(true);
    expect(token.unsubscribe(fn)).toBe(false);
  });
});
