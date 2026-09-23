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

/**
 * ファンアウトの契約（README の Token API）。1 つの subscriber が throw しても残りへ届く。
 * `command.clear:` と `command.reset:` を同じ `$command.reset` に繋ぐ README の例は、
 * 片方の要素のメソッドが投げたらもう片方に届かない形では成り立たない。
 */
describe('Token.emit — subscriber が throw したとき', () => {
  it('残りの subscriber にも配り、投げた分は console.error に載せること', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const token = new Token('reset');
      const calls: string[] = [];
      token.subscribe(() => { calls.push('a'); return 'A'; });
      token.subscribe(() => { throw new Error('SUBSCRIBER-BOOM'); });
      token.subscribe(() => { calls.push('c'); return 'C'; });

      const results = token.emit(1);

      expect(calls).toEqual(['a', 'c']);
      expect(results).toEqual(['A', undefined, 'C']);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('a subscriber of token "reset" threw');
      expect((errorSpy.mock.calls[0][1] as Error).message).toBe('SUBSCRIBER-BOOM');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('emit 自体は throw しないこと', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const token = new Token('boom');
      token.subscribe(() => { throw new Error('X'); });
      expect(() => token.emit()).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
