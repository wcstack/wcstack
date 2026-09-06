/**
 * watch.watchRegistry.test.ts
 *
 * `$watch` の registry と発火対象集合（実装計画 A-2）。
 *
 * 要点は「切断（deactivateWatch）は registry を保持し、`_state` 再 set
 * （clearWatchRegistry）だけが捨てる」という二段構え。registry まで捨てると
 * 再接続で宣言を作り直す経路が無く、watch が二度と発火しない。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addActiveWatchStateElement,
  clearWatchRegistry,
  deactivateWatch,
  getActiveWatchStateElements,
  getWatchEntries,
  setWatchEntries,
  __private__,
} from '../src/watch/watchRegistry';
import { getPathInfo } from '../src/address/PathInfo';
import type { IStateElement } from '../src/components/types';
import type { IWatchEntry } from '../src/watch/types';

const fakeStateElement = (): IStateElement => ({} as unknown as IStateElement);

const makeEntry = (path: string): IWatchEntry => ({
  path,
  pathInfo: getPathInfo(path),
  handler: () => { /* noop */ },
  order: 0,
});

beforeEach(() => {
  __private__.activeStateElements.clear();
});

describe('watchRegistry', () => {
  it('未登録の stateElement では空 Map を返し、registry には登録しないこと', () => {
    const se = fakeStateElement();
    expect(getWatchEntries(se).size).toBe(0);
    expect(__private__.registryByStateElement.has(se)).toBe(false);
  });

  it('setWatchEntries で登録した entry を取得できること', () => {
    const se = fakeStateElement();
    setWatchEntries(se, new Map([['a', makeEntry('a')]]));
    expect(getWatchEntries(se).get('a')!.path).toBe('a');
  });

  it('addActiveWatchStateElement で発火対象に載ること', () => {
    const se = fakeStateElement();
    addActiveWatchStateElement(se);
    expect(getActiveWatchStateElements().has(se)).toBe(true);
  });

  it('deactivateWatch は発火対象から外すが registry は保持すること（再接続で復活できる）', () => {
    const se = fakeStateElement();
    setWatchEntries(se, new Map([['a', makeEntry('a')]]));
    addActiveWatchStateElement(se);

    deactivateWatch(se);

    expect(getActiveWatchStateElements().has(se)).toBe(false);
    expect(getWatchEntries(se).has('a')).toBe(true);
  });

  it('clearWatchRegistry は発火対象からも registry からも落とすこと', () => {
    const se = fakeStateElement();
    setWatchEntries(se, new Map([['a', makeEntry('a')]]));
    addActiveWatchStateElement(se);

    clearWatchRegistry(se);

    expect(getActiveWatchStateElements().has(se)).toBe(false);
    expect(getWatchEntries(se).size).toBe(0);
    expect(__private__.registryByStateElement.has(se)).toBe(false);
  });

  it('deactivateWatch → addActiveWatchStateElement で同じ entry のまま発火対象に戻せること', () => {
    const se = fakeStateElement();
    const entry = makeEntry('a');
    setWatchEntries(se, new Map([['a', entry]]));
    addActiveWatchStateElement(se);
    deactivateWatch(se);

    addActiveWatchStateElement(se);

    expect(getActiveWatchStateElements().has(se)).toBe(true);
    expect(getWatchEntries(se).get('a')).toBe(entry);
  });
});
