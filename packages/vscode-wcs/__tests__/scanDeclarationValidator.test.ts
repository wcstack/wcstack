import { describe, it, expect } from 'vitest';
import { validateScanDeclarations } from '../src/service/scanDeclarationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';
import { analyzeStatePaths } from '../src/service/stateAnalyzer';

/**
 * `@wcstack/state` 4.0 は `$scan` を外した（読み込み時に `$scan was removed (use $watch or $on)` で throw）。
 * 拡張は宣言のキーに 1 件だけ `wcs/scan-declaration-invalid` を出す（中身は検査しない）。
 */
const diagnose = (html: string, locale?: string) =>
  validateScanDeclarations(html, 'wcs-state', locale).map(d => ({
    code: d.code,
    severity: d.severity,
    text: html.slice(d.start, d.end),
    message: d.message,
  }));

describe('validateScanDeclarations — 4.0 で外れた $scan', () => {
  it('$scan の宣言はどの形でも error（キーの 1 か所だけ。中身の形・パスは検査しない）', () => {
    const html = `<wcs-state><script type="module">
export default {
  page: 1,
  $scan: {
    total: { from: "nope", initial: 0, fold: (acc, cur) => acc + cur },
    broken: 1,
  },
};
</script></wcs-state>`;
    const found = diagnose(html, 'en');
    expect(found).toEqual([{
      code: WcsDiagnosticCode.ScanDeclarationInvalid,
      severity: 'error',
      text: '$scan',
      message: expect.stringContaining('$scan was removed in 4.0'),
    }]);
    expect(found[0].message).toContain('$watch');
    expect(found[0].message).toContain('$on');
  });

  it('メソッド短縮記法・ボリュームの $scan も同じく error（4.0 はどこでも throw）。bind-component の中のスクリプトは読み込みごと拒まれるので重ねない', () => {
    const html = `<wcs-state><script type="module">
export default { $scan() { return {}; } };
</script></wcs-state>
<wcs-state mount="cart"><script type="module">
export default { $scan: {} };
</script></wcs-state>
<x-card><wcs-state bind-component="card"><script type="module">
export default { $scan: {} };
</script></wcs-state></x-card>`;
    const found = diagnose(html, 'ja');
    expect(found.map(d => [d.text, d.severity])).toEqual([['$scan', 'error'], ['$scan', 'error']]);
    expect(found[0].message).toContain('4.0 で外れました');
  });

  it('宣言が静的に読めない class 構文は鏡像への正規表現で拾い、warning に留める（コメント・文字列の中は拾わない）', () => {
    const html = `<wcs-state mount="cart"><script type="module">
export default class Cart {
  note = "$scan: no";
  // $scan = {}
  $scan = { total: {} };
}
</script></wcs-state>`;
    const found = diagnose(html);
    expect(found.map(d => [d.text, d.severity])).toEqual([['$scan', 'warning']]);
  });

  it('値が undefined のリテラルは宣言なし扱い（ランタイムは $scan !== undefined で判定する）', () => {
    expect(diagnose(`<wcs-state><script type="module">
export default { $scan: undefined /* off */, count: 0 };
</script></wcs-state>`)).toEqual([]);
    expect(diagnose(`<wcs-state mount="cart"><script type="module">
export default class Cart { $scan = undefined; }
</script></wcs-state>`)).toEqual([]);
  });

  it('ボリュームの $scan は「接ぎ木を拒んで console.error」と言う（読み込みは通らない）', () => {
    const found = diagnose(`<wcs-state mount="cart"><script type="module">
export default { $scan: {} };
</script></wcs-state>`, 'en');
    expect(found[0].message).toContain('refuses to graft');
    expect(found[0].message).toContain('console.error');
    expect(found[0].message).not.toContain('throws at load time');
  });

  it('$scan が無ければ何も出さない（文字列の中の "$scan" も宣言ではない）', () => {
    const html = `<wcs-state><script type="module">
export default { msg: "see $scan docs", count: 0 };
</script></wcs-state>`;
    expect(diagnose(html)).toEqual([]);
  });

  it('validateDocument に配線されている', () => {
    const html = `<wcs-state><script type="module">export default { $scan: {} };</script></wcs-state>`;
    expect(validateDocument(html).map(d => d.code)).toContain(WcsDiagnosticCode.ScanDeclarationInvalid);
  });
});

describe('stateAnalyzer — $scan（4.0 は throw するが、出力は 3.x と同じく候補に実体化する）', () => {
  it('出力名を initial から値プロパティとして実体化し、明示宣言が優先する（束縛に binding-path-missing を重ねない）', () => {
    const paths = analyzeStatePaths(`
export default {
  total: "explicit",
  $scan: {
    feed: { from: "x", initial: { items: [], pages: [] }, fold: f },
    total: { from: "x", initial: 0, fold: f },
    "bad.name": { from: "x", initial: [], fold: f },
    bare: { from: "x", initial: 0, fold: f },
  },
};`);
    const names = paths.map(p => p.path);
    expect(names).toEqual(expect.arrayContaining(['feed', 'feed.items', 'feed.items.*', 'feed.pages', 'bare']));
    expect(names).not.toContain('bad.name');
    expect(names).not.toContain('$scan');
    expect(paths.filter(p => p.path === 'total')).toEqual([expect.objectContaining({ typeHint: 'string' })]);
  });
});
