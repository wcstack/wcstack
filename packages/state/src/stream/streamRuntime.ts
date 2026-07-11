/**
 * stream/streamRuntime.ts
 *
 * `$streams` の起動・チャンク反映・status 遷移（docs/state-streams-design.md
 * §2-2 / §3-3 / §4-3）。
 *
 * Phase A スコープ:
 * - eager 起動（startStreams）と start = restart の共通手順（startStream）のみ。
 * - args は readonly proxy で同期評価するだけで依存捕捉（トレース）は行わない。
 *   依存駆動 restart（drain フック・trackArgs）は Phase C で配線する。
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

import type { IStateElement } from "../components/types";
import {
  DELIMITER,
  STATE_STREAMS_NAME,
  STATE_STREAM_ERROR_NAMESPACE_NAME,
  STATE_STREAM_STATUS_NAMESPACE_NAME,
} from "../define";
import { raiseError } from "../raiseError";
import { consumeSource } from "./consumeSource";
import { getStreamEntries } from "./streamRegistry";
import type { IConsumeSink, IStreamEntry, StreamStatus } from "./types";

/**
 * 登録済みの全 stream を起動する（eager 起動、設計書 §2-3）。
 * State.connectedCallback（$connectedCallback 完了後）から呼ばれる想定。
 */
export function startStreams(stateElement: IStateElement): void {
  for (const entry of getStreamEntries(stateElement).values()) {
    startStream(stateElement, entry);
  }
}

/**
 * stream を起動する。start = restart の共通手順（設計書 §2-2）:
 *
 * 1. 旧 run を abort（restart 時）→ 新 AbortController
 * 2. args を readonly proxy で同期評価（Promise が返ったら raiseError）
 * 3. 値を initial にリセット（起動 = 最初の run も restart と同一セマンティクス、§1-3）
 * 4. status="active"・error=null を反映
 * 5. consumeSource で消費開始
 */
export function startStream(stateElement: IStateElement, entry: IStreamEntry): void {
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;

  // args 評価（Phase A: 評価のみ。依存捕捉は Phase C の trackArgs で差し替える）
  let argsValue: unknown = undefined;
  const argsFn = entry.definition.args;
  if (argsFn !== null) {
    stateElement.createState("readonly", (state) => {
      argsValue = argsFn(state);
    });
    if (argsValue instanceof Promise) {
      raiseError(
        `${STATE_STREAMS_NAME} entry "${entry.name}" args must be synchronous (it returned a Promise).`,
      );
    }
  }

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
 * - registry entry が正本。変化した項目だけ書き換える。
 * - 変化した項目に対応する名前空間パス（`$streamStatus.<name>` / `$streamError.<name>`）
 *   だけを writable proxy の $postUpdate で通知する（updater enqueue ＋ walkDependency）。
 * - 両方不変なら何もしない（名前空間パスは setByAddress を通らないため
 *   sameValueGuard が効かず、同等の same-value 判定を runtime 側が持つ）。
 */
export function updateStreamStatus(
  stateElement: IStateElement,
  entry: IStreamEntry,
  status: StreamStatus,
  error: unknown,
): void {
  const statusChanged = entry.status !== status;
  const errorChanged = !Object.is(entry.error, error);
  if (!statusChanged && !errorChanged) {
    return;
  }
  if (statusChanged) {
    entry.status = status;
  }
  if (errorChanged) {
    entry.error = error;
  }
  stateElement.createState("writable", (state) => {
    if (statusChanged) {
      state.$postUpdate(`${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
    }
    if (errorChanged) {
      state.$postUpdate(`${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
    }
  });
}
