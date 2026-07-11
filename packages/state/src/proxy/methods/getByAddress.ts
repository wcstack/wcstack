/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行  
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */

import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { IStateAddress } from "../../address/types";
import { getCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { getCommandNamespace } from "../../command/commandNamespace";
import { IStateElement } from "../../components/types";
import { STATE_COMMAND_NAMESPACE_NAME, STATE_STREAM_ERROR_NAMESPACE_NAME, STATE_STREAM_STATUS_NAMESPACE_NAME, WILDCARD } from "../../define";
import { raiseError } from "../../raiseError";
import { getStreamErrorNamespace, getStreamStatusNamespace } from "../../stream/streamNamespace";
import { IStateHandler } from "../types";
import { checkDependency } from "./checkDependency";

/**
 * namespace 配下のパスは raw state を持たないため、proxy の get トラップと同じ
 * namespace オブジェクトを辿る。1セグメント目は namespace 本体、2セグメント目以降は
 * namespace 上のキーを順に走査する。走査値が object / function 以外（null /
 * undefined / primitive の葉）になったら undefined を返す — 葉より深い読み
 * （例: `$streamStatus.<name>.<key>`、error が primitive throw のときの
 * `$streamError.<name>.message`）は宣言外アクセスと同じ undefined 解決とし、
 * Reflect.get の non-object TypeError を updater の drain に漏らさない
 * （§4-1 の throw しない寛容規約）。
 */
function walkNamespace(namespace: object, segments: string[]): any {
  let value: any = namespace;
  for (let i = 1; i < segments.length; i++) {
    // Object(v) !== v は「v が object / function でない」（= primitive / null / undefined）判定
    if (Object(value) !== value) {
      return undefined;
    }
    value = Reflect.get(value, segments[i]);
  }
  return value;
}

function _getByAddress(
  target   : object,
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement,
): any {
  const firstSegment = address.pathInfo.segments[0];
  if (firstSegment === STATE_COMMAND_NAMESPACE_NAME) {
    // $command 名前空間: キーは宣言済み command token 名
    return walkNamespace(getCommandNamespace(stateElement), address.pathInfo.segments);
  }
  if (firstSegment === STATE_STREAM_STATUS_NAMESPACE_NAME) {
    // $streamStatus / $streamError 名前空間: キーは宣言済み stream 名
    // （registry entry が正本の thin gateway、docs/state-streams-design.md §4-2）。
    // setByAddress の親走査もここを通るため、子への Reflect.set が namespace proxy の
    // raiseError に到達する = 書き込み防御（S11）もこの分岐で成立する。
    return walkNamespace(getStreamStatusNamespace(stateElement), address.pathInfo.segments);
  }
  if (firstSegment === STATE_STREAM_ERROR_NAMESPACE_NAME) {
    return walkNamespace(getStreamErrorNamespace(stateElement), address.pathInfo.segments);
  }
  if (address.pathInfo.path in target) {
    // getterの中で参照の可能性があるので、addressをプッシュする
    if (stateElement.getterPaths.has(address.pathInfo.path)) {
      handler.pushAddress(address);
      try {
        return Reflect.get(target, address.pathInfo.path, receiver);
      } finally {
        handler.popAddress();
      }
    } else {
      return Reflect.get(target, address.pathInfo.path);
    }
  } else {
    const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
    const parentValue = getByAddress(target, parentAddress, receiver, handler);
    const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
    if (lastSegment === WILDCARD) {
      const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
      return Reflect.get(parentValue, index);
    } else {
      return Reflect.get(parentValue, lastSegment);
    }
  }
}

function _getByAddressWithCache(
  target   : object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement
): any {
  const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
  const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
  const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
  if (cacheEntry !== null && cacheEntry.dirty === false) {
    return cacheEntry.value;
  }
  const value = _getByAddress(target, address, receiver, handler, stateElement);
  setCacheEntryByAbsoluteStateAddress(absAddress, {
    value: value,
    dirty: false
  });
  return value;
}

export function getByAddress(
  target   : object,
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler
): any {
  checkDependency(handler, address);
  const stateElement = handler.stateElement;
  const cacheable = address.pathInfo.wildcardCount > 0 || 
                    stateElement.getterPaths.has(address.pathInfo.path);
  if (cacheable) {
    return _getByAddressWithCache(target, address, receiver, handler, stateElement);
  } else {
    return _getByAddress(target, address, receiver, handler, stateElement);
  }
}
