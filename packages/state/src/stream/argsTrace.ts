/**
 * stream/argsTrace.ts
 *
 * `$streams` の args トレース（依存捕捉、docs/state-streams-design.md §3-1）。
 *
 * - モジュールスコープの collector を立てて readonly proxy 上で args を評価し、
 *   getByAddress を通った読みを絶対アドレス（IAbsoluteStateAddress）として捕捉する。
 *   AbsolutePathInfo / AbsoluteStateAddress は両方キャッシュ済みのため、捕捉した
 *   アドレスは drain バッチと Set.has のインスタンス同一性で O(1) 照合できる（§2-1）。
 * - collectStreamDependency は getByAddress のホットパスから毎読み呼ばれるため、
 *   collector === null なら即 return し、それ以外の計算を一切しない。
 * - 起動・restart のたびに traceArgs が呼ばれ、成功時は entry.depAddresses を
 *   丸ごと置換する（per-run の動的再捕捉）。失敗時は前回成功 run の検証済み
 *   捕捉を保持する（§2-2 の「error からも依存変化で restart」を保つ）。
 * - lastNotified.ts と同じく import 循環回避のための小モジュール
 *   （getByAddress → argsTrace ← streamRuntime の一方向依存に保つ）。
 */

import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import type { IAbsoluteStateAddress, IStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import {
  DELIMITER,
  STATE_STREAMS_NAME,
  STATE_STREAM_ERROR_NAMESPACE_NAME,
  STATE_STREAM_STATUS_NAMESPACE_NAME,
} from "../define";
import { raiseError } from "../raiseError";
import type { IStreamEntry } from "./types";

/** トレース中のみ非 null。getByAddress を通った読みの絶対アドレスが溜まる。 */
let collector: Set<IAbsoluteStateAddress> | null = null;

/**
 * getByAddress の入口（checkDependency 直後）から毎読み呼ばれるフック。
 * トレース外（collector === null）では何もしない。
 */
export function collectStreamDependency(stateElement: IStateElement, address: IStateAddress): void {
  if (collector === null) {
    return;
  }
  const absolutePathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
  collector.add(createAbsoluteStateAddress(absolutePathInfo, address.listIndex));
}

/**
 * args を readonly proxy で同期評価し、読まれたパスを entry.depAddresses に
 * 丸ごと置換で再捕捉する（§3-1）。評価値（source の第 1 引数になる）を返す。
 *
 * - args === null（宣言で省略）なら depAddresses を clear して undefined
 *   （依存なし = 起動後 restart しない）。
 * - 検査（違反は raiseError）:
 *   (a) 評価値が Promise（同期契約違反）
 *   (b) 自己依存 — `<name>` / `$streamStatus.<name>` / `$streamError.<name>` の読み
 *       （restart の自己書き込みで再発火する無限ループ、S8）
 *   (c) wildcard を含むパスの読み（`$getAll` 等も同様。第 1 段スコープ外）
 * - 失敗時（args のユーザー例外・検査違反）は今回の捕捉（captured）を採用せず
 *   伝播し、entry.depAddresses には**前回成功 run の検証済み捕捉を保持する**。
 *   これにより drain リスナーが throw を error 経路に正規化したあとも、依存の
 *   書き込みで再試行できる（§2-2「done / error からも依存変化で restart」——
 *   一時的な args throw で stream が恒久固着しない）。ループ安全性:
 *   保持されるのは前回**成功** run の捕捉のみ（自己依存・wildcard 検査済み）で
 *   自分の `<name>` / `$streamStatus.<name>` / `$streamError.<name>` を含み得ず、
 *   traceArgs throw 時の startStream は initial リセットに到達しないため、
 *   error 正規化の書き込みが保持 deps に再 hit することはない。再試行は依存
 *   書き込み 1 回につき高々 1 回で有界。未検査の captured を採用しないことが
 *   ループ防止の要件であり、前回検証済み捕捉の保持はそれを侵さない。
 * - collector は finally で必ず復元する（例外・再入安全。ネスト評価は想定しないが
 *   防御的に「前の collector を復元」の形にしておく — コストは同等）。
 */
export function traceArgs(stateElement: IStateElement, entry: IStreamEntry): unknown {
  const argsFn = entry.definition.args;
  if (argsFn === null) {
    entry.depAddresses.clear();
    return undefined;
  }
  const previousCollector = collector;
  const captured = new Set<IAbsoluteStateAddress>();
  collector = captured;
  let argsValue: unknown = undefined;
  try {
    stateElement.createState("readonly", (state) => {
      argsValue = argsFn(state);
    });
  } finally {
    // args のユーザー例外時は captured を採用せずそのまま伝播する
    // （entry.depAddresses は前回成功 run の検証済み捕捉を保持）
    collector = previousCollector;
  }
  if (argsValue instanceof Promise) {
    raiseError(
      `${STATE_STREAMS_NAME} entry "${entry.name}" args must be synchronous (it returned a Promise).`,
    );
  }
  const selfStatusPath = `${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}${entry.name}`;
  const selfErrorPath = `${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}${entry.name}`;
  for (const dep of captured) {
    const pathInfo = dep.absolutePathInfo.pathInfo;
    if (
      dep.absolutePathInfo.stateElement === stateElement &&
      (pathInfo.path === entry.name || pathInfo.path === selfStatusPath || pathInfo.path === selfErrorPath)
    ) {
      raiseError(
        `${STATE_STREAMS_NAME} entry "${entry.name}" args must not read the stream itself ("${pathInfo.path}"): a self-dependency would restart the stream on its own writes (infinite loop).`,
      );
    }
    if (pathInfo.wildcardCount > 0) {
      raiseError(
        `${STATE_STREAMS_NAME} entry "${entry.name}" args must not read wildcard paths ("${pathInfo.path}"): wildcard dependencies are out of scope.`,
      );
    }
  }
  entry.depAddresses = captured;
  return argsValue;
}
