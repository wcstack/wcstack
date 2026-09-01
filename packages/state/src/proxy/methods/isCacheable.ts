import { IStateAddress } from "../../address/types";
import { IStateElement } from "../../components/types";

/**
 * このアドレスの値をキャッシュしてよいか（getByAddress / setByAddress 共通の判定）。
 *
 * ワイルドカードを含むパス（リスト行）と宣言済み getter は再評価が高くつくため
 * キャッシュする。ただし mapped な `bind-component` の state は例外で、丸ごと外す。
 *
 * mapped な state は値を持たず、読みも書きも親スコープの state へ解決される
 * （innerState proxy）。同じ値は親側のキャッシュにも載り、その無効化は親の依存 walk が
 * 担う。子側にもう一段キャッシュを置くと、正本でない複製を親の無効化が届かない場所に
 * 作ることになり、親起点の書き込みのあと子だけが旧値を読み続ける。二重に持たないのが
 * 唯一の整合手段なので、mapped な state 要素ではキャッシュ層を持たない — 親の
 * キャッシュがそのまま効くので、失うのは重複していた一段だけ
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.8）。
 */
export function isCacheable(stateElement: IStateElement, address: IStateAddress): boolean {
  if (stateElement.hasMappedComponentState === true) {
    return false;
  }
  // マーカーで終わるパス（`users.*.#m1` — オーバーレイ値）はキャッシュしない。
  // オーバーレイ値 proxy は評価中の receiver / handler を閉じ込めるため、drain を
  // 跨いで使い回せない（webComponent/overlay.ts）。マーカーの**下**のパス
  // （私有キー・getter の値）は通常どおりキャッシュされ、依存 walk が無効化する。
  if (stateElement.hasMounts === true && address.pathInfo.lastSegment.charCodeAt(0) === 35 /* '#' */) {
    return false;
  }
  return address.pathInfo.wildcardCount > 0 ||
         stateElement.getterPaths.has(address.pathInfo.path);
}
