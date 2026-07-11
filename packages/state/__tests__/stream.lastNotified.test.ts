/**
 * stream.lastNotified.test.ts
 *
 * 「最後に通知した観測値」台帳（src/stream/lastNotified.ts）の単体テスト。
 * 台帳の生存期間（stateElement 寿命・再 set / 再接続を跨ぐ）と、
 * abortAllStreams の無通知ミューテーションに対する invalidate の
 * フィールド単位セマンティクスを固定する（docs/state-streams-design.md §4-3）。
 * 再接続経路の end-to-end は stream.companion.test.ts の S12 補2 / 補3 が担う。
 */
import { describe, it, expect } from 'vitest';
import {
  getLastNotified,
  setLastNotified,
  invalidateLastNotified,
  __private__,
} from '../src/stream/lastNotified';
import type { IStateElement } from '../src/components/types';

const fakeStateElement = (): IStateElement => ({} as IStateElement);
const { UNCERTAIN, lastNotifiedByStateElement } = __private__;

describe('lastNotified（最後に通知した観測値の台帳）', () => {
  it('未通知の getLastNotified は基準値 { idle, null } を返し、台帳には登録しないこと', () => {
    const se = fakeStateElement();
    expect(getLastNotified(se, 'tokens')).toEqual({ status: 'idle', error: null });
    expect(lastNotifiedByStateElement.has(se)).toBe(false);
  });

  it('setLastNotified で記録した値が getLastNotified で返ること（名前単位で独立）', () => {
    const se = fakeStateElement();
    const boom = new Error('boom');
    setLastNotified(se, 'tokens', 'active', null);
    setLastNotified(se, 'frames', 'error', boom);
    expect(getLastNotified(se, 'tokens')).toEqual({ status: 'active', error: null });
    expect(getLastNotified(se, 'frames')).toEqual({ status: 'error', error: boom });
    // 別名は未通知のまま基準値
    expect(getLastNotified(se, 'other')).toEqual({ status: 'idle', error: null });
  });

  it('台帳未作成の stateElement への invalidateLastNotified は no-op であること', () => {
    const se = fakeStateElement();
    expect(() => invalidateLastNotified(se, 'tokens')).not.toThrow();
    expect(getLastNotified(se, 'tokens')).toEqual({ status: 'idle', error: null });
  });

  it('未通知の名前への invalidateLastNotified は no-op であること（基準値 { idle, null } はミューテーション後の値と一致）', () => {
    const se = fakeStateElement();
    setLastNotified(se, 'other', 'active', null); // 台帳は存在するが tokens は未通知
    invalidateLastNotified(se, 'tokens');
    expect(getLastNotified(se, 'tokens')).toEqual({ status: 'idle', error: null });
  });

  it('invalidate はミューテーション後の値（idle / null）と乖離するフィールドだけを不確定にすること', () => {
    const se = fakeStateElement();
    setLastNotified(se, 'tokens', 'active', null);
    invalidateLastNotified(se, 'tokens');
    const last = getLastNotified(se, 'tokens');
    // status: active ≠ idle → 不確定（次の active 通知は同値 skip されない）
    expect(last.status).toBe(UNCERTAIN);
    expect(last.status !== 'active').toBe(true);
    // error: null は一致 → dedup 維持（余計な $streamError 通知は出ない）
    expect(last.error).toBeNull();
  });

  it('error も乖離していれば両フィールドが不確定になること', () => {
    const se = fakeStateElement();
    const boom = new Error('boom');
    setLastNotified(se, 'tokens', 'error', boom);
    invalidateLastNotified(se, 'tokens');
    const last = getLastNotified(se, 'tokens');
    expect(last.status).toBe(UNCERTAIN);
    expect(last.error).toBe(UNCERTAIN);
    expect(Object.is(last.error, boom)).toBe(false);
  });

  it('status が idle のまま error だけ通知されていた場合、status 側の dedup は維持されること', () => {
    const se = fakeStateElement();
    setLastNotified(se, 'tokens', 'idle', 'primitive-error');
    invalidateLastNotified(se, 'tokens');
    const last = getLastNotified(se, 'tokens');
    expect(last.status).toBe('idle'); // idle は一致 → 保持
    expect(last.error).toBe(UNCERTAIN);
  });

  it('二重 invalidate でも不確定のまま安定であること（abort が重なっても安全）', () => {
    const se = fakeStateElement();
    setLastNotified(se, 'tokens', 'active', new Error('boom'));
    invalidateLastNotified(se, 'tokens');
    invalidateLastNotified(se, 'tokens');
    const last = getLastNotified(se, 'tokens');
    expect(last.status).toBe(UNCERTAIN);
    expect(last.error).toBe(UNCERTAIN);
  });

  it('invalidate 後に setLastNotified すれば通常の dedup 基準に復帰すること', () => {
    const se = fakeStateElement();
    setLastNotified(se, 'tokens', 'active', null);
    invalidateLastNotified(se, 'tokens');
    setLastNotified(se, 'tokens', 'active', null); // 再接続後の通知を模す
    expect(getLastNotified(se, 'tokens')).toEqual({ status: 'active', error: null });
  });
});
