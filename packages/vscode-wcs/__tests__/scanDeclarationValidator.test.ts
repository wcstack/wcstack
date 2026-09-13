import { describe, it, expect } from 'vitest';
import { validateScanDeclarations } from '../src/service/scanDeclarationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';
import { analyzeScanEntries, analyzeStatePaths, readEventTokenNames } from '../src/service/stateAnalyzer';

function makeHtml(script: string): string {
  return `<wcs-state><script type="module">
export default {
${script}
};
  </script></wcs-state>`;
}

const diagnose = (script: string) => {
  const html = makeHtml(script);
  return validateScanDeclarations(html).map(d => ({
    code: d.code,
    severity: d.severity,
    text: html.slice(d.start, d.end),
    message: d.message,
  }));
};

describe('validateScanDeclarations', () => {
  describe('正しい宣言は無診断', () => {
    it('from / on / resetOn・連鎖・wildcard の from が全部通る', () => {
      expect(diagnose(`
  page: 1,
  items: [{ qty: 1 }],
  $eventTokens: ["pageArrived"],
  $streams: { pageResult: { source(args, signal) { return make(); } } },
  $scan: {
    feed: { from: "pageResult", initial: { items: [], pages: [] }, fold: (acc, chunk) => acc },
    total: { from: "feed.items", initial: 0, fold(acc, cur) { return acc; } },
    log: { on: "pageArrived", initial: [], fold: appendEvent, resetOn: ["page"] },
    qtyLog: { from: "items.*.qty", initial: [], fold: (acc, cur, prev, i) => acc },
  }`)).toEqual([]);
    });

    it('中身が静的に読めないエントリ・$eventTokens が識別子参照のときは断定しない', () => {
      expect(diagnose(`
  n: 0,
  $eventTokens: TOKENS,
  $scan: {
    a: DEFINITION,
    b: { ...BASE, from: "n" },
    c: { on: "whatever", initial: 0, fold: f },
  }`)).toEqual([]);
    });
  });

  describe('宣言の形（error・wcs/scan-declaration-invalid）', () => {
    it('$scan の値がオブジェクトでないと断定できる', () => {
      const diags = diagnose(`  $scan: "feed"`);
      expect(diags).toEqual([expect.objectContaining({ code: WcsDiagnosticCode.ScanDeclarationInvalid, severity: 'error', text: '$scan' })]);
    });

    it('出力名が平坦でない・$ 始まり', () => {
      const diags = diagnose(`
  n: 0,
  $scan: {
    "a.b": { from: "n", initial: 0, fold: f },
    $x: { from: "n", initial: 0, fold: f },
  }`);
      expect(diags.map(d => [d.code, d.text])).toEqual([
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'a.b'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, '$x'],
      ]);
    });

    it('出力名が getter / setter / $streams 名と衝突する', () => {
      const diags = diagnose(`
  get total() { return 1; },
  set sink(v) { },
  $streams: { feed: { source(a, s) { return x; } } },
  $scan: {
    total: { from: "n", initial: 0, fold: f },
    feed: { from: "n", initial: 0, fold: f },
    sink: { from: "n", initial: 0, fold: f },
  }`);
      expect(diags.map(d => d.text)).toEqual(['total', 'feed', 'sink']);
      expect(diags[0].message).toContain('getter');
      expect(diags[1].message).toContain('$streams');
      expect(diags[2].message).toContain('setter');
    });

    it('出力名・from・resetOn が Object.prototype の継承名', () => {
      const diags = diagnose(`
  n: 0,
  $scan: {
    constructor: { from: "n", initial: 0, fold: f },
    a: { from: "toString", initial: 0, fold: f },
    b: { from: "n", initial: 0, fold: f, resetOn: ["valueOf"] },
  }`);
      expect(diags.map(d => [d.code, d.text])).toEqual([
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'constructor'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'toString'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'valueOf'],
      ]);
      expect(diags.every(d => d.message.includes('Object.prototype'))).toBe(true);
    });

    it('エントリがメソッド・非オブジェクトリテラル', () => {
      const diags = diagnose(`
  n: 0,
  $scan: {
    a() { return 1; },
    b: 1,
  }`);
      expect(diags.map(d => d.text)).toEqual(['a', 'b']);
      expect(diags.every(d => d.code === WcsDiagnosticCode.ScanDeclarationInvalid)).toBe(true);
    });

    it('from と on のどちらも無い・両方ある、initial / fold の欠落や非関数', () => {
      const diags = diagnose(`
  n: 0,
  $eventTokens: ["tick"],
  $scan: {
    none: { initial: 0, fold: f },
    both: { from: "n", on: "tick", initial: 0, fold: f },
    noInitial: { from: "n", fold: f },
    noFold: { from: "n", initial: 0 },
    badFold: { from: "n", initial: 0, fold: 1 },
    undefinedFrom: { from: undefined, on: "tick", initial: 0, fold: f },
  }`);
      expect(diags.map(d => d.text)).toEqual(['none', 'both', 'noInitial', 'noFold', 'badFold']);
    });

    it('on が $eventTokens に無い（宣言が無い場合も含む）', () => {
      expect(diagnose(`
  $eventTokens: ["tick"],
  $scan: { c: { on: "tikc", initial: 0, fold: f } }`).map(d => d.text)).toEqual(['tikc']);
      expect(diagnose(`
  $scan: { c: { on: "tick", initial: 0, fold: f } }`).map(d => d.text)).toEqual(['tick']);
    });

    it('from / resetOn のパスの形が壊れている', () => {
      const diags = diagnose(`
  n: 0,
  $scan: {
    a: { from: "$streamStatus.feed", initial: 0, fold: f },
    b: { from: "a..b", initial: 0, fold: f },
    c: { from: "nodes.**.value", initial: 0, fold: f },
    d: { from: "n", initial: 0, fold: f, resetOn: ["user@other"] },
  }`);
      expect(diags.map(d => [d.code, d.text])).toEqual([
        [WcsDiagnosticCode.ScanDeclarationInvalid, '$streamStatus.feed'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'a..b'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'nodes.**.value'],
        [WcsDiagnosticCode.ScanDeclarationInvalid, 'user@other'],
      ]);
    });

    it('from が自分の出力（の子孫）を読む', () => {
      const diags = diagnose(`
  $scan: {
    feed: { from: "feed.items", initial: { items: [] }, fold: f },
  }`);
      expect(diags).toEqual([expect.objectContaining({ code: WcsDiagnosticCode.ScanDeclarationInvalid, text: 'feed.items' })]);
    });

    it('resetOn の形: 配列でない・wildcard・自分の from・scan 出力を読む', () => {
      const diags = diagnose(`
  n: 0,
  host: "a",
  items: [{ qty: 1 }],
  $scan: {
    a: { from: "n", initial: 0, fold: f, resetOn: "host" },
    b: { from: "n", initial: 0, fold: f, resetOn: ["items.*"] },
    c: { from: "n", initial: 0, fold: f, resetOn: ["n"] },
    d: { from: "n", initial: 0, fold: f, resetOn: ["a"] },
  }`);
      expect(diags.map(d => d.text)).toEqual(['a', 'items.*', 'n', 'a']);
      expect(diags.every(d => d.code === WcsDiagnosticCode.ScanDeclarationInvalid)).toBe(true);
    });

    it('resetOn が自分の from の配下なら error、祖先なら通す', () => {
      const diags = diagnose(`
  user: { id: 1, name: "a" },
  items: [{ qty: 1 }],
  $scan: {
    a: { from: "user", initial: 0, fold: f, resetOn: ["user.id"] },
    b: { from: "items.*.qty", initial: [], fold: f, resetOn: ["items"] },
  }`);
      expect(diags).toEqual([expect.objectContaining({ code: WcsDiagnosticCode.ScanDeclarationInvalid, text: 'user.id' })]);
      expect(diags[0].message).toContain('"user"');
    });
  });

  describe('getter を source にしない（error・wcs/scan-source-computed）', () => {
    it('from / resetOn が getter・getter の配下', () => {
      const diags = diagnose(`
  get src() { return 1; },
  get row() { return { x: 1 }; },
  n: 0,
  $scan: {
    a: { from: "src", initial: 0, fold: f },
    b: { from: "row.x", initial: 0, fold: f },
    c: { from: "n", initial: 0, fold: f, resetOn: ["src"] },
  }`);
      expect(diags.map(d => [d.code, d.text])).toEqual([
        [WcsDiagnosticCode.ScanSourceComputed, 'src'],
        [WcsDiagnosticCode.ScanSourceComputed, 'row.x'],
        [WcsDiagnosticCode.ScanSourceComputed, 'src'],
      ]);
      expect(diags[1].message).toContain('"row"');
    });
  });

  describe('存在しないパス（warning・wcs/scan-path-missing）', () => {
    it('from / resetOn のタイプミス', () => {
      const diags = diagnose(`
  pageResult: null,
  host: "a",
  $scan: {
    feed: { from: "pageResutl", initial: [], fold: f, resetOn: ["hots"] },
  }`);
      expect(diags).toEqual([
        expect.objectContaining({ code: WcsDiagnosticCode.ScanPathMissing, severity: 'warning', text: 'pageResutl' }),
        expect.objectContaining({ code: WcsDiagnosticCode.ScanPathMissing, severity: 'warning', text: 'hots' }),
      ]);
    });
  });

  it('validateDocument に配線されている', () => {
    const html = makeHtml(`
  n: 0,
  $scan: { total: { from: "nn", initial: 0, fold: f } }`);
    expect(validateDocument(html).map(d => d.code)).toContain(WcsDiagnosticCode.ScanPathMissing);
  });
});

describe('stateAnalyzer — $scan', () => {
  it('出力名を initial から値プロパティとして実体化し、明示宣言が優先する', () => {
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

  it('エントリの素性を位置付きで取り出す', () => {
    const script = `export default {
  $scan: {
    feed: { from: "pageResult", initial: [], fold(acc) { return acc; }, resetOn: ["host", 'user.id'] },
    log: { on: "tick", initial: [], fold: 1 },
    opaque: DEF,
  },
};`;
    const [feed, log, opaque] = analyzeScanEntries(script);
    expect(feed).toMatchObject({ name: 'feed', readable: true, hasFrom: true, hasOn: false, hasInitial: true, foldMissingOrNotFunction: false });
    expect(script.slice(feed.from!.start, feed.from!.end)).toBe('pageResult');
    expect(feed.resetOn!.map(r => script.slice(r.start, r.end))).toEqual(['host', 'user.id']);
    expect(log).toMatchObject({ hasOn: true, foldMissingOrNotFunction: true });
    expect(script.slice(log.on!.start, log.on!.end)).toBe('tick');
    expect(opaque).toMatchObject({ readable: false, notObject: false });
  });

  it('resetOn に文字列以外が混ざる配列は断定しない', () => {
    const [entry] = analyzeScanEntries(`export default { $scan: { a: { from: "n", initial: 0, fold: f, resetOn: ["host", KEY] } } };`);
    expect(entry.resetOn).toBeNull();
    expect(entry.resetOnNotArray).toBe(false);
  });

  it('readEventTokenNames: 無ければ空、配列リテラルなら名前、読めなければ null', () => {
    expect(readEventTokenNames(`export default { n: 0 };`)).toEqual(new Set());
    expect(readEventTokenNames(`export default { $eventTokens: ["a", 'b'] };`)).toEqual(new Set(['a', 'b']));
    expect(readEventTokenNames(`export default { $eventTokens: TOKENS };`)).toBeNull();
    expect(readEventTokenNames(`export default { ...base, n: 0 };`)).toBeNull();
    expect(readEventTokenNames(`const x = 1;`)).toBeNull();
  });
});
