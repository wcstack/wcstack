/**
 * indexPathAccessor.ts — マークアップに書いた数値添字のパス（`items.0.v`）の暗黙の getter（#332）。
 *
 * 意味は state のコードの `this["items.0.v"]` と同じ「いま 0 番目にある行の `v`」。proxy の読み書きは
 * 数値の区切りを解決済みのワイルドカードとして扱い、`items.*.v` ＋ 行 0 のアドレスへ向ける
 * （ResolvedAddress.ts）。一方、束縛のパスは `getPathInfo` が `*` だけをワイルドカードとして扱うので、
 * `items.0.v` は行を持たない素のパスとして台帳に載る。2 つのアドレスは一致しないので、添字のパスへの
 * 書き込み・要素の差し替え・行 getter の依存先の変化が束縛へ届かなかった（一覧の丸ごと置換だけが、
 * 素のパスの親として届いた）。行 getter（`get "items.*.double"()`）は素のパスでは読めず空だった。
 *
 * そこで束縛のパスを、作者の getter と同じ仕組みに載せる: state に同名のアクセサを生やし
 * （getterPaths に載る）、読みは proxy 越しに解決済みのアドレスで行う。依存は getter と同じ
 * 動的な辺（checkDependency）で張られるので、書き込み・要素の差し替え・並べ替え・丸ごと置換・
 * 行 getter の依存先の変化が、既存の依存ウォークで届く。getter と同じく、辺はパスの単位なので
 * どの行への書き込みでも評価し直される。数値添字の束縛が無いページには何も生えない（束縛の確立時に
 * パスごと 1 回判定するだけで、読み書きの経路には何も足さない）。要素の書き込みの経路は変えない
 * （`for` の無いリストを swap 経路に載せない — 同じ要素が 2 か所に並ぶと入れ替えが完了せず、後の
 * 位置の書き込みが別の位置に着地する）。
 *
 * 接頭辞（`items` → `items.0` → `items.0.v`）を 1 段ずつ proxy 越しに読むのは、どの段への書き込みにも
 * 辺を張るため。最後の段だけを読むと、行の値がキャッシュに当たったときに親を辿らないので、要素の
 * 差し替え（`items.*` への書き込み）への辺が張られないことがある。
 *
 * 数値の区切りの親が配列でない・その位置に要素が無いときは、これまでどおり素のキーとして辿る —
 * 空のリストの `items.0.v` は undefined（投げない）、数値のキーを持つオブジェクト（`sales.2024.total`）は
 * そのキーの値。素のパスで渡された書き込み（`$resolve` / `$setAll` / 双方向の束縛）も同じ判定で、
 * 行なら `this["items.0.v"] = …` と同じ位置へ、行でなければ親へ素のキーとして書く。
 */
import type { IStateElement } from "../components/types";
import { getPathInfo } from "./PathInfo";
import { getResolvedAddress } from "./ResolvedAddress";

/**
 * 束縛のパスに暗黙の getter を生やすか。生やすなら、存在の診断もそのパスを行のパスとして検査する
 * （diagnostics/pathChecks.ts — 判定はここの 1 か所で、State.setPathInfo が両方へ渡す）。
 *
 * 対象は数値の区切りがちょうど 1 つで `*` を持たないパス（`items.0.v`・`users.1.name`・`items.0`）。
 * 先頭が数値（`2024.total`）はルートのキーで行ではなく、マウントのマーカー（`#`）を含むパスは
 * オーバーレイが答える（webComponent/overlay.ts）。数値の区切りが 2 つ以上のパス（`groups.0.items.1.v`）は
 * 修正前と同じ素のパスのまま — 数値のパスの `for`（`for: groups.0.items`）が作る行は 1 段で、2 段の
 * ワイルドカードパスの解決と食い違う（`wcs/wildcard-rank`）。作者が同名のキーを持つならそちらが正本。
 * state がまだ無ければ、セット時の経路情報の作り直しが戻ってくる。拡張できない state（freeze / seal /
 * preventExtensions）には生やせないので、修正前と同じ素のパスとして読む。
 */
export function isIndexPath(state: object | undefined, path: string): boolean {
  const resolved = getResolvedAddress(path);
  return resolved.wildcardType === "all" && resolved.wildcardIndexes.length === 1 && isNaN(+resolved.segments[0]) &&
    !path.includes("#") && Object.isExtensible(state) && !(path in state!);
}

export function defineIndexPathAccessor(stateElement: IStateElement, path: string): void {
  const { segments, cumulativePaths } = getPathInfo(path);
  const last = segments.length - 1;
  // 読み（getter）と書き込み（setter）で辿りを共有する。書き込みは最後の段で止まる
  const access = (self: any, write?: boolean, value?: unknown): any => {
    let current: any;
    let raw = false;
    for (let i = 0; i <= last; i++) {
      const segment = segments[i];
      // 行ではない（親が配列でない・その位置に要素が無い）: 残りを素のキーとして辿る（修正前の束縛の読みと同じ）
      raw ||= !isNaN(+segment) && !(Array.isArray(current) && +segment in current);
      if (write && i === last) {
        // 行でなければ親へ素のキーとして書く。素のパスへの通知は _setByAddress の finally が出す
        return raw ? (current[segment] = value) : (self[path] = value);
      }
      current = raw ? current?.[segment] : self[cumulativePaths[i]];
    }
    return current;
  };
  stateElement.defineTreeAccessor(path, {
    get(this: any) {
      return access(this);
    },
    set(this: any, value: unknown) {
      access(this, true, value);
    },
    configurable: true,
  });
}
