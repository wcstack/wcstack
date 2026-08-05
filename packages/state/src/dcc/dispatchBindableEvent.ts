import { IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";

/**
 * DCC の `$bindables` メンバの変更イベントを host に dispatch する。
 *
 * 対応するのは 3 通り。
 *
 *   1. **完全一致** — `count = 1` が `count` メンバを撃つ。`detail` は書き込んだ値。
 *   2. **サブパス** — `user.name = "x"` や `items.0.done = true` が `user` / `items` メンバを撃つ。
 *      `$bindables` のエントリは常にフラットなトップレベル名（dotted 名は
 *      processDccDeclarations の存在検査で落ちる）なので、先頭セグメントを見れば足りる。
 *      この場合 `detail` は付かない — メンバ全体ではない値を載せると誤解を招くため。
 *   3. **`$postUpdate`** — in-place 変異を通知する正規の idiom。書き込んだ値が無いので `detail` は付かない。
 *
 * `detail` に頼らないのが正しい読み方で、`createWcBindable` は各 property に
 * `getter: (event) => event.target[name]` を宣言している。observer はイベントを
 * 「変わった」という通知として受け取り、値は要素から読む。
 *
 * 従来は完全一致しか見ておらず、`$bindables: ["user"]` で `user.name` を書いても
 * 発火しなかった。wc-bindable の `properties[].event` は「変更で発火する」契約なので乖離していた
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1）。
 *
 * 配列の in-place 変異（`items.push(...)`）は set トラップを通らないため、ここでも捕まらない。
 * これはリアクティブコア全体の規範（in-place 変異は `$postUpdate` で通知する）と同じで、
 * 正しい idiom を踏めば 3 で発火する。
 *
 * `$listKeys` を宣言したリストは、配列代入がキー突合後に per-path 書き込みへ分解されるため
 * （docs/state-list-key-design.md §2）、1 回の代入で `1 + 変化行数` 回発火する。値は要素から
 * 読む契約なので結果は変わらない。詳細は上記 §2.1 の「`$listKeys` との相互作用」。
 */
export function dispatchBindableEvent(
  stateElement: IStateElement,
  pathInfo: IPathInfo,
  detail?: { readonly value: unknown },
): void {
  const map = stateElement.bindableEventMap;
  const exactEventName = map[pathInfo.path];
  const isExact = typeof exactEventName === "string";
  const eventName = isExact
    ? exactEventName
    : (pathInfo.segments.length > 1 ? map[pathInfo.segments[0]] : undefined);
  if (typeof eventName !== "string") {
    return;
  }
  const rootNode = stateElement.rootNode;
  if (!(rootNode instanceof ShadowRoot)) {
    return;
  }
  rootNode.host.dispatchEvent(new CustomEvent(eventName, {
    // 完全一致のときだけ、書き込んだ値をそのまま載せる（従来互換）。
    detail: isExact && typeof detail !== "undefined" ? detail.value : undefined,
    bubbles: true,
  }));
}
