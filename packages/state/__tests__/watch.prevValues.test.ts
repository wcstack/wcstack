/**
 * watch.prevValues.test.ts
 *
 * `prev`（バッチ開始時点の値）の台帳（実装計画 A-4）。
 *
 * 受け入れ ID:
 * - P2: バッチ内 first-write-wins で記録する
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearPrevValues, getPrevValue, recordPrevValue, __private__ } from '../src/watch/prevValues';
import type { IAbsoluteStateAddress } from '../src/address/types';

const fakeAddress = (id: string): IAbsoluteStateAddress => ({ id } as unknown as IAbsoluteStateAddress);

beforeEach(() => {
  clearPrevValues();
});

describe('prevValues', () => {
  it('記録が無いアドレスでは undefined を返すこと', () => {
    expect(getPrevValue(fakeAddress('a'))).toBeUndefined();
  });

  it('P2: 同一バッチ内の 2 回目以降の書き込みでは旧値を上書きしないこと（first-write-wins）', () => {
    const address = fakeAddress('a');
    recordPrevValue(address, 1);
    recordPrevValue(address, 2);
    recordPrevValue(address, 3);
    // prev はバッチ開始時点の値。a→b→c と動いても prev は a
    expect(getPrevValue(address)).toBe(1);
  });

  it('undefined を旧値として記録した場合も「記録済み」として扱われること', () => {
    const address = fakeAddress('a');
    recordPrevValue(address, undefined);
    recordPrevValue(address, 'later');
    expect(getPrevValue(address)).toBeUndefined();
    expect(__private__.prevValueByAbsoluteStateAddress.has(address)).toBe(true);
  });

  it('アドレスごとに独立して記録されること', () => {
    const a = fakeAddress('a');
    const b = fakeAddress('b');
    recordPrevValue(a, 1);
    recordPrevValue(b, 2);
    expect(getPrevValue(a)).toBe(1);
    expect(getPrevValue(b)).toBe(2);
  });

  it('clearPrevValues で台帳が空になること（次のバッチへ持ち越さない）', () => {
    const address = fakeAddress('a');
    recordPrevValue(address, 1);
    clearPrevValues();
    expect(getPrevValue(address)).toBeUndefined();
    expect(__private__.prevValueByAbsoluteStateAddress.size).toBe(0);
  });
});
