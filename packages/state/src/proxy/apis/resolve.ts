/**
 * resolve.ts
 *
 * StateClassのAPIとして、パス（path）とインデックス（indexes）を指定して
 * Stateの値を取得・設定するための関数（resolve）の実装です。
 *
 * 主な役割:
 * - 文字列パス（path）とインデックス配列（indexes）から、該当するState値の取得・設定を行う
 * - ワイルドカードや多重ループを含むパスにも対応
 * - value未指定時は取得（getByRef）、指定時は設定（setByRef）を実行
 *
 * 設計ポイント:
 * - getStructuredPathInfoでパスを解析し、ワイルドカード階層ごとにリストインデックスを解決
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - getByRef/setByRefで値の取得・設定を一元的に処理
 * - 柔軟なバインディングやAPI経由での利用が可能
 */
import { getStructuredPathInfo } from "../../StateProperty/getStructuredPathInfo.js";
import { raiseError } from "../../utils.js";
import { IStateHandler, IStateProxy } from "../_types.js";
import { IListIndex } from "../../ListIndex/types.js";
import { getStatePropertyRef } from "../../StatePropertyRef/StatepropertyRef.js";
import { GetListIndexesByRefSymbol, SetByRefSymbol } from "../_symbols.js";
import { setByRef } from "../methods/setByAddress.js";
import { getByRef } from "../methods/getByAddress.js";

export function resolve(
  target: Object, 
  prop: PropertyKey, 
  receiver: IStateProxy,
  handler: IStateHandler
): Function {
  return (path: string, indexes: number[], value?: any): any => {
    const info = getStructuredPathInfo(path);
    const lastInfo = handler.lastRefStack?.info ?? null;
    if (lastInfo !== null && lastInfo.pattern !== info.pattern) {
      // gettersに含まれる場合は依存関係を登録
      if (handler.engine.pathManager.onlyGetters.has(lastInfo.pattern)) {
        handler.engine.pathManager.addDynamicDependency(lastInfo.pattern, info.pattern);
      }
    }

    if (info.wildcardParentInfos.length > indexes.length) {
      raiseError({
        code: 'STATE-202',
        message: `indexes length is insufficient: ${path}`,
        context: { path, expected: info.wildcardParentInfos.length, received: indexes.length },
        docsUrl: '/docs/error-codes.md#state',
        severity: 'error',
      });
    }
    // ワイルドカード階層ごとにListIndexを解決していく
    let listIndex: IListIndex | null = null;
    for(let i = 0; i < info.wildcardParentInfos.length; i++) {
      const wildcardParentPattern = info.wildcardParentInfos[i];
      const wildcardRef = getStatePropertyRef(wildcardParentPattern, listIndex);
      const tmpValue = getByRef(target, wildcardRef, receiver, handler);
      const listIndexes = receiver[GetListIndexesByRefSymbol](wildcardRef);
      if (listIndexes == null) {
        raiseError({
          code: 'LIST-201',
          message: `ListIndexes not found: ${wildcardParentPattern.pattern}`,
          context: { pattern: wildcardParentPattern.pattern },
          docsUrl: '/docs/error-codes.md#list',
          severity: 'error',
        });
      }
      const index = indexes[i];
      listIndex = listIndexes[index] ?? raiseError({
        code: 'LIST-201',
        message: `ListIndex not found: ${wildcardParentPattern.pattern}`,
        context: { pattern: wildcardParentPattern.pattern, index },
        docsUrl: '/docs/error-codes.md#list',
        severity: 'error',
      });
    }

    // WritableかReadonlyかを判定して適切なメソッドを呼び出す
    const ref = getStatePropertyRef(info, listIndex);
    const hasSetValue = typeof value !== "undefined";
    if (SetByRefSymbol in receiver) {
      if (!hasSetValue) {
        return getByRef(target, ref, receiver, handler);
      } else {
        setByRef(target, ref, value, receiver, handler);
      }
    } else {
      if (!hasSetValue) {
        return getByRef(target, ref, receiver, handler);
      } else {
        // readonlyなので、setはできない
        raiseError({
          code: 'STATE-202',
          message: `Cannot set value on a readonly proxy: ${path}`,
          context: { path },
          docsUrl: '/docs/error-codes.md#state',
          severity: 'error',
        });
      }
    }
  };
} 