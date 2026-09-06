/**
 * setAll.ts
 *
 * ワイルドカードを含む State パスにマッチする**全アドレスへ一括で書き込む**。
 * `$getAll`（読み）の対称形（docs/state-set-all-design.md）。
 *
 * 存在理由は糖衣ではなく「**リスト全置換の回避**」（設計 §1-1）。
 * `this.users = this.users.map(...)` は配列を作り直すので ListIndex・行 getter
 * キャッシュ・差分描画がまとめて作り直しになる。`$setAll` は意味としては一括更新、
 * 実体は in-place な個別書き込みで、同じことを差分に載せたまま行う。
 *
 * 3 つの形（設計 §2）:
 * - ブロードキャスト  `$setAll(path, indexes, value)`
 * - mapper（第一級）  `$setAll(path, indexes, (current, ...indexes) => next)`
 * - spread            `$setAll(path, indexes, values, { spread: true })`
 */

import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { IStateAddress } from "../../address/types";
import { indexArityMessage, setAllSpreadArityMessage, setAllValueKindMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getByAddress } from "../methods/getByAddress";
import { getListIndexByIndexes } from "../methods/getListIndexByIndexes";
import { setByAddress } from "../methods/setByAddress";
import { IStateHandler } from "../types";
import { collectWildcardIndexes } from "./wildcardIndexes";

export interface ISetAllOptions {
  /**
   * `values` を**マッチ順に 1 件ずつ配る**。既定（省略/false）では配列もそのまま
   * ブロードキャストされる — 対象プロパティ自体が配列型のとき区別がつかないため、
   * 配分は明示的にオプトインさせる（設計 §3）。
   */
  readonly spread?: boolean;
}

type SetAllFunction = (
  path: string,
  indexes: number[],
  value: any,
  options?: ISetAllOptions,
) => number;

export function setAll(
  target  : object,
  _prop   : PropertyKey,
  receiver: any,
  handler : IStateHandler
): SetAllFunction {
  return (path: string, indexes: number[], value: any, options?: ISetAllOptions): number => {
    const pathInfo = getPathInfo(path);

    // 書き込み API に暗黙の文脈依存は持たせない。`for` の中で `[]` と書けば
    // 「現在行」ではなく「全行」を意味する（設計 §4-1）。
    if (!Array.isArray(indexes)) {
      raiseError(setAllValueKindMessage(path, "requires an explicit indexes array (pass [] to expand every level)."));
    }
    // 添字は前方一致の接頭辞なので不足は正当。超過だけを弾く（`$getAll` と同じ規則）。
    if (indexes.length > pathInfo.wildcardParentPathInfos.length) {
      raiseError(indexArityMessage("$setAll", path, pathInfo.wildcardParentPathInfos.length, indexes.length));
    }

    const spread = options?.spread === true;
    const isMapper = typeof value === "function";
    if (spread && isMapper) {
      raiseError(setAllValueKindMessage(path, "cannot combine { spread: true } with a mapper function."));
    }
    if (spread && !Array.isArray(value)) {
      raiseError(setAllValueKindMessage(path, "requires an array as the value when { spread: true } is set."));
    }

    // --- 第 1 相: 書き込み先を全部確定する（設計 §6） ---
    // 走査しながら書くと書き込みが ListIndex 集合を動かしうる。
    // 差分基準（lastValueByListAddress）は読みの持ち物なので commit しない（§6-2）。
    const resultIndexes = collectWildcardIndexes(
      target, receiver, handler, pathInfo, indexes, { commitDiffBaseline: false });

    if (spread && (value as unknown[]).length !== resultIndexes.length) {
      raiseError(setAllSpreadArityMessage(path, resultIndexes.length, (value as unknown[]).length));
    }

    const addresses: IStateAddress[] = [];
    for(let i = 0; i < resultIndexes.length; i++) {
      const listIndex = getListIndexByIndexes(target, receiver, handler, pathInfo, resultIndexes[i]);
      addresses.push(createStateAddress(pathInfo, listIndex));
    }

    // --- 第 2 相: 確定したアドレスにだけ書く ---
    let written = 0;
    for(let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      let nextValue: any;
      if (isMapper) {
        // 現在値は書く直前に読む。先行する書き込みが getter 経由で他行に及ぶ場合、
        // mapper が見るべきなのは最新値。
        const currentValue = getByAddress(target, address, receiver, handler);
        nextValue = value(currentValue, ...resultIndexes[i]);
      } else if (spread) {
        nextValue = (value as unknown[])[i];
      } else {
        nextValue = value;
      }
      // undefined は常にスキップ（設計 §5）。mapper の return 忘れで全行を潰さないため、
      // かつ「この行は変えない」を表現できるようにするため。クリアは null。
      if (typeof nextValue === "undefined") {
        continue;
      }
      setByAddress(target, address, nextValue, receiver, handler);
      written++;
    }
    return written;
  };
}
