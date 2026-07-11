/**
 * stream/streamRuntime.ts
 *
 * `$streams` の起動・チャンク反映・status 遷移（docs/state-streams-design.md
 * §2-2 / §3-3 / §4-3）。
 *
 * スコープ:
 * - eager 起動（startStreams）と start = restart の共通手順（startStream）。
 * - args は traceArgs（stream/argsTrace.ts）で readonly proxy 評価と同時に依存を
 *   per-run 再捕捉する（§3-1）。
 * - 依存駆動 restart（§3-2）: モジュール初期化時に updater の drain 終了リスナーを
 *   1 つ登録し（restartStreamsOnUpdateBatch）、起動中 stateElement
 *   （stream/activeStateElements.ts — startStreams で add・abortAllStreams /
 *   clearStreamRegistry で delete）の各 entry について depAddresses と batch を
 *   交差させ、hit した entry を restart する。
 *
 * 切断後の後始末について（不変条件）:
 * - disconnect（abortAllStreams）は registry entry を直接ミューテーションして
 *   idle に戻す（$postUpdate は呼ばない — 切断済みで binding 更新は不要かつ
 *   rootNode が無い）。
 * - abort 済み run の sink コールバック（fold / done / fail）は consumeSource の
 *   stale-drop（全経路の signal.aborted チェック）が createState 到達前に
 *   落とすため、runtime 側に切断後ガードは不要。
 *   「runtime が createState を呼ぶのは自分の controller が生きている間だけ」が
 *   この 2 つの組み合わせで常に保たれる。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import {
  DELIMITER,
  STATE_STREAM_ERROR_NAMESPACE_NAME,
  STATE_STREAM_STATUS_NAMESPACE_NAME,
} from "../define";
import { registerUpdateBatchListener } from "../updater/updater";
import { addActiveStateElement, getActiveStateElements } from "./activeStateElements";
import { traceArgs } from "./argsTrace";
import { consumeSource } from "./consumeSource";
import { getLastNotified, setLastNotified } from "./lastNotified";
import { getStreamEntries } from "./streamRegistry";
import type { IConsumeSink, IStreamEntry, StreamStatus } from "./types";

/**
 * 登録済みの全 stream を起動する（eager 起動、設計書 §2-3）。
 * State.connectedCallback（$connectedCallback 完了後）と接続中の `_state` 再 set
 * から呼ばれる想定。
 *
 * 同時に依存駆動 restart（§3-2）の対象として activeStateElements に登録する
 * （delete 側は abortAllStreams / clearStreamRegistry —
 *  stream/activeStateElements.ts のリーク防止不変条件を参照）。
 * eager 起動の throw（args のユーザー例外等）はここでは正規化せず loud fail のまま
 * （既存の $connectedCallback と同じ扱い。正規化は drain リスナー側の restart のみ）。
 */
export function startStreams(stateElement: IStateElement): void {
  const entries = getStreamEntries(stateElement);
  if (entries.size === 0) {
    return;
  }
  addActiveStateElement(stateElement);
  for (const entry of entries.values()) {
    startStream(stateElement, entry);
  }
}

/**
 * stream を起動する。start = restart の共通手順（設計書 §2-2）:
 *
 * 1. 旧 run を abort（restart 時）→ 新 AbortController
 * 2. traceArgs で args を readonly proxy 評価し依存を丸ごと再捕捉
 *    （Promise / 自己依存 / wildcard 読みは raiseError、§3-1）
 * 3. 値を initial にリセット（起動 = 最初の run も restart と同一セマンティクス、§1-3）
 * 4. status="active"・error=null を反映
 * 5. consumeSource で消費開始
 */
export function startStream(stateElement: IStateElement, entry: IStreamEntry): void {
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;

  // args 評価 ＋ 依存の per-run 再捕捉（args === null なら depAddresses を clear して
  // undefined。Promise / 自己依存 / wildcard 読みは raiseError、§3-1）
  const argsValue = traceArgs(stateElement, entry);

  // 値リセット: setByAddress を通すことで updater coalesce・sameValueGuard・
  // walkDependency（stream 値に依存する computed の dirty 化）がすべて乗る（§3-3）
  stateElement.createState("writable", (state) => {
    state[entry.name] = entry.definition.initial;
  });

  updateStreamStatus(stateElement, entry, "active", null);

  const definition = entry.definition;
  const sink: IConsumeSink = {
    fold(chunk: unknown): void {
      // fold の throw はそのまま伝播させる（consumeSource が fail 経路に回す）
      stateElement.createState("writable", (state) => {
        state[entry.name] = definition.fold(state[entry.name], chunk);
      });
    },
    done(): void {
      updateStreamStatus(stateElement, entry, "done", null);
    },
    fail(error: unknown): void {
      // 値は直前の fold 結果を保持（リセットしない）
      updateStreamStatus(stateElement, entry, "error", error);
      // fold-throw 時の producer 掃除（iterator.return() / reader.cancel() を発火）。
      // source-throw 時は producer が既に終了しているので abort は無害（§3-3）。
      controller.abort();
    },
  };
  void consumeSource(definition.source, argsValue, controller.signal, sink);
}

/**
 * status / error の反映ヘルパ（設計書 §4-3）。
 *
 * - registry entry が正本。常に最新値へ書き換える。
 * - 「最後に通知した観測値」（stream/lastNotified.ts — 再 set・再接続を跨いで
 *   stateElement の寿命で生存する台帳）から変化した項目に対応する名前空間パス
 *   （`$streamStatus.<name>` / `$streamError.<name>`）だけを writable proxy の
 *   $postUpdate で通知する（updater enqueue ＋ walkDependency）。
 * - 両方不変なら通知しない（名前空間パスは setByAddress を通らないため
 *   sameValueGuard が効かず、同等の same-value 判定を runtime 側が持つ）。
 *   abortAllStreams の無通知ミューテーションで台帳が invalidate されている場合は
 *   同値扱いにならず必ず通知される（再接続ウィンドウ内の fresh 読みが描画した
 *   idle の恒久陳腐化を防ぐ、§4-3）。
 */
export function updateStreamStatus(
  stateElement: IStateElement,
  entry: IStreamEntry,
  status: StreamStatus,
  error: unknown,
): void {
  entry.status = status;
  entry.error = error;
  const last = getLastNotified(stateElement, entry.name);
  const statusChanged = last.status !== status;
  const errorChanged = !Object.is(last.error, error);
  if (!statusChanged && !errorChanged) {
    return;
  }
  setLastNotified(stateElement, entry.name, status, error);
  stateElement.createState("writable", (state) => {
    if (statusChanged) {
      state.$postUpdate(`${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
    }
    if (errorChanged) {
      state.$postUpdate(`${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
    }
  });
}

/**
 * 依存駆動 restart の drain リスナー（設計書 §3-2）。
 * モジュール初期化時に registerUpdateBatchListener で 1 つだけ登録される。
 *
 * - 起動中の各 stateElement の各 entry について、depAddresses と batch の交差を
 *   Set.has のインスタンス同一性で判定する（小さい方 = depAddresses を回して
 *   batch.has(dep)。AbsoluteStateAddress はキャッシュにより同一 (stateName, path,
 *   listIndex) が同一インスタンス、§2-1）。args なし（depAddresses 空）の entry は
 *   自然にスキップされる。
 * - status は問わず restart する（done / error からも依存の叩き直しで再試行、§2-2）。
 * - hit は収集してから一括で restart する（イテレーション中の registry 変更を避ける。
 *   entry ごとに最初の hit で break するため「1 drain につき 1 entry 最大 1 restart」
 *   もここで自然に成立する — 同一 tick 内の複数依存書き込みは 1 restart に畳まれる）。
 * - hits の実行時にも activeStateElements を再チェックする: 先行 restart の source は
 *   consumeSource の同期プレフィックスで同期実行されるため、そこで他の stateElement
 *   （や自分自身のホスト）が同期切断されると、収集済み hits に切断済み要素が残る。
 *   切断済み要素へ startStream すると createState が rootNode 不在で throw し、
 *   catch 内の updateStreamStatus も同じ理由で再 throw して drain リスナー外へ漏れる
 *   （§3-2「未接続の stateElement の entry は restart しない」・§5-1「切断後は idle」
 *   の両方に違反する）ため、実行時点で active でない要素はスキップする。
 * - restart（startStream）は entry ごとに try/catch し、throw（args のユーザー例外・
 *   Promise 同期契約違反等）は controller.abort() → status="error"・$streamError 格納
 *   に正規化する（§3-2 規範 3）。updater の drain を壊さず、他 entry の restart も
 *   継続する。eager 起動（connect 時の startStreams）の throw は従来どおり loud fail。
 * - restart 内の書き込み（initial リセット・status 通知）は updater への enqueue のみで
 *   新しい microtask バッチを作る（drain 再入ではない）。自己依存は traceArgs が
 *   宣言時に raiseError で検出するため、restart 書き込みが自分の依存に再 hit する
 *   ループは起きない（§3-1）。
 */
function restartStreamsOnUpdateBatch(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  const activeStateElements = getActiveStateElements();
  if (activeStateElements.size === 0) {
    // stream 未使用アプリの drain に配列・イテレータ割り当てのコストを載せない
    return;
  }
  const hits: { stateElement: IStateElement; entry: IStreamEntry }[] = [];
  for (const stateElement of activeStateElements) {
    for (const entry of getStreamEntries(stateElement).values()) {
      for (const dep of entry.depAddresses) {
        if (batch.has(dep)) {
          hits.push({ stateElement, entry });
          break;
        }
      }
    }
  }
  for (const { stateElement, entry } of hits) {
    // 先行 restart の source 同期実行が他要素を切断し得るため、実行時に再チェック
    // （live な Set ビューなので同期切断が即時反映される。モジュールヘッダ参照）
    if (!activeStateElements.has(stateElement)) {
      continue;
    }
    try {
      startStream(stateElement, entry);
    } catch (e) {
      entry.controller?.abort();
      updateStreamStatus(stateElement, entry, "error", e);
    }
  }
}

registerUpdateBatchListener(restartStreamsOnUpdateBatch);
