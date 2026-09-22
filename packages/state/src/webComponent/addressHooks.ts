/**
 * webComponent/addressHooks.ts — スコープ機能（bind-component のマウント・`mount=` のボリューム）を
 * 持つ state に付く hook（設計案 H1、S3）。従来 core（getByAddress / setByAddress / get トラップ /
 * event/handler / pathDiagnostics / updatedCallback / applyChangeToFor）が直接 import していた分岐をここへ移し、
 * マウントもボリュームも無い state では一切走らない。
 *
 * 付ける時点: マウント記録の登録（State.markHasMounts）・ボリュームのスロット予約と接ぎ木
 * （State.markHasVolume / markHasGraftedVolumes）。ルートより先に予約されたボリュームは、ルートの
 * 登録時（stateElementByName の登録 listener — volume.ts の installVolumeGraft）に付く。
 * hook は要素の寿命の間は付いたままなので、各 hook は従来どおり `hasMounts` / `hasGraftedVolumes` の
 * boolean で自分の分岐を守る。
 */
import { IAddressHooks, NOT_HANDLED, registerFeatureHooks } from "../core/addressHooks";
import { getScopedIndexes } from "../list/wildcardLevel";
import { raiseError } from "../raiseError";
import { resolveExport } from "./exportIndex";
import { findMountRecordForNode, getIndexShiftForMarkerPath, getMountRecordByPath } from "./mount";
import { createOverlayValue, readExportedAccessor, writeExportedAccessor } from "./overlay";
import { remountScopesUnderContent } from "./mountScope";
import { createVolumeChroot, findGraftedSlotUnder, getVolumeUpdatedCallbacks, isPathUnderReservedVolume, relativeVolumePath } from "./volumeShared";

export const scopeAddressHooks: IAddressHooks = {
  // マウントのオーバーレイ dispatch（Phase 2・D20）。掛かるのは「マーカーで終わるパス」だけで、
  // その下（私有キー・getter・メソッド）の読み書きは通常の親ウォークが返された proxy への
  // 素の Reflect.get / Reflect.set として続く（overlay.ts）
  read(stateElement, address, receiver, handler) {
    if (stateElement.hasMounts === true && address.pathInfo.lastSegment.charCodeAt(0) === 35 /* '#' */) {
      const mountRecord = getMountRecordByPath(stateElement, address.pathInfo.path);
      if (mountRecord !== null) {
        return createOverlayValue(mountRecord, address, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  readMissing(stateElement, address, parentValue, receiver, handler) {
    if (parentValue === null) {
      // 予約済みのボリュームスロット（D22）: ロード前の読みは undefined が正で、深いパスの
      // 親歩きがルート欠落に落ちても騒がない。読みは createState セッション内でしか起きず、
      // その間 rootNode は必ず有効（切断で null 化されるのは disconnectedCallback — セッション外）
      if (isPathUnderReservedVolume((stateElement as { rootNode?: Node }).rootNode ?? null, address.pathInfo.path)) {
        return undefined;
      }
      return NOT_HANDLED;
    }
    // 公開 getter の dispatch（docs/state-overlay-export-design.md §2-1）: 掛かるのは
    // 「ツリーの未存在キー」の分岐だけ（X1 — 命中する読みは無改造）
    if (stateElement.hasMounts === true) {
      const exported = resolveExport(stateElement, address.parentAddress!.pathInfo.path, address.pathInfo.lastSegment, address.listIndex);
      if (exported !== null) {
        return readExportedAccessor(exported.record, exported.entry, address.listIndex, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  // D22 後段: 接ぎ木済みボリュームのマウントポイントを**含む親**の丸ごと書きは throw
  // （設計書 §4-2）。黙って通すと接ぎ木データが消え、quoted-path アクセサだけが
  // 宙に浮いて原因の見えない undefined / TypeError になる。スロット自身への書き込みは
  // 通常のデータ差し替えとして通す
  write(stateElement, address) {
    if (stateElement.hasGraftedVolumes === true) {
      const path = address.pathInfo.path;
      const shadowedSlot = findGraftedSlotUnder(stateElement, path);
      if (shadowedSlot !== null) {
        raiseError(
          `Cannot replace "${path}" wholesale: a volume is mounted at "${shadowedSlot}" under it (D22). ` +
          `Replacing an ancestor of a mount point silently discards the grafted data while its accessors remain. ` +
          `Write "${shadowedSlot}" itself, or individual fields inside "${path}", instead.`,
        );
      }
    }
    return NOT_HANDLED;
  },
  // 公開 getter への書き込み（docs/state-overlay-export-design.md X9）: 未存在キーへの
  // 書き込みは今日「ツリーに作る」が、その位置に公開 getter があると以後ツリーが勝ち
  // （X1）getter を無言で隠す。setter があれば setter、無ければ raise（overlay の set）
  writeMissing(stateElement, address, _parentValue, _key, value, receiver, handler) {
    if (stateElement.hasMounts === true) {
      const exported = resolveExport(stateElement, address.parentAddress!.pathInfo.path, address.pathInfo.lastSegment, address.listIndex);
      if (exported !== null) {
        return writeExportedAccessor(exported.record, exported.entry, address.listIndex, value, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  // マウントのアクセサ評価中（マーカーパスが push されている）はスコープ相対の Δ を
  // 足す（設計書 §4-4: `$n → listIndex.at(Δ + n - 1)`。テンプレート側の `$n` は
  // 変換時に織り込み済み — mount.ts の translateInnerPath）
  indexShift(handler, lastAddress) {
    const stateElement = handler.stateElement;
    const lastPath = lastAddress.pathInfo.path;
    if (stateElement.hasMounts === true && lastPath.indexOf('#') !== -1) {
      const mountRecord = getMountRecordByPath(stateElement, lastPath);
      if (mountRecord !== null) {
        return getIndexShiftForMarkerPath(mountRecord, lastPath);
      }
    }
    return 0;
  },
  // マウントされたスコープ（v2）: 作者のハンドラが受ける添字は自スコープの
  // ループ分だけ（§4-4 / P2-9）。翻訳で増えたワイルドカード数を落とす。
  // 翻訳された for の台帳に無いループ文脈は外側スコープのもの（境界ホップで
  // 借りた行）なので、作者から見える添字は 0 本。
  // 記録の解決はノードから（findMountRecordForNode）— Shadow 形は rootNode
  // （shadowRoot）で直に引け、Light DOM 形はスコープ根がコンポーネント要素
  // 自身なので祖先走査が要る（rootNode だけ見ると Light DOM で外側の添字が漏れる）
  handlerScope(stateElement, node, rootNode, loopContext, wildcardCount) {
    if (stateElement.hasMounts !== true) {
      return wildcardCount;
    }
    const mountRecord = findMountRecordForNode(node, rootNode);
    if (mountRecord === null) {
      return wildcardCount;
    }
    const shift = mountRecord.indexShiftByLoopElementPath.get(loopContext.pathInfo.path);
    return typeof shift !== "undefined" ? wildcardCount - shift : 0;
  },
  // ボリュームの相対 $updatedCallback（volume.ts）: 自分の接頭辞配下の更新だけを相対パスで受ける。
  // 呼び出し順はルート自身の $updatedCallback の**後**（$watch の order 規約と同じ
  // 「ルート宣言が先」の向き）。ルートのコールバックが async でも待たない（順序の契約は呼び出し順のみ）
  updated(stateElement, refs, receiver) {
    const volumeCallbacks = getVolumeUpdatedCallbacks(stateElement);
    for (const volume of volumeCallbacks) {
      const relativePaths: Set<string> = new Set();
      const relativeIndexes: Record<string, Array<number[]>> = {};
      for (const ref of refs) {
        if (ref.absolutePathInfo.stateElement !== stateElement) {
          continue;
        }
        const path = ref.absolutePathInfo.pathInfo.path;
        // マーカーパス（マウント私有キー）はボリューム相対配送にも漏らさない（D20/D21）
        if (path.indexOf("#") !== -1) {
          continue;
        }
        // 自分の接頭辞の配下と、注入したパス（内側の名前で — 3.x 計画 D33）
        const relative = relativeVolumePath(volume.mountPath, volume.injections, path);
        if (relative === null || relative === "") {
          continue; // 関係ないパスと、マウントポイント自身（接ぎ木そのもの）は相対で表せない
        }
        relativePaths.add(relative);
        const wildcardCount = ref.absolutePathInfo.pathInfo.wildcardCount;
        if (wildcardCount > 0 && ref.listIndex !== null) {
          const indexes = getScopedIndexes(ref.listIndex, wildcardCount);
          (relativeIndexes[relative] ??= []).push(indexes);
        }
      }
      if (relativePaths.size > 0) {
        try {
          volume.callback.call(createVolumeChroot(volume.mountPath, receiver, volume.injections), Array.from(relativePaths), relativeIndexes);
        } catch (error) {
          console.error(`[@wcstack/state] volume "${volume.mountPath}" $updatedCallback threw.`, error);
        }
      }
    }
  },
  // 予約済みのボリュームスロット配下はロード完了まで undefined が正（D22）。切断中の要素には
  // rootNode が無い（State の getter は投げる）ので予約を引かない — 切断中の再セットも経路情報を
  // 作り直してここへ来る（#267）
  suppressPathDiagnostic(stateElement, path) {
    const rootNode = stateElement.isConnected === false
      ? null
      : (stateElement as { rootNode?: Node }).rootNode ?? null;
    return isPathUnderReservedVolume(rootNode, path);
  },
  // その場で使い回した行は DOM から外れない ＝ 付け替えを知らせる connectedCallback が来ないので、
  // 行の中のマウントスコープを新しい行の listIndex へ張り直す（#4。マウントの無い state は中で抜ける）
  rowReused(stateElement, content) {
    remountScopesUnderContent(content, stateElement);
  },
};

let installed = false;
/** 冪等。full エントリでは State（markHasMounts / markHasVolume）と volume.ts の installVolumeGraft が呼ぶ */
export function installScopeHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("scopes", scopeAddressHooks);
}
