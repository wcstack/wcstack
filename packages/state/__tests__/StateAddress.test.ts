import { describe, it, expect } from 'vitest';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { IListIndex } from '../src/list/types';
import { createListIndex } from '../src/list/createListIndex';

describe('StateAddress', () => {
  describe('createStateAddress', () => {
    it('関数が存在すること', () => {
      expect(createStateAddress).toBeDefined();
      expect(typeof createStateAddress).toBe('function');
    });

    it('PathInfoとnullのlistIndexでStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('users.name');
      const stateAddress = createStateAddress(pathInfo, null);
      
      expect(stateAddress).toBeDefined();
      expect(stateAddress.pathInfo).toBe(pathInfo);
      expect(stateAddress.listIndex).toBeNull();
    });

    it('PathInfoとlistIndexでStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('users.*.name');
      const listIndex: IListIndex = {
        index: 0,
        value: { id: 1, name: 'Alice' },
        parent: null,
        pathInfo: getPathInfo('users.*')
      };
      
      const stateAddress = createStateAddress(pathInfo, listIndex);
      
      expect(stateAddress).toBeDefined();
      expect(stateAddress.pathInfo).toBe(pathInfo);
      expect(stateAddress.listIndex).toBe(listIndex);
      expect(stateAddress.listIndex?.index).toBe(0);
    });

    it('単純なパスのStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('count');
      const stateAddress = createStateAddress(pathInfo, null);
      
      expect(stateAddress.pathInfo.path).toBe('count');
      expect(stateAddress.pathInfo.segments).toEqual(['count']);
      expect(stateAddress.listIndex).toBeNull();
    });

    it('複数階層のパスのStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('user.profile.email');
      const stateAddress = createStateAddress(pathInfo, null);
      
      expect(stateAddress.pathInfo.path).toBe('user.profile.email');
      expect(stateAddress.pathInfo.segments).toEqual(['user', 'profile', 'email']);
    });

    it('ワイルドカードを含むパスのStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('users.*.posts.*');
      const parentListIndex: IListIndex = {
        index: 1,
        value: { id: 2, name: 'Bob' },
        parent: null,
        pathInfo: getPathInfo('users.*')
      };
      const listIndex: IListIndex = {
        index: 0,
        value: { id: 101, title: 'First Post' },
        parent: parentListIndex,
        pathInfo: getPathInfo('users.*.posts.*')
      };
      
      const stateAddress = createStateAddress(pathInfo, listIndex);
      
      expect(stateAddress.pathInfo.path).toBe('users.*.posts.*');
      expect(stateAddress.pathInfo.wildcardPositions).toEqual([1, 3]);
      expect(stateAddress.listIndex?.index).toBe(0);
      expect(stateAddress.listIndex?.parent?.index).toBe(1);
    });

    it('作成されたStateAddressのプロパティが正しく設定されていること', () => {
      const pathInfo = getPathInfo('users.name');
      const stateAddress = createStateAddress(pathInfo, null);
      
      // プロパティが正しく設定されている
      expect(stateAddress.pathInfo).toBe(pathInfo);
      expect(stateAddress.listIndex).toBeNull();
      
      // TypeScriptのreadonly修飾子により、コンパイル時に変更が防止される
      // (ランタイムでは変更可能だが、TypeScriptの型システムで防御される)
    });
  });

  describe('listIndexの階層構造', () => {
    it('親のないlistIndexを持つStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('items.*');
      const listIndex: IListIndex = {
        index: 2,
        value: { name: 'Item 3' },
        parent: null,
        pathInfo: getPathInfo('items.*')
      };
      
      const stateAddress = createStateAddress(pathInfo, listIndex);
      
      expect(stateAddress.listIndex?.parent).toBeNull();
    });

    it('2階層のlistIndexを持つStateAddressを作成できること', () => {
      const parentListIndex: IListIndex = {
        index: 0,
        value: { id: 1, items: [] },
        parent: null,
        pathInfo: getPathInfo('categories.*')
      };
      
      const listIndex: IListIndex = {
        index: 1,
        value: { name: 'Item 2' },
        parent: parentListIndex,
        pathInfo: getPathInfo('categories.*.items.*')
      };
      
      const pathInfo = getPathInfo('categories.*.items.*');
      const stateAddress = createStateAddress(pathInfo, listIndex);
      
      expect(stateAddress.listIndex?.index).toBe(1);
      expect(stateAddress.listIndex?.parent?.index).toBe(0);
      expect(stateAddress.listIndex?.parent?.parent).toBeNull();
    });

    it('3階層のlistIndexを持つStateAddressを作成できること', () => {
      const rootListIndex: IListIndex = {
        index: 0,
        value: { id: 1 },
        parent: null,
        pathInfo: getPathInfo('users.*')
      };
      
      const middleListIndex: IListIndex = {
        index: 1,
        value: { id: 10 },
        parent: rootListIndex,
        pathInfo: getPathInfo('users.*.posts.*')
      };
      
      const leafListIndex: IListIndex = {
        index: 2,
        value: { id: 100 },
        parent: middleListIndex,
        pathInfo: getPathInfo('users.*.posts.*.comments.*')
      };
      
      const pathInfo = getPathInfo('users.*.posts.*.comments.*');
      const stateAddress = createStateAddress(pathInfo, leafListIndex);
      
      expect(stateAddress.listIndex?.index).toBe(2);
      expect(stateAddress.listIndex?.parent?.index).toBe(1);
      expect(stateAddress.listIndex?.parent?.parent?.index).toBe(0);
      expect(stateAddress.listIndex?.parent?.parent?.parent).toBeNull();
    });
  });

  describe('IStateAddressインターフェース', () => {
    it('IStateAddressの型に準拠していること', () => {
      const pathInfo = getPathInfo('test.path');
      const stateAddress = createStateAddress(pathInfo, null);
      
      // TypeScriptの型チェックによりコンパイル時に検証される
      const hasPathInfo: boolean = 'pathInfo' in stateAddress;
      const hasListIndex: boolean = 'listIndex' in stateAddress;
      
      expect(hasPathInfo).toBe(true);
      expect(hasListIndex).toBe(true);
    });
  });

  describe('エッジケース', () => {
    it('空のパスでStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('');
      const stateAddress = createStateAddress(pathInfo, null);
      
      expect(stateAddress.pathInfo.path).toBe('');
      expect(stateAddress.pathInfo.segments).toEqual(['']);
    });

    it('同じPathInfoで複数のStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('users.name');
      const stateAddress1 = createStateAddress(pathInfo, null);
      const stateAddress2 = createStateAddress(pathInfo, null);
      
      // 同じPathInfo・同じlistIndexはキャッシュで同一インスタンス
      expect(stateAddress1.pathInfo).toBe(stateAddress2.pathInfo);
      expect(stateAddress1).toBe(stateAddress2);
    });

    it('同じlistIndexとPathInfoでキャッシュが効くこと', () => {
      const pathInfo = getPathInfo('items.*');
      const listIndex = createListIndex(null, 0);
      const stateAddress1 = createStateAddress(pathInfo, listIndex);
      const stateAddress2 = createStateAddress(pathInfo, listIndex);

      expect(stateAddress1).toBe(stateAddress2);
      expect(stateAddress1.listIndex).toBe(listIndex);
    });

    it('異なるlistIndexで同じPathInfoのStateAddressを作成できること', () => {
      const pathInfo = getPathInfo('users.*');
      const listIndex1: IListIndex = {
        index: 0,
        value: { name: 'Alice' },
        parent: null,
        pathInfo: pathInfo
      };
      const listIndex2: IListIndex = {
        index: 1,
        value: { name: 'Bob' },
        parent: null,
        pathInfo: pathInfo
      };
      
      const stateAddress1 = createStateAddress(pathInfo, listIndex1);
      const stateAddress2 = createStateAddress(pathInfo, listIndex2);
      
      expect(stateAddress1.pathInfo).toBe(stateAddress2.pathInfo);
      expect(stateAddress1.listIndex).not.toBe(stateAddress2.listIndex);
      expect(stateAddress1.listIndex?.index).toBe(0);
      expect(stateAddress2.listIndex?.index).toBe(1);
    });
  });

  describe('parentAddress', () => {
    it('非ワイルドカードの親は同じlistIndexを引き継ぐこと', () => {
      const pathInfo = getPathInfo('users.name');
      const listIndex = createListIndex(null, 2);
      const stateAddress = createStateAddress(pathInfo, listIndex);
      const parent = stateAddress.parentAddress;

      expect(parent?.pathInfo.path).toBe('users');
      expect(parent?.listIndex).toBe(listIndex);
      // キャッシュされること
      expect(stateAddress.parentAddress).toBe(parent);
    });

    it('ワイルドカードの親はparentListIndexを使うこと', () => {
      const pathInfo = getPathInfo('users.*.posts.*');
      const rootIndex = createListIndex(null, 1);
      const childIndex = createListIndex(rootIndex, 3);
      const stateAddress = createStateAddress(pathInfo, childIndex);
      const parent = stateAddress.parentAddress;

      expect(parent?.pathInfo.path).toBe('users.*.posts');
      expect(parent?.listIndex).toBe(rootIndex);
    });
  });
});
