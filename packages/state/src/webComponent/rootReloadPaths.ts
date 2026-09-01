import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";

/**
 * ルート規則（`data-wcs="state: path"` の丸ごとマウント）で、親がマウント先を
 * 丸ごと差し替えた／子が切断 → 再接続した、というときに子へ「読み直せ」と撃つパスの集合。
 *
 * 部分規則ならプライマリの内側パス（`state.items: rows` なら `items`）を撃てば依存 walk が
 * 配下へ展開するが、ルート規則は内側パスが空で `$postUpdate("")` に意味が無い。
 * 代わりに子の登録済みパス（`boundPaths`）の**先頭セグメント**を撃つ — `tags.*.name` は
 * `tags` から静的依存で展開されるので、先頭だけで配下を覆える。
 *
 * `$` 名前空間（`$1` など）は state に実体を持たないので除く。私有キー（R1）への通知は
 * 値が変わっていないので再描画が同値で終わるだけ（無害）。
 */
export function getRootReloadPaths(innerStateElement: IStateElement): string[] {
  const boundPaths = innerStateElement.boundPaths;
  if (typeof boundPaths === 'undefined') {
    return [];
  }
  const roots = new Set<string>();
  for (const path of boundPaths) {
    if (path[0] === '$') {
      continue;
    }
    const dot = path.indexOf(DELIMITER);
    roots.add(dot === -1 ? path : path.slice(0, dot));
  }
  return [...roots];
}
