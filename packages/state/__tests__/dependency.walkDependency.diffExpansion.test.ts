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

function runWalkRaw(
  stateElement: IStateElement,
  oldList: unknown[] | null,
  newList: unknown[],
  options?: { listExpansion?: 'full' | 'diff' },
  staticDeps?: Map<string, string[]>,
) {
  const stateProxy = createStateProxy({ users: newList });
  if (oldList !== null) {
    // 旧リストの listIndexes を確定させ、lastValue 台帳に登録する
    createListDiff(null, [], oldList);
    setLastListValueByAbsoluteStateAddress(usersAbsAddress(stateElement), oldList);
  }
  return walkDependency(
    'default',
    stateElement,
    createStateAddress(getPathInfo('users'), null),
    staticDeps ?? new Map<string, string[]>([['users', ['users.*']]]),
    new Map<string, string[]>(),
    new Set<string>(['users']),
    stateProxy,
    'new',
    () => {},
    options,
  );
}

function indexesOf(result: ReturnType<typeof runWalkRaw>, path: string) {
  return result
    .filter(a => a.pathInfo.path === path)
    .map(a => a.listIndex?.index ?? null)
    .sort((a, b) => (a ?? -1) - (b ?? -1));
}

function runWalk(
  stateElement: IStateElement,
  oldList: unknown[] | null,
  newList: unknown[],
  options?: { listExpansion?: 'full' | 'diff' },
) {
  return indexesOf(runWalkRaw(stateElement, oldList, newList, options), 'users.*');
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

  it('diff: スワップでは index 依存 getter が無ければ移動行を展開しないこと（値は不変）', () => {
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [oldList[2], oldList[1], oldList[0]];
    expect(runWalk(stateElement, oldList, newList, { listExpansion: 'diff' })).toEqual([]);
  });

  it('diff: スワップでは index 依存 getter のパスだけを移動行分展開すること', () => {
    const idxElement = {
      name: 'default',
      indexDependentGetterPaths: new Set(['users.*.sel']),
    } as unknown as IStateElement;
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [oldList[2], oldList[1], oldList[0]];
    const result = runWalkRaw(idxElement, oldList, newList, { listExpansion: 'diff' },
      new Map([['users', ['users.*']], ['users.*', ['users.*.sel', 'users.*.name']]]));
    // 行アドレス（users.*）と index を読まない値パス（users.*.name）は展開されない
    expect(indexesOf(result, 'users.*')).toEqual([]);
    expect(indexesOf(result, 'users.*.name')).toEqual([]);
    expect(indexesOf(result, 'users.*.sel')).toEqual([0, 2]);
  });

  it('diff: 追加と移動が混在する場合、追加行は全体・移動行は index 依存 getter のみ展開すること', () => {
    const idxElement = {
      name: 'default',
      indexDependentGetterPaths: new Set(['users.*.sel']),
    } as unknown as IStateElement;
    const oldList = [{ id: 1 }, { id: 2 }];
    // 先頭に新規行を挿入: 既存 2 行は位置 0→1 / 1→2 に移動
    const newList = [{ id: 99 }, oldList[0], oldList[1]];
    const result = runWalkRaw(idxElement, oldList, newList, { listExpansion: 'diff' },
      new Map([['users', ['users.*']], ['users.*', ['users.*.sel', 'users.*.name']]]));
    expect(indexesOf(result, 'users.*')).toEqual([0]);
    // 追加行は行全体の walk で users.*.name / users.*.sel とも展開される
    expect(indexesOf(result, 'users.*.name')).toEqual([0]);
    expect(indexesOf(result, 'users.*.sel')).toEqual([0, 1, 2]);
  });

  it('diff: ネストしたワイルドカード配下に index 依存 getter がある場合は移動行を全体展開に倒すこと', () => {
    const idxElement = {
      name: 'default',
      indexDependentGetterPaths: new Set(['users.*.tags.*.badge']),
    } as unknown as IStateElement;
    const oldList = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const newList = [oldList[2], oldList[1], oldList[0]];
    const result = runWalkRaw(idxElement, oldList, newList, { listExpansion: 'diff' },
      new Map([['users', ['users.*']], ['users.*', ['users.*.tags']], ['users.*.tags', ['users.*.tags.*']], ['users.*.tags.*', ['users.*.tags.*.badge']]]));
    expect(indexesOf(result, 'users.*')).toEqual([0, 2]);
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
