import { describe, it, expect } from 'vitest';
import { validateWatchDeclarations } from '../src/service/watchDeclarationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

function makeHtml(script: string): string {
  return `<wcs-state><script type="module">
export default {
${script}
};
  </script></wcs-state>`;
}

const codes = (html: string): string[] => validateWatchDeclarations(html).map(d => d.code);

describe('validateWatchDeclarations', () => {
  describe('存在しないパス（warning）', () => {
    // $watch の失敗モードは一貫して「黙って発火しない」。バインディング側と違い
    // 画面にも出ないので、ここで拾えないと気づく手段が無い。
    it('トップレベルのタイプミスを検出する', () => {
      const html = makeHtml(`
  isLoading: false,
  $watch: {
    isLoadng(cur, prev) { void cur; void prev; },
  }`);
      const diags = validateWatchDeclarations(html);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe(WcsDiagnosticCode.WatchPathMissing);
      expect(diags[0].severity).toBe('warning');
      expect(diags[0].message).toContain('isLoadng');
      expect(html.slice(diags[0].start, diags[0].end)).toBe('isLoadng');
    });

    it('引用符付きのワイルドカードパスのタイプミスを検出する', () => {
      // この形（引用符付きメソッド短縮記法）が README の idiom。
      const html = makeHtml(`
  items: [{ price: 1 }],
  $watch: {
    "items.*.prce"(cur, prev, index) { void cur; void prev; void index; },
  }`);
      const diags = validateWatchDeclarations(html);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe(WcsDiagnosticCode.WatchPathMissing);
      // レンジは引用符の内側だけを指す
      expect(html.slice(diags[0].start, diags[0].end)).toBe('items.*.prce');
    });

    it('正しいパスは無診断（スカラ・行フィールド・getter）', () => {
      const html = makeHtml(`
  isLoading: false,
  items: [{ price: 1 }],
  get total() { return 0; },
  $watch: {
    isLoading(cur, prev) { void cur; void prev; },
    "items.*.price"(cur, prev, index) { void cur; void prev; void index; },
    total(cur, prev) { void cur; void prev; },
  }`);
      expect(validateWatchDeclarations(html)).toEqual([]);
    });

    it('$listKeys が実体化したパスも既知として扱う', () => {
      // items が空配列でも $listKeys の宣言から行のキーフィールドが確定する
      const html = makeHtml(`
  items: [],
  $listKeys: { items: "id" },
  $watch: {
    "items.*.id"(cur, prev, index) { void cur; void prev; void index; },
  }`);
      expect(validateWatchDeclarations(html)).toEqual([]);
    });

    it('パス候補が 1 つも取れないスクリプトでは存在検証をしない（誤警告回避）', () => {
      const html = `<wcs-state><script type="module">
const state = { $watch: { anything(cur) { void cur; } } };
</script></wcs-state>`;
      expect(validateWatchDeclarations(html)).toEqual([]);
    });
  });

  describe('宣言そのものが不正（error）', () => {
    // ランタイム（processWatchDeclaration）が raiseError で落とす形。静的に確実。
    it('@ 付きの越境 watch を検出する', () => {
      const html = makeHtml(`
  count: 0,
  $watch: {
    "count@other"(cur, prev) { void cur; void prev; },
  }`);
      const diags = validateWatchDeclarations(html);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe(WcsDiagnosticCode.WatchDeclarationInvalid);
      expect(diags[0].severity).toBe('error');
      expect(diags[0].message).toContain('越境');
    });

    it('$ 始まりのキーを検出する', () => {
      const html = makeHtml(`
  count: 0,
  $watch: {
    "$streamStatus.x"(cur, prev) { void cur; void prev; },
  }`);
      expect(codes(html)).toEqual([WcsDiagnosticCode.WatchDeclarationInvalid]);
    });

    it('空のパスセグメントを検出する', () => {
      const html = makeHtml(`
  count: 0,
  $watch: {
    "a..b"(cur, prev) { void cur; void prev; },
    "trailing."(cur, prev) { void cur; void prev; },
  }`);
      expect(codes(html)).toEqual([
        WcsDiagnosticCode.WatchDeclarationInvalid,
        WcsDiagnosticCode.WatchDeclarationInvalid,
      ]);
    });

    it('明らかな非関数リテラルのハンドラを検出する', () => {
      const html = makeHtml(`
  count: 0,
  $watch: {
    count: 1,
  }`);
      const diags = validateWatchDeclarations(html);
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('関数');
    });

    it('識別子参照のハンドラは疑わない（静的に解決できないため）', () => {
      const html = makeHtml(`
  count: 0,
  onCountChange(cur, prev) { void cur; void prev; },
  $watch: {
    count: this.onCountChange,
  }`);
      expect(validateWatchDeclarations(html)).toEqual([]);
    });

    it('関数式・アロー関数のハンドラは疑わない', () => {
      const html = makeHtml(`
  a: 0,
  b: 0,
  $watch: {
    a: (cur, prev) => { void cur; void prev; },
    b: function (cur, prev) { void cur; void prev; },
  }`);
      expect(validateWatchDeclarations(html)).toEqual([]);
    });

    it('キー 1 つにつき報告は 1 件だけ（直す順番を増やさない）', () => {
      // 越境かつ存在しないパス
      const html = makeHtml(`
  count: 0,
  $watch: {
    "nope@other"(cur, prev) { void cur; void prev; },
  }`);
      expect(codes(html)).toEqual([WcsDiagnosticCode.WatchDeclarationInvalid]);
    });
  });

  describe('宣言が無い / 形が違う場合', () => {
    it('$watch が無ければ何も出さない', () => {
      expect(validateWatchDeclarations(makeHtml(`  count: 0`))).toEqual([]);
    });

    it('$watch がオブジェクトリテラルでなければ何も出さない', () => {
      expect(validateWatchDeclarations(makeHtml(`
  count: 0,
  $watch: buildWatch()`))).toEqual([]);
    });

    it('<wcs-state> が無ければ何も出さない', () => {
      expect(validateWatchDeclarations('<div>plain html</div>')).toEqual([]);
    });
  });

  it('複数の <wcs-state> をそれぞれの state 名で検証する', () => {
    const html = `
<wcs-state name="a"><script type="module">
export default { alpha: 1, $watch: { alpha(cur) { void cur; } } };
</script></wcs-state>
<wcs-state name="b"><script type="module">
export default { beta: 1, $watch: { alpha(cur) { void cur; } } };
</script></wcs-state>`;
    const diags = validateWatchDeclarations(html);
    // b 側の alpha は b の状態定義に無い
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.WatchPathMissing);
    expect(diags[0].start).toBeGreaterThan(html.indexOf('name="b"'));
  });

  it('validateDocument から同じ診断が出る（IDE / CI 同一経路）', () => {
    const html = makeHtml(`
  isLoading: false,
  $watch: {
    isLoadng(cur, prev) { void cur; void prev; },
  }`);
    const fromDocument = validateDocument(html).filter(d => d.code.startsWith('wcs/watch-'));
    expect(fromDocument).toEqual(validateWatchDeclarations(html));
  });

  it('locale=en で英語メッセージになる', () => {
    const html = makeHtml(`
  count: 0,
  $watch: {
    "count@other"(cur, prev) { void cur; void prev; },
  }`);
    const diags = validateWatchDeclarations(html, 'wcs-state', 'en');
    expect(diags[0].message).toContain('Cross-state watching');
  });
});

describe('非オブジェクト $watch（error・ランタイムは読み込み時に throw する形）', () => {
  const errorsOf = (html: string) =>
    validateWatchDeclarations(html).filter(d => d.code === WcsDiagnosticCode.WatchDeclarationInvalid);

  it('文字列・数値・真偽値・null リテラルを検出する', () => {
    for (const value of ['"x"', '42', 'true', 'null']) {
      const diags = errorsOf(makeHtml(`count: 0,\n  $watch: ${value},`));
      expect(diags, `$watch: ${value}`).toHaveLength(1);
      expect(diags[0].severity).toBe('error');
      expect(diags[0].message).toContain('$watch');
    }
  });

  it('メソッド短縮記法とアロー関数を検出する（値が関数 = typeof 非 object）', () => {
    expect(errorsOf(makeHtml(`count: 0,\n  $watch(cur, prev) { console.log(cur); },`))).toHaveLength(1);
    expect(errorsOf(makeHtml(`count: 0,\n  $watch: (cur, prev) => console.log(cur),`))).toHaveLength(1);
    expect(errorsOf(makeHtml(`count: 0,\n  $watch: cur => cur,`))).toHaveLength(1);
  });

  it('断定できない形は検出しない（識別子参照・呼び出し・IIFE・配列・undefined・getter）', () => {
    // 識別子・呼び出し・IIFE は実行時までオブジェクトか不明。配列は typeof "object" で
    // ランタイムを通過する。undefined はランタイムが宣言なし扱い。getter は評価結果不明。
    for (const value of ['watchMap', 'makeWatch()', '(() => ({}))()', '[]', 'undefined']) {
      expect(errorsOf(makeHtml(`count: 0,\n  $watch: ${value},`)), `$watch: ${value}`).toHaveLength(0);
    }
    expect(errorsOf(makeHtml(`count: 0,\n  get $watch() { return {}; },`))).toHaveLength(0);
  });

  it('リテラルが値全体でない式は検出しない（`true && {…}` 等は実行時にオブジェクトになりうる）', () => {
    const objectish = [
      'true && { count(cur) { console.log(cur); } }',
      'null ?? { count(cur) { console.log(cur); } }',
      '"x" ? watchMap : otherMap',
      '1 + makeCount()',
    ];
    for (const value of objectish) {
      expect(errorsOf(makeHtml(`count: 0,\n  $watch: ${value},`)), `$watch: ${value}`).toHaveLength(0);
    }
    // 関数式に後続の呼び出しが付く形（結果は不明）も断定しない
    expect(errorsOf(makeHtml(`count: 0,\n  $watch: function() { return {}; }(),`))).toHaveLength(0);
  });

  it('正常なオブジェクト宣言は検出しない', () => {
    expect(errorsOf(makeHtml(`count: 0,\n  $watch: { count(cur, prev) {} },`))).toHaveLength(0);
  });

  it('validateDocument 経由でも同じ診断が出る（IDE/CLI パリティ）', () => {
    const html = makeHtml(`count: 0,\n  $watch: "typo",`);
    const viaDocument = validateDocument(html)
      .filter(d => d.code === WcsDiagnosticCode.WatchDeclarationInvalid);
    expect(viaDocument).toHaveLength(1);
  });
});
