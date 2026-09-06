/**
 * errorGuidance.ts — エラーメッセージへの self-fix 誘導（GTM 2-5 /
 * docs/static-wiring-dx-design.md §3）。
 *
 * コンソールは「書き手（人間・AI とも）が誤った瞬間に必ず読む面」なので、
 * (a) did-you-mean 候補 (b) lint への誘導 をエラーメッセージ自体に埋め込む。
 * ここの関数は全て**エラーパスでのみ**呼ばれる — 正常系のコストはゼロ。
 * auto.min.js に同梱されるため文字列は最小限に保つ（エラーパス専用モジュールの
 * 遅延 import は `src/auto.ts` の SRI 自己完結制約で不可）。
 *
 * 診断 code の語彙はコンソール → lint → IDE の三面で共有する:
 * メッセージ先頭の `[wcs/...]` は wcstack-intellisense / @wcstack/lint の
 * 安定診断 code（packages/vscode-wcs/src/core/diagnostics.ts）と同一。
 */

/** 挿入・削除・置換の編集距離。長さ差が max を超えたら早期に max+1 を返す。 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

/**
 * 候補集合から編集距離 2 以内の最近傍を探し、` Did you mean "<best>"?` を返す。
 * 該当なしは空文字。規準（距離 2・同距離は先勝ち・大小文字は畳んで比較）は
 * lint の did-you-mean（ioNodeValidator の suggestion）と同じ — 三面で提案が
 * 割れないように揃えている。動的キー等で候補が列挙できないサイトでは呼ばない
 * = 誘導文のみに縮退（設計 §3 の縮退）。
 */
export function didYouMean(input: string, candidates: Iterable<string>): string {
  // 空入力（`a|` の末尾パイプ等）に短い候補を提案しても無意味なので出さない。
  if (input.length === 0) {
    return "";
  }
  const folded = input.toLowerCase();
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(folded, candidate.toLowerCase(), 2);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null ? ` Did you mean "${best}"?` : "";
}

/**
 * lint への誘導（誘導付きメッセージ共通の一文）。
 * **lint が実際にそのケースを検出するサイトにだけ付ける** — 検出しないケースに
 * 付けると「エラー → lint 実行 → clean」の空振りで検証ループの信頼を毀損する。
 * 現在 lint 未検出のため付けないもの: DCC 宣言・watch の空キー / Object.prototype
 * 継承名 / ワイルドカード深度超過。
 * なお hint 付きサイト内でも被覆は部分的でありうる（例: `$watch: ident` の実体が
 * 非オブジェクトだった場合、ランタイムは評価後の値で raise するが lint は宣言 shape
 * から断定できず沈黙する）。サイト粒度の hint ではこの残余は構造的に避けられない。
 */
export const LINT_HINT = " Validate statically: npx @wcstack/lint <file>.";
