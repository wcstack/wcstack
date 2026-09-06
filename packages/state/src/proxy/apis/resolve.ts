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

import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { indexArityMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getByAddress } from "../methods/getByAddress";
import { getListIndexByIndexes } from "../methods/getListIndexByIndexes";
import { setByAddress } from "../methods/setByAddress";
import { IStateHandler } from "../types";

type ResolveFunction = (path: string, indexes: number[], value?: any) => any;

export function resolve(
  target: object, 
  _prop: PropertyKey, 
  receiver: any,
  handler: IStateHandler
): ResolveFunction {
  return (path: string, indexes: number[], value?: any): any => {
    const pathInfo = getPathInfo(path);
    if (handler.addressStackLength > 0) {
      const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
      const stateElement = handler.stateElement;
      if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
        // gettersに含まれる場合は依存関係を登録
        if (stateElement.getterPaths.has(lastInfo.path)) {
          stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
        }
      }
    }

    // 添字の本数はワイルドカードの本数と**厳密に一致**する必要がある。
    // 不足は元から throw していたが、超過は黙って無視されていた（余分な要素を
    // 誰も読まないため）＝ `$resolve("items.*.price", [row, col])` のような
    // 「1 本しか無いのに 2 本渡す」取り違えが、間違った値を返したまま通っていた。
    if (indexes.length !== pathInfo.wildcardParentPathInfos.length) {
      raiseError(indexArityMessage("$resolve", path, pathInfo.wildcardParentPathInfos.length, indexes.length));
    }
    // ワイルドカード階層ごとにListIndexを解決していく（`$setAll` と共有）
    const listIndex = getListIndexByIndexes(target, receiver, handler, pathInfo, indexes);

    // ToDo:WritableかReadonlyかを判定して適切なメソッドを呼び出す
    const address = createStateAddress(pathInfo, listIndex);
    const hasSetValue = typeof value !== "undefined";
    if (!hasSetValue) {
      return getByAddress(target, address, receiver, handler);
    } else {
      setByAddress(target, address, value, receiver, handler);
    }
  };
} 