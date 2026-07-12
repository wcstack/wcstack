import { describe, it, expect, afterEach } from 'vitest';
import { walkDependency } from '../src/dependency/walkDependency';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { createListDiff } from '../src/list/createListDiff';
import {
  setLastListValueByAbsoluteStateAddress,
  clearLastListValueByAbsoluteStateAddress,
} from '../src/list/lastListValueByAbsoluteStateAddress';
import { getByAddressSymbol } from '../src/proxy/symbols';
import type { IStateElement } from '../src/components/types';

function createStateProxy(values: Record<string, any>) {
  return {
    [getByAddressSymbol]: (address: { pathInfo: { path: string } }) => values[address.pathInfo.path],
  } as any;
}

function usersAbsAddress(stateElement: IStateElement) {
  const absPathInfo = getAbsolutePathInfo(stateElement, getPathInfo('users'));
  return createAbsoluteStateAddress(absPathInfo, null);
}

function runWalk(
  stateElement: IStateElement,
  oldList: unknown[] | null,
  newList: unknown[],
  options?: { listExpansion?: 'full' | 'diff' },
) {
  const stateProxy = createStateProxy({ users: newList });
  if (oldList !== null) {
    // 旧リストの listIndexes を確定させ、lastValue 台帳に登録する
    createListDiff(null, [], oldList);
    setLastListValueByAbsoluteStateAddress(usersAbsAddress(stateElement), oldList);
  }
  const result = walkDependency(
    'default',
    stateElement,
    createStateAddress(getPathInfo('users'), null),
    new Map<string, string[]>([['users', ['users.*']]]),
    new Map<string, string[]>(),
    new Set<string>(['users']),
    stateProxy,
    'new',
    () => {},
    options,
  );
  return result
    .filter(a => a.pathInfo.path === 'users.*')
    .map(a => a.listIndex?.index ?? null)
    .sort((a, b) => (a ?? -1) - (b ?? -1));
}

describe('walkDependency の diff-filter 展開', () => {
  const stateElement = { name: 'default' } as IStateElement;

  afterEach(() => {
    clearLastListValueByAbsoluteStateAddress(usersAbsAddress(stateElement));
  });

  it('diff: 末尾追加では追加行のみ展開すること', () => {
    const oldList = [{ id: 1 }, { id: 2 }];
    const newList = [...oldList, { id: 3 }];
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([2]);
  });

  it('diff: 末尾削除では何も展開しないこと（集計はコンテナ動的エッジが担う）', () => {
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = oldList.slice(0, 2);
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([]);
  });

  it('diff: 先頭要素の置換では置換行のみ展開すること', () => {
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [{ id: 99 }, oldList[1], oldList[2]];
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([0]);
  });

  it('diff: スワップでは位置が変わった行のみ展開すること', () => {
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [oldList[2], oldList[1], oldList[0]];
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([0, 2]);
  });

  it('diff: 同一参照の再代入では全行展開へ倒すこと（in-place 変異リフレッシュイディオム）', () => {
    const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(runWalk(stateElement, list, list, { listExpansion: 'diff' })).toEqual([0, 1, 2]);
  });

  it('diff: 内容同一のコピー再代入でも全行展開へ倒すこと（spread コピーのリフレッシュ綴り）', () => {
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [...oldList]; // 新配列・同一行オブジェクト = diff に変化ゼロ
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([0, 1, 2]);
  });

  it('diff: crossRowListPaths に含まれるリストは全行展開へ倒すこと', () => {
    const crossElement = { name: 'default', crossRowListPaths: new Set(['users']) } as unknown as IStateElement;
    const oldList = [{ id: 1 }, { id: 2 }];
    const newList = [...oldList, { id: 3 }];
    // crossElement は name が同じなので abs address も共有される
    expect(runWalk(crossElement, oldList, newList, { listExpansion: 'diff' })).toEqual([0, 1, 2]);
  });

  it('既定（オプション無し）は従来通り全行展開であること', () => {
    const oldList = [{ id: 1 }, { id: 2 }];
    const newList = [...oldList, { id: 3 }];
    expect(runWalk(stateElement, oldList, newList)).toEqual([0, 1, 2]);
  });

  it('full 明示でも全行展開であること', () => {
    const oldList = [{ id: 1 }, { id: 2 }];
    const newList = [...oldList, { id: 3 }];
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'full' })).toEqual([0, 1, 2]);
  });
});
