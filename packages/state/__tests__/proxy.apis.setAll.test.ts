import { describe, it, expect, vi, afterEach } from 'vitest';
import { setAll } from '../src/proxy/apis/setAll';
import { getAll } from '../src/proxy/apis/getAll';
import { createListIndex } from '../src/list/createListIndex';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { IListIndex } from '../src/list/types';
import { setStateElementByName } from '../src/stateElementByName';

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn()
}));

vi.mock('../src/proxy/methods/setByAddress', () => ({
  setByAddress: vi.fn()
}));

import { getByAddress } from '../src/proxy/methods/getByAddress';
import { setByAddress } from '../src/proxy/methods/setByAddress';

const getByAddressMock = vi.mocked(getByAddress);
const setByAddressMock = vi.mocked(setByAddress);

function createStateElement(overrides?: Partial<any>) {
  return {
    name: 'default',
    listPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    addDynamicDependency: vi.fn(),
    ...overrides,
  };
}

function createHandler(stateElement: any, overrides?: Partial<any>) {
  return {
    addressStackLength: 0,
    lastAddressStack: null,
    stateElement,
    pushAddress: vi.fn(),
    popAddress: vi.fn(),
    ...overrides,
  };
}

/** `path` の `*` を `indexes` で埋めながらオブジェクトグラフを辿る */
function readPath(root: any, path: string, indexes: number[]): any {
  const segments = path.split('.');
  let current = root;
  let cursor = 0;
  for (const segment of segments) {
    if (current === null || typeof current === 'undefined') {
      return undefined;
    }
    current = segment === '*' ? current[indexes[cursor++]] : current[segment];
  }
  return current;
}

function writePath(root: any, path: string, indexes: number[], value: any): void {
  const segments = path.split('.');
  let current = root;
  let cursor = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    current = segment === '*' ? current[indexes[cursor++]] : current[segment];
  }
  const lastSegment = segments[segments.length - 1];
  if (lastSegment === '*') {
    current[indexes[cursor]] = value;
  } else {
    current[lastSegment] = value;
  }
}

/**
 * `getByAddress` / `setByAddress` を実オブジェクトグラフへの読み書きに差し替える。
 * 呼び出し順に依存したモックだと 2 相化（走査 → 書き込み）の検証ができないため。
 */
function bindGraph(root: any): void {
  getByAddressMock.mockImplementation((_target: any, address: any) =>
    readPath(root, address.pathInfo.path, address.listIndex?.indexes ?? []));
  setByAddressMock.mockImplementation((_target: any, address: any, value: any) => {
    writePath(root, address.pathInfo.path, address.listIndex?.indexes ?? [], value);
    return true;
  });
}

function registerList(list: readonly unknown[], parent: IListIndex | null = null): IListIndex[] {
  const listIndexes = list.map((_, i) => createListIndex(parent, i));
  setListIndexesByList(list, listIndexes);
  return listIndexes;
}

describe('setAll', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName(document, 'default', null);
  });

  function setup(root: any, handlerOverrides?: Partial<any>) {
    const stateElement = createStateElement();
    setStateElementByName(document, 'default', stateElement);
    const handler = createHandler(stateElement, handlerOverrides);
    bindGraph(root);
    const target = {};
    return {
      stateElement,
      handler,
      setAllFn: setAll(target, '$setAll', target, handler as any),
      getAllFn: getAll(target, '$getAll', target, handler as any),
    };
  }

  it('ブロードキャストでマッチした全要素に同じ値を書けること', () => {
    const root = { users: [{ selected: false }, { selected: false }, { selected: false }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.selected', [], true);

    expect(written).toBe(3);
    expect(root.users.map(u => u.selected)).toEqual([true, true, true]);
  });

  it('mapper が現在値と添字を受け取り、要素ごとに新しい値を算出できること', () => {
    const root = { users: [{ selected: true }, { selected: false }, { selected: true }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const seen: Array<[any, number]> = [];
    const written = setAllFn('users.*.selected', [], (current: boolean, index: number) => {
      seen.push([current, index]);
      return !current;
    });

    expect(written).toBe(3);
    expect(seen).toEqual([[true, 0], [false, 1], [true, 2]]);
    expect(root.users.map(u => u.selected)).toEqual([false, true, false]);
  });

  it('spread 指定で配列を 1 件ずつ配れること', () => {
    const root = { users: [{ selected: false }, { selected: false }, { selected: false }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.selected', [], [true, true, false], { spread: true });

    expect(written).toBe(3);
    expect(root.users.map(u => u.selected)).toEqual([true, true, false]);
  });

  it('spread 未指定の配列は配分ではなくブロードキャストされること', () => {
    const root = { users: [{ tags: [] as string[] }, { tags: [] as string[] }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.tags', [], ['admin']);

    expect(written).toBe(2);
    expect(root.users.map(u => u.tags)).toEqual([['admin'], ['admin']]);
  });

  it('undefined を書こうとした要素はスキップされ、戻り値にも数えられないこと', () => {
    const root = { users: [{ rank: 0 }, { rank: 0 }, { rank: 0 }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.rank', [], (_current: number, index: number) =>
      index < 2 ? index + 1 : undefined);

    expect(written).toBe(2);
    expect(root.users.map(u => u.rank)).toEqual([1, 2, 0]);
    expect(setByAddressMock).toHaveBeenCalledTimes(2);
  });

  it('null は書き込みスキップの対象外であること', () => {
    const root = { users: [{ note: 'a' }, { note: 'b' }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.note', [], null);

    expect(written).toBe(2);
    expect(root.users.map(u => u.note)).toEqual([null, null]);
  });

  it('添字が前方一致の接頭辞として働き、残りの階層を全展開すること', () => {
    const root = { matrix: [[1, 2, 3], [4, 5, 6]] };
    const rowIndexes = registerList(root.matrix);
    registerList(root.matrix[0], rowIndexes[0]);
    registerList(root.matrix[1], rowIndexes[1]);
    const { setAllFn } = setup(root);

    const written = setAllFn('matrix.*.*', [0], 0);

    expect(written).toBe(3);
    expect(root.matrix).toEqual([[0, 0, 0], [4, 5, 6]]);
  });

  it('添字を省略すると全階層が展開されること', () => {
    const root = { matrix: [[1, 2], [3, 4]] };
    const rowIndexes = registerList(root.matrix);
    registerList(root.matrix[0], rowIndexes[0]);
    registerList(root.matrix[1], rowIndexes[1]);
    const { setAllFn } = setup(root);

    const written = setAllFn('matrix.*.*', [], 9);

    expect(written).toBe(4);
    expect(root.matrix).toEqual([[9, 9], [9, 9]]);
  });

  it('末尾ワイルドカードへの書き込みが配列を作り直さず in-place で行われること', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const root = { users: rows };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const replacement = [{ id: 10 }, { id: 20 }];
    const written = setAllFn('users.*', [], replacement, { spread: true });

    expect(written).toBe(2);
    expect(root.users).toBe(rows);           // 配列 identity が保たれる
    expect(root.users).toEqual([{ id: 10 }, { id: 20 }]);
  });

  it('ワイルドカードを含まないパスは 1 件マッチとして扱われること', () => {
    const root = { title: 'old' };
    const { setAllFn } = setup(root);

    const written = setAllFn('title', [], 'new');

    expect(written).toBe(1);
    expect(root.title).toBe('new');
  });

  it('空リストでは 0 件を返し、書き込みが起きないこと', () => {
    const root = { users: [] as any[] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    const written = setAllFn('users.*.selected', [], true);

    expect(written).toBe(0);
    expect(setByAddressMock).not.toHaveBeenCalled();
  });

  it('$getAll の戻り順と $setAll の適用順が一致すること', () => {
    const root = { matrix: [[1, 2], [3, 4]] };
    const rowIndexes = registerList(root.matrix);
    registerList(root.matrix[0], rowIndexes[0]);
    registerList(root.matrix[1], rowIndexes[1]);
    const { setAllFn, getAllFn } = setup(root);

    const values = getAllFn('matrix.*.*', []);
    expect(values).toEqual([1, 2, 3, 4]);

    // 読んだ順にそのまま戻せる（設計 §6-1 の順序規範）
    setAllFn('matrix.*.*', [], values.map((v: number) => v * 10), { spread: true });

    expect(root.matrix).toEqual([[10, 20], [30, 40]]);
  });

  it('全アドレスを確定してから書き込むこと（走査と書き込みの 2 相）', () => {
    const root = { users: [{ n: 0 }, { n: 0 }, { n: 0 }] };
    registerList(root.users);
    const { setAllFn } = setup(root);

    // 書き込みが始まる前に、走査側の読みが全件ぶん終わっていること
    const calls: string[] = [];
    getByAddressMock.mockImplementation((_target: any, address: any) => {
      calls.push(`get:${address.pathInfo.path}`);
      return readPath(root, address.pathInfo.path, address.listIndex?.indexes ?? []);
    });
    setByAddressMock.mockImplementation((_target: any, address: any, value: any) => {
      calls.push(`set:${address.pathInfo.path}`);
      writePath(root, address.pathInfo.path, address.listIndex?.indexes ?? [], value);
      return true;
    });

    setAllFn('users.*.n', [], 1);

    const firstSet = calls.indexOf('set:users.*.n');
    const lastListRead = calls.lastIndexOf('get:users');
    expect(firstSet).toBeGreaterThan(lastListRead);
  });

  it('書き込みなので動的依存を登録しないこと', () => {
    const root = { users: [{ selected: false }] };
    registerList(root.users);
    const stateElement = createStateElement();
    stateElement.getterPaths.add('computed');
    setStateElementByName(document, 'default', stateElement);
    const handler = createHandler(stateElement, {
      addressStackLength: 1,
      lastAddressStack: { pathInfo: { path: 'computed' }, listIndex: null },
    });
    bindGraph(root);
    const target = {};

    setAll(target, '$setAll', target, handler as any)('users.*.selected', [], true);

    expect(stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  describe('検証エラー', () => {
    function setupUsers() {
      const root = { users: [{ selected: false }, { selected: false }] };
      registerList(root.users);
      return { root, ...setup(root) };
    }

    it('添字の本数がワイルドカードの本数を超えたら throw すること', () => {
      const { setAllFn } = setupUsers();
      expect(() => setAllFn('users.*.selected', [0, 1], true))
        .toThrow(/wcs\/index-arity/);
    });

    it('添字配列を省略したら throw すること', () => {
      const { setAllFn } = setupUsers();
      expect(() => (setAllFn as any)('users.*.selected', undefined, true))
        .toThrow(/explicit indexes array/);
    });

    it('spread の配列長がマッチ件数と噛み合わなければ throw すること', () => {
      const { setAllFn } = setupUsers();
      expect(() => setAllFn('users.*.selected', [], [true], { spread: true }))
        .toThrow(/exactly one entry per matched address \(matched 2\) but got 1/);
    });

    it('spread と mapper の同時指定は throw すること', () => {
      const { setAllFn } = setupUsers();
      expect(() => setAllFn('users.*.selected', [], () => true, { spread: true }))
        .toThrow(/cannot combine \{ spread: true \} with a mapper function/);
    });

    it('spread 指定で非配列を渡したら throw すること', () => {
      const { setAllFn } = setupUsers();
      expect(() => setAllFn('users.*.selected', [], true as any, { spread: true }))
        .toThrow(/requires an array as the value/);
    });

    it('検証エラー時には 1 件も書き込まないこと', () => {
      const { setAllFn } = setupUsers();
      expect(() => setAllFn('users.*.selected', [], [true], { spread: true })).toThrow();
      expect(setByAddressMock).not.toHaveBeenCalled();
    });
  });
});
