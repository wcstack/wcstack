import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/address/PathInfo', () => ({
  getPathInfo: vi.fn()
}));
vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => ({
  getAbsoluteStateAddressByBinding: vi.fn()
}));
vi.mock('../src/bindings/getBindingsByNode', () => ({
  getBindingsByNode: vi.fn(),
  addBindingByNode: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn()
}));

import { buildPrimaryMappingRule, getInnerAbsolutePathInfo, getOuterAbsolutePathInfo } from '../src/webComponent/MappingRule';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsoluteStateAddressByBinding } from '../src/binding/getAbsoluteStateAddressByBinding';
import { getBindingsByNode, addBindingByNode } from '../src/bindings/getBindingsByNode';
import { getStateElementByName } from '../src/stateElementByName';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { IBindingInfo } from '../src/binding/types';

const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const getPathInfoMock = vi.mocked(getPathInfo);
const getAbsoluteStateAddressByBindingMock = vi.mocked(getAbsoluteStateAddressByBinding);
const getBindingsByNodeMock = vi.mocked(getBindingsByNode);
const addBindingByNodeMock = vi.mocked(addBindingByNode);
const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getStateElementByWebComponentMock = vi.mocked(getStateElementByWebComponent);

describe('MappingRule', () => {
  let component: Element;

  beforeEach(() => {
    vi.clearAllMocks();
    component = document.createElement('div');
    document.body.appendChild(component);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('buildPrimaryMappingRule', () => {
    it('bindingsが空配列の場合は早期リターンすること', () => {
      expect(() => buildPrimaryMappingRule(component, 'state', [])).not.toThrow();
    });

    it('innerStateが見つからない場合はエラーになること', () => {
      getStateElementByWebComponentMock.mockReturnValue(null);

      expect(() => buildPrimaryMappingRule(component, 'state', [{} as any])).toThrow(/State element not found for web component/);
    });

    it('正常にプライマリマッピングルールを構築すること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.0',
        node: component,
        replaceNode: component
      } as any;

      const innerPathInfo = {
        path: 'user',
        segments: ['user'],
        cumulativePathInfoSet: new Set()
      } as any;
      const innerAbsPathInfo = {
        stateElement: innerStateElement,
        pathInfo: innerPathInfo
      } as any;
      const outerAbsPathInfo = {
        pathInfo: { path: 'users.0' }
      } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(innerPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: outerAbsPathInfo
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      // getPathInfoが propSegments.slice(1) で呼ばれること
      expect(getPathInfoMock).toHaveBeenCalledWith('user');
      expect(getAbsolutePathInfoMock).toHaveBeenCalledWith(innerStateElement, innerPathInfo);
      expect(getAbsoluteStateAddressByBindingMock).toHaveBeenCalledWith(binding);
    });

    it('複数のバインディングで複数のマッピングルールを構築すること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding1: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.0'
      } as any;
      const binding2: IBindingInfo = {
        propName: 'state.product',
        propSegments: ['state', 'product'],
        statePathName: 'products.0'
      } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      getPathInfoMock
        .mockReturnValueOnce({ path: 'user', segments: ['user'], cumulativePathInfoSet: new Set() } as any)
        .mockReturnValueOnce({ path: 'product', segments: ['product'], cumulativePathInfoSet: new Set() } as any);

      getAbsolutePathInfoMock
        .mockReturnValueOnce({ stateElement: innerStateElement, pathInfo: { path: 'user' } } as any)
        .mockReturnValueOnce({ stateElement: innerStateElement, pathInfo: { path: 'product' } } as any);

      getAbsoluteStateAddressByBindingMock
        .mockReturnValueOnce({ absolutePathInfo: { pathInfo: { path: 'users.0' } } } as any)
        .mockReturnValueOnce({ absolutePathInfo: { pathInfo: { path: 'products.0' } } } as any);

      buildPrimaryMappingRule(component, 'state', [binding1, binding2]);

      expect(getPathInfoMock).toHaveBeenCalledTimes(2);
      expect(getPathInfoMock).toHaveBeenNthCalledWith(1, 'user');
      expect(getPathInfoMock).toHaveBeenNthCalledWith(2, 'product');
    });
  });

  describe('getInnerAbsolutePathInfo', () => {
    it('マッピングが存在しない場合はnullを返すこと', () => {
      const outerAbsPathInfo = {} as any;

      const result = getInnerAbsolutePathInfo(component, outerAbsPathInfo);

      expect(result).toBeNull();
    });

    it('マッピングが存在する場合は対応するinnerAbsPathInfoを返すこと', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.0'
      } as any;

      const innerPathInfo = { path: 'user', segments: ['user'], cumulativePathInfoSet: new Set() } as any;
      const innerAbsPathInfo = { stateElement: innerStateElement, pathInfo: innerPathInfo } as any;
      const outerAbsPathInfo = { pathInfo: { path: 'users.0' } } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(innerPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: outerAbsPathInfo
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      const result = getInnerAbsolutePathInfo(component, outerAbsPathInfo);

      expect(result).toBe(innerAbsPathInfo);
    });

    it('マッピングは存在するが対応するキーが見つからない場合はnullを返すこと', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.0'
      } as any;

      const innerPathInfo = { path: 'user', segments: ['user'], cumulativePathInfoSet: new Set() } as any;
      const innerAbsPathInfo = { stateElement: innerStateElement, pathInfo: innerPathInfo } as any;
      const outerAbsPathInfo = { pathInfo: { path: 'users.0' } } as any;
      const differentOuterAbsPathInfo = { pathInfo: { path: 'products.0' } } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(innerPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: outerAbsPathInfo
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      // 異なるouterAbsPathInfoで検索
      const result = getInnerAbsolutePathInfo(component, differentOuterAbsPathInfo);

      expect(result).toBeNull();
    });
  });

  describe('getOuterAbsolutePathInfo', () => {
    it('キャッシュに存在する場合はキャッシュから返すこと', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.0'
      } as any;

      const innerPathInfo = { path: 'user', segments: ['user'], cumulativePathInfoSet: new Set() } as any;
      const innerAbsPathInfo = { stateElement: innerStateElement, pathInfo: innerPathInfo } as any;
      const outerAbsPathInfo = { pathInfo: { path: 'users.0' } } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(innerPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: outerAbsPathInfo
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      const result1 = getOuterAbsolutePathInfo(component, innerAbsPathInfo);
      const result2 = getOuterAbsolutePathInfo(component, innerAbsPathInfo);

      expect(result1).toBe(outerAbsPathInfo);
      expect(result2).toBe(outerAbsPathInfo);
    });

    it('プライマリマッピングルールセットが存在しない場合はエラーになること', () => {
      const innerAbsPathInfo = { pathInfo: { path: 'user' } } as any;

      expect(() => getOuterAbsolutePathInfo(component, innerAbsPathInfo)).toThrow(
        /Primary mapping rule set not found/
      );
    });

    it('サブパスの動的マッピングが正しく生成されること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const outerStateElement = { name: 'outer' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.*',
        stateName: 'default',
        node: component,
        replaceNode: component
      } as any;

      const userPathInfo = {
        path: 'user',
        segments: ['user'],
        cumulativePathInfoSet: new Set()
      } as any;
      const userNamePathInfo = {
        path: 'user.name',
        segments: ['user', 'name'],
        cumulativePathInfoSet: new Set([userPathInfo])
      } as any;
      const usersNamePathInfo = {
        path: 'users.*.name',
        segments: ['users', '*', 'name']
      } as any;

      const innerUserAbsPathInfo = { stateElement: innerStateElement, pathInfo: userPathInfo } as any;
      const innerUserNameAbsPathInfo = { stateElement: innerStateElement, pathInfo: userNamePathInfo } as any;
      const outerUsersAbsPathInfo = { pathInfo: { path: 'users.*', segments: ['users', '*'] } } as any;
      const outerUsersNameAbsPathInfo = { stateElement: outerStateElement, pathInfo: usersNamePathInfo } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      // buildPrimaryMappingRule用のモック
      getPathInfoMock.mockReturnValueOnce(userPathInfo);
      getAbsolutePathInfoMock.mockReturnValueOnce(innerUserAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValueOnce({
        absolutePathInfo: outerUsersAbsPathInfo
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      // getOuterAbsolutePathInfo用のモック
      component.getRootNode = vi.fn(() => document);
      getStateElementByNameMock.mockReturnValue(outerStateElement);
      getPathInfoMock.mockReturnValueOnce(usersNamePathInfo);
      getAbsolutePathInfoMock.mockReturnValueOnce(outerUsersNameAbsPathInfo);

      const result = getOuterAbsolutePathInfo(component, innerUserNameAbsPathInfo);

      expect(result).toBe(outerUsersNameAbsPathInfo);
      expect(getPathInfoMock).toHaveBeenCalledWith('users.*.name');
      expect(getAbsolutePathInfoMock).toHaveBeenCalledWith(outerStateElement, usersNamePathInfo);
      expect(addBindingByNodeMock).toHaveBeenCalledWith(component, expect.objectContaining({
        propName: 'user.name',
        propSegments: ['user', 'name'],
        statePathName: 'users.*.name'
      }));
    });

    it('マッチするプライマリルールが見つからない場合は詳細なエラーメッセージを表示すること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.*'
      } as any;

      const userPathInfo = {
        path: 'user',
        segments: ['user'],
        cumulativePathInfoSet: new Set()
      } as any;
      const productPathInfo = {
        path: 'product',
        segments: ['product'],
        cumulativePathInfoSet: new Set()
      } as any;

      const innerUserAbsPathInfo = { stateElement: innerStateElement, pathInfo: userPathInfo } as any;
      const innerProductAbsPathInfo = { stateElement: innerStateElement, pathInfo: productPathInfo } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(userPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerUserAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: { pathInfo: { path: 'users.*' } }
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      expect(() => getOuterAbsolutePathInfo(component, innerProductAbsPathInfo)).toThrow(
        /Mapping rule not found for inner path "product"/
      );
      expect(() => getOuterAbsolutePathInfo(component, innerProductAbsPathInfo)).toThrow(
        /Did you forget to bind this property in the component's data-wcs attribute?/
      );
      expect(() => getOuterAbsolutePathInfo(component, innerProductAbsPathInfo)).toThrow(
        /Available mappings: user/
      );
    });

    it('同じセグメント長のマッピングルールは重複エラーになること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.*'
      } as any;

      const userPathInfo = {
        path: 'user',
        segments: ['user'],
        cumulativePathInfoSet: new Set()
      } as any;

      // 別のAbsPathInfoオブジェクトだが、同じpathとsegmentsを持つ
      const innerUserAbsPathInfo1 = { stateElement: innerStateElement, pathInfo: userPathInfo } as any;
      const innerUserAbsPathInfo2 = {
        stateElement: innerStateElement,
        pathInfo: {
          path: 'user',
          segments: ['user'],
          cumulativePathInfoSet: new Set([userPathInfo])
        }
      } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValue(userPathInfo);
      getAbsolutePathInfoMock.mockReturnValue(innerUserAbsPathInfo1);
      getAbsoluteStateAddressByBindingMock.mockReturnValue({
        absolutePathInfo: { pathInfo: { path: 'users.*', segments: ['users', '*'] } }
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      // 異なるAbsPathInfoオブジェクトで同じセグメント長のパスにアクセス
      expect(() => getOuterAbsolutePathInfo(component, innerUserAbsPathInfo2)).toThrow(
        /Duplicate mapping rule for web component/
      );
    });

    it('outerStateElementが見つからない場合はエラーになること', () => {
      const innerStateElement = { name: 'inner' } as any;
      const binding: IBindingInfo = {
        propName: 'state.user',
        propSegments: ['state', 'user'],
        statePathName: 'users.*',
        stateName: 'missing',
        node: component,
        replaceNode: component
      } as any;

      const userPathInfo = {
        path: 'user',
        segments: ['user'],
        cumulativePathInfoSet: new Set()
      } as any;
      const userNamePathInfo = {
        path: 'user.name',
        segments: ['user', 'name'],
        cumulativePathInfoSet: new Set([userPathInfo])
      } as any;

      const innerUserAbsPathInfo = { stateElement: innerStateElement, pathInfo: userPathInfo } as any;
      const innerUserNameAbsPathInfo = { stateElement: innerStateElement, pathInfo: userNamePathInfo } as any;

      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      getPathInfoMock.mockReturnValueOnce(userPathInfo);
      getAbsolutePathInfoMock.mockReturnValueOnce(innerUserAbsPathInfo);
      getAbsoluteStateAddressByBindingMock.mockReturnValueOnce({
        absolutePathInfo: { pathInfo: { path: 'users.*', segments: ['users', '*'] } }
      } as any);

      buildPrimaryMappingRule(component, 'state', [binding]);

      component.getRootNode = vi.fn(() => document);
      getStateElementByNameMock.mockReturnValue(null);

      expect(() => getOuterAbsolutePathInfo(component, innerUserNameAbsPathInfo)).toThrow(
        /State element with name "missing" not found for web component/
      );
    });
  });
});
