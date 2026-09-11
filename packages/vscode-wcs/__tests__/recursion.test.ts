import { describe, it, expect } from 'vitest';
import { validateRecursion } from '../src/service/recursionValidator';
import { validateBindings } from '../src/service/bindingValidator';
import { validateTemplateSyntax } from '../src/service/templateSyntaxValidator';
import { validateWatchDeclarations } from '../src/service/watchDeclarationValidator';
import { validateSemantics } from '../src/service/semanticValidator';
import { validateDocument } from '../src/core/validateDocument';
import { analyzeListKeyEntries, analyzeRecursionDeclaration, analyzeStatePaths, hasDefaultExportObject, hasTopLevelSpread } from '../src/service/stateAnalyzer';
import {
  checkNodePath,
  collectRecursionSpecs,
  concreteExpansionSuffix,
  coversSuffix,
  foldRecursion,
  foldSuffixIndexes,
  indexSegmentsToWildcard,
  makeRecursionSpec,
  matchesRecursion,
  owningGetterSuffix,
  splitRecursivePath,
  structuralWriteTarget,
} from '../src/service/recursionPaths';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

/** `<wcs-state>` のインラインスクリプトを 1 本持つ HTML。 */
function makeState(script: string): string {
  return `<wcs-state><script type="module">
export default {
${script}
};
  </script></wcs-state>`;
}

/** 宣言 + 再帰 getter を持つ、README の idiom そのままの state。 */
const TREE_STATE = `
  $recursion: { "nodes.*": "children.*" },
  nodes: [{ value: 1, selected: false, label: "a", children: [] }],
  get "nodes.**.total"() {
    return this["nodes.**.value"] +
      this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
  },
  get treeTotal() {
    return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
  },
  clearSelection() { this.$setAll("nodes.**.selected", [], false); }`;

const codes = (diags: readonly { code: string }[]): string[] => diags.map(d => d.code);

// ============================================================
// recursionPaths（純粋なパス代数）
// ============================================================

describe('recursionPaths', () => {
  const spec = makeRecursionSpec('nodes.*', 'children.*');

  it('spec は アンカー / 反復 の両方をリスト側と要素側に割る', () => {
    expect(spec).toEqual({
      anchor: 'nodes.*',
      repeat: 'children.*',
      recursiveAnchor: 'nodes.**',
      anchorList: 'nodes',
      repeatList: 'children',
    });
  });

  describe('checkNodePath — runtime assertNodePath と同条件・同順', () => {
    it('正しい形は null', () => {
      expect(checkNodePath('nodes.*')).toBeNull();
      expect(checkNodePath('data.tree.nodes.*')).toBeNull();
    });
    it.each([
      ['', 'empty'],
      ['nodes..*', 'emptySegment'],
      ['nodes', 'notElement'],
      ['*', 'notElement'],
      ['nodes.children', 'notElement'],
      ['$streams.*', 'reservedRoot'],
      ['nodes.#m1.*', 'reservedMount'],
      ['nodes.*.children.*', 'midWildcard'],
      ['nodes.**.children.*', 'nestedRecursion'],
    ])('"%s" は %s', (path, problem) => {
      expect(checkNodePath(path)).toBe(problem);
    });
  });

  describe('splitRecursivePath', () => {
    it('アンカー一致なら接尾辞を返す', () => {
      expect(splitRecursivePath(spec, 'nodes.**.total')).toBe('.total');
      expect(splitRecursivePath(spec, 'nodes.**')).toBe('');
      expect(splitRecursivePath(spec, 'nodes.**.children.*.total')).toBe('.children.*.total');
    });
    it('別アンカー / 2 つ目の ** は null', () => {
      expect(splitRecursivePath(spec, 'tree.**.total')).toBeNull();
      expect(splitRecursivePath(spec, 'nodes.**.children.**.total')).toBeNull();
    });
  });

  describe('foldRecursion — 反復語の「出現数」では数えない', () => {
    it('アンカー直後から前方一致で剥がす', () => {
      expect(foldRecursion(spec, 'nodes.*.total')).toEqual({ depth: 0, rest: '.total' });
      expect(foldRecursion(spec, 'nodes.*.children.*.total')).toEqual({ depth: 1, rest: '.total' });
      expect(foldRecursion(spec, 'nodes.*.children.*.children.*.total')).toEqual({ depth: 2, rest: '.total' });
    });

    it('接尾辞に反復語と同じ綴りがあっても取り違えない', () => {
      // `children` が**接尾辞側**に出るケース。出現数で数えると深さ 2 になる
      expect(foldRecursion(spec, 'nodes.*.meta.children.*.x')).toEqual({ depth: 0, rest: '.meta.children.*.x' });
    });

    it('アンカーの直後がパス境界でなければ null', () => {
      expect(foldRecursion(spec, 'nodesX.*.total')).toBeNull();
      expect(foldRecursion(spec, 'nodes.*x')).toBeNull();
      expect(foldRecursion(spec, 'other.*.total')).toBeNull();
    });

    it('子リスト・ノード自身も畳める', () => {
      expect(foldRecursion(spec, 'nodes.*.children')).toEqual({ depth: 0, rest: '.children' });
      expect(foldRecursion(spec, 'nodes.*.children.*')).toEqual({ depth: 1, rest: '' });
      expect(foldRecursion(spec, 'nodes.*.children.*.children')).toEqual({ depth: 1, rest: '.children' });
    });
  });

  describe('matchesRecursion', () => {
    const declared = new Set(['nodes.*', 'nodes.*.value', 'nodes.**.total', 'nodes.*.children']);
    const has = (p: string): boolean => declared.has(p);

    it('深い具体パスを深さ 0 の形へ畳んでから当てる', () => {
      expect(matchesRecursion([spec], 'nodes.*.children.*.value', has)).toBe(true);
      expect(matchesRecursion([spec], 'nodes.*.children.*.children.*.value', has)).toBe(true);
    });
    it('`**` getter の展開形にも当たる（深さ 0 を含む）', () => {
      expect(matchesRecursion([spec], 'nodes.*.total', has)).toBe(true);
      expect(matchesRecursion([spec], 'nodes.*.children.*.total', has)).toBe(true);
    });
    it('宣言に無い葉は当たらない（誤検出を増やさない）', () => {
      expect(matchesRecursion([spec], 'nodes.*.children.*.valu', has)).toBe(false);
      expect(matchesRecursion([spec], 'other.*.value', has)).toBe(false);
    });
    it('spec が無ければ常に false', () => {
      expect(matchesRecursion([], 'nodes.*.children.*.value', has)).toBe(false);
    });
    it('接尾辞に反復語を含む `**` getter の展開形にも当たる（畳む深さを 0 まで降りる）', () => {
      // Fixed by post-landing review (V1) — was: 反復語を貪欲に最大深さまで剥がした形
      // （`nodes.**.total`）だけを候補に当てていたので、`get "nodes.**.children.*.total"()` の
      // 展開形 `nodes.*.children.*.total` が候補に当たらず、ランタイム（接尾辞側から照合）が
      // 受理するパスに `wcs/binding-path-missing` を出していた（パリティ欠陥）。
      const withRepeatSuffix = (p: string): boolean => new Set(['nodes.*', 'nodes.**.children.*.total']).has(p);
      expect(matchesRecursion([spec], 'nodes.*.children.*.total', withRepeatSuffix)).toBe(true);
      expect(matchesRecursion([spec], 'nodes.*.children.*.children.*.total', withRepeatSuffix)).toBe(true);
      // 深さ 0 の展開形は存在しない（`nodes.*.total` は `nodes.**.children.*.total` の族ではない）
      expect(matchesRecursion([spec], 'nodes.*.total', withRepeatSuffix)).toBe(false);
    });
    it('`**` getter の値の内側は存在扱い（評価しないと分からない側 ＝ ランタイムと同じく黙る）', () => {
      // Fixed by post-landing review (V10) — `get "nodes.**.stats"()` が `{ count }` を返す形で
      // `nodes.*.stats.count` が偽の binding-path-missing になっていた。
      const withObjectGetter = (p: string): boolean => new Set(['nodes.*', 'nodes.**.stats']).has(p);
      expect(matchesRecursion([spec], 'nodes.*.stats.count', withObjectGetter)).toBe(true);
      expect(matchesRecursion([spec], 'nodes.*.children.*.stats.a.b', withObjectGetter)).toBe(true);
      // getter の名前そのものの打ち間違いは免除されない
      expect(matchesRecursion([spec], 'nodes.*.statsx.count', withObjectGetter)).toBe(false);
      // 免除は `**` 形の候補にだけ掛かる — データ候補の下は広げない
      expect(matchesRecursion([spec], 'nodes.*.value.x', has)).toBe(false);
    });
  });

  describe('owningGetterSuffix — 具体パス綴りの再帰 getter 展開形（runtime recursiveGetterOwning の写し）', () => {
    const suffixes = ['.total', '.children.*.sum'];
    it('展開形そのものと、その値の内側を getter に帰属させる', () => {
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.total')).toBe('.total');
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.children.*.children.*.total')).toBe('.total');
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.total.x')).toBe('.total');
      // 接尾辞に反復語を含む getter は畳む深さを降りて当てる
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.children.*.sum')).toBe('.children.*.sum');
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.children.*.children.*.sum.y')).toBe('.children.*.sum');
    });
    it('葉・アンカー外・セグメント境界で一致しない接頭辞は null', () => {
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.value')).toBe(null);
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.totalx')).toBe(null);
      expect(owningGetterSuffix(spec, suffixes, 'nodes.*.sum')).toBe(null);
      expect(owningGetterSuffix(spec, suffixes, 'other.*.total')).toBe(null);
      expect(owningGetterSuffix(spec, [], 'nodes.*.total')).toBe(null);
    });
  });

  describe('structuralWriteTarget — runtime assertNotStructural の写し', () => {
    it('ノード自身と子ノードは node', () => {
      expect(structuralWriteTarget(spec, '')).toBe('node');
      expect(structuralWriteTarget(spec, '.children.*')).toBe('node');
      expect(structuralWriteTarget(spec, '.children.*.children.*')).toBe('node');
    });
    it('子リストは list', () => {
      expect(structuralWriteTarget(spec, '.children')).toBe('list');
      expect(structuralWriteTarget(spec, '.children.*.children')).toBe('list');
    });
    it('葉のプロパティは null', () => {
      expect(structuralWriteTarget(spec, '.selected')).toBeNull();
      expect(structuralWriteTarget(spec, '.children.*.selected')).toBeNull();
    });
    it('子リストの length は構造（length）— 途中のオブジェクトやノードの length は葉', () => {
      // Fixed by post-landing review (V7/P4) — 両側とも `.length` を見ておらず素通りしていた
      expect(structuralWriteTarget(spec, '.children.length')).toBe('length');
      expect(structuralWriteTarget(spec, '.children.*.children.length')).toBe('length');
      expect(structuralWriteTarget(spec, '.length')).toBeNull();
      const nested = makeRecursionSpec('nodes.*', 'branch.children.*');
      expect(structuralWriteTarget(nested, '.branch.children.length')).toBe('length');
      expect(structuralWriteTarget(nested, '.branch.length')).toBeNull();
    });
    it('多段の反復サブパスでは、子リストへ至る途中のオブジェクトも構造（branch）', () => {
      // runtime assertNotStructural と同じ穴を塞いだ形（実装計画 §7-3）
      const nested = makeRecursionSpec('nodes.*', 'branch.children.*');
      expect(structuralWriteTarget(nested, '.branch')).toBe('branch');
      expect(structuralWriteTarget(nested, '.branch.children.*.branch')).toBe('branch');
      expect(structuralWriteTarget(nested, '.branch.children')).toBe('list');
      expect(structuralWriteTarget(nested, '.branch.children.*')).toBe('node');
      expect(structuralWriteTarget(nested, '.branchX')).toBeNull();
      expect(structuralWriteTarget(nested, '.branch.note')).toBeNull();
    });
  });

  it('多段の反復サブパスでは途中のオブジェクトも含意される', () => {
    const nested = makeRecursionSpec('nodes.*', 'branch.children.*');
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes.*": "branch.children.*" },
      nodes: [],
    };`);
    const byPath = new Map(paths.map(p => [p.path, p]));
    expect(nested.repeatList).toBe('branch.children');
    expect(byPath.get('nodes.*.branch')?.kind).toBe('data');
    expect(byPath.get('nodes.*.branch.children')?.typeHint).toBe('array');
    expect(byPath.get('nodes.*.branch.children.*')?.kind).toBe('list');
    expect(foldRecursion(nested, 'nodes.*.branch.children.*.value')).toEqual({ depth: 1, rest: '.value' });
  });

  it('collectRecursionSpecs は候補集合のマーカーから spec を復元する', () => {
    const specs = collectRecursionSpecs([
      { kind: 'data', path: 'nodes' },
      { kind: 'recursionAnchor', path: 'nodes.**', repeat: 'children.*' },
      { kind: 'recursionAnchor', path: 'nodes.**', repeat: 'children.*' },
      { kind: 'recursionAnchor', path: 'broken.**' },
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0].anchor).toBe('nodes.*');
  });
});

// ============================================================
// stateAnalyzer（宣言の抽出と構造の実体化）
// ============================================================

describe('stateAnalyzer: $recursion', () => {
  it('宣言を位置付きで抽出する', () => {
    const html = makeState(TREE_STATE);
    const script = html.slice(html.indexOf('export default'));
    const declaration = analyzeRecursionDeclaration(script);
    expect(declaration).not.toBeNull();
    expect(declaration!.spec).toEqual(makeRecursionSpec('nodes.*', 'children.*'));
    expect(declaration!.entries).toHaveLength(1);
    expect(script.slice(declaration!.entries[0].start, declaration!.entries[0].end)).toBe('nodes.*');
  });

  it('宣言だけで構造パスが確定する（初期値が空配列でも）', () => {
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes.*": "children.*" },
      nodes: [],
    };`);
    const byPath = new Map(paths.map(p => [p.path, p]));
    expect(byPath.get('nodes')?.typeHint).toBe('array');
    expect(byPath.get('nodes.*')?.kind).toBe('list');
    expect(byPath.get('nodes.*.children')?.typeHint).toBe('array');
    expect(byPath.get('nodes.*.children.*')?.kind).toBe('list');
    expect(byPath.get('nodes.*.children.length')?.typeHint).toBe('number');
    // アンカーのマーカーが候補に載り、反復サブパスを運ぶ
    expect(byPath.get('nodes.**')).toEqual({ path: 'nodes.**', kind: 'recursionAnchor', repeat: 'children.*' });
  });

  it('`**` getter は kind: recursive（補完には出ない種別）', () => {
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes.*": "children.*" },
      nodes: [],
      get "nodes.**.total"() { return 0; },
      get plain() { return 1; },
    };`);
    expect(paths.find(p => p.path === 'nodes.**.total')?.kind).toBe('recursive');
    expect(paths.find(p => p.path === 'plain')?.kind).toBe('computed');
  });

  it('壊れた宣言からは構造を導出しない（静的側が追認しない）', () => {
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes": "children.*" },
      nodes: [],
    };`);
    expect(paths.some(p => p.kind === 'recursionAnchor')).toBe(false);
    expect(paths.some(p => p.path === 'nodes.*.children')).toBe(false);
  });

  it('$listKeys のキーに `**` があっても候補は作らない', () => {
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes.*": "children.*" },
      $listKeys: { "nodes.**.children": "id" },
      nodes: [],
    };`);
    expect(paths.some(p => p.path.includes('**') && p.kind !== 'recursionAnchor')).toBe(false);
  });

  it('明示宣言が実体化より優先される', () => {
    const paths = analyzeStatePaths(`export default {
      $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: [] }],
    };`);
    // 初期値リテラル由来の候補は rawInitial を持つ（実体化は持たない）
    expect(paths.filter(p => p.path === 'nodes').length).toBe(1);
    expect(paths.find(p => p.path === 'nodes')?.rawInitial).toBeDefined();
  });
});

// ============================================================
// パス存在検証（誤報しないこと）
// ============================================================

describe('パス検証: 展開形は存在扱い', () => {
  it('深さ 0 / 1 / 2 の再帰 getter を data-wcs から読める', () => {
    const html = `${makeState(TREE_STATE)}
<template data-wcs="for: nodes">
  <b data-wcs="textContent: nodes.*.total"></b>
  <template data-wcs="for: nodes.*.children">
    <b data-wcs="textContent: nodes.*.children.*.total"></b>
    <template data-wcs="for: nodes.*.children.*.children">
      <b data-wcs="textContent: nodes.*.children.*.children.*.total"></b>
      <i data-wcs="textContent: nodes.*.children.*.children.*.label"></i>
    </template>
  </template>
</template>`;
    expect(validateBindings(html, 'data-wcs')).toEqual([]);
  });

  it('深い行フィールドのタイプミスは従来どおり検出する', () => {
    const html = `${makeState(TREE_STATE)}
<template data-wcs="for: nodes">
  <template data-wcs="for: nodes.*.children">
    <b data-wcs="textContent: nodes.*.children.*.labl"></b>
  </template>
</template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.BindingPathMissing]);
    expect(diags[0].message).toContain('nodes.*.children.*.labl');
  });

  it('宣言が無ければ深い具体パスは従来どおり未存在', () => {
    const html = `${makeState(`
  nodes: [{ value: 1, children: [] }]`)}
<template data-wcs="for: nodes">
  <template data-wcs="for: nodes.*.children">
    <b data-wcs="textContent: nodes.*.children.*.value"></b>
  </template>
</template>`;
    expect(codes(validateBindings(html, 'data-wcs'))).toContain(WcsDiagnosticCode.BindingPathMissing);
  });

  it('mustache でも同じ規則が効く', () => {
    const html = `${makeState(TREE_STATE)}
<template data-wcs="for: nodes">
  <template data-wcs="for: nodes.*.children">
    <template><b>{{ nodes.*.children.*.total }}</b></template>
  </template>
</template>`;
    expect(codes(validateTemplateSyntax(html, 'wcs-state')).filter(c => c !== WcsDiagnosticCode.TemplateSyntax))
      .toEqual([]);
  });

  it('$watch の展開形も存在扱いになる', () => {
    const html = makeState(`${TREE_STATE},
  $watch: {
    "nodes.*.children.*.value"(cur, prev) { void cur; void prev; },
  }`);
    expect(codes(validateWatchDeclarations(html))).toEqual([]);
  });
});

// ============================================================
// `**` を解釈しない場所（runtime が throw する形）
// ============================================================

describe('`**` を解釈しない消費者', () => {
  it('data-wcs の `**` は error（runtime は PathInfo の不変条件で throw）', () => {
    const html = `${makeState(TREE_STATE)}
<b data-wcs="textContent: nodes.**.total"></b>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags[0].severity).toBe('error');
    // `*` を含むので従来のパターンパス検査にも掛かるが、重ねない
    expect(diags).toHaveLength(1);
  });

  it('mustache の `**` も error', () => {
    const html = `${makeState(TREE_STATE)}
<template><b>{{ nodes.**.total }}</b></template>`;
    expect(codes(validateTemplateSyntax(html, 'wcs-state')))
      .toContain(WcsDiagnosticCode.RecursionUnsupported);
  });

  it('$watch のキーの `**` は error', () => {
    const html = makeState(`${TREE_STATE},
  $watch: {
    "nodes.**.value"(cur, prev) { void cur; void prev; },
  }`);
    const diags = validateWatchDeclarations(html);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags[0].severity).toBe('error');
  });

  it('$resolve の `**` は error', () => {
    const html = makeState(`${TREE_STATE},
  probe() { return this.$resolve("nodes.**.value", [0]); }`);
    const diags = validateRecursion(html);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags[0].message).toContain('$resolve');
  });

  it('宣言が無いのに `**` を使うと診断される', () => {
    const html = makeState(`
  nodes: [],
  get "nodes.**.total"() { return 0; },
  sum() { return this.$getAll("nodes.**.value", []); }`);
    const diags = validateRecursion(html);
    expect(codes(diags)).toEqual([
      WcsDiagnosticCode.RecursionUnsupported,
      WcsDiagnosticCode.RecursionUnsupported,
    ]);
    expect(diags[0].message).toContain('$recursion');
    // getter キーは runtime が黙って無視する（落ちない）ので warning、
    // API 引数は getPathInfo の不変条件で throw する（落ちる）ので error
    expect(diags.map(d => d.severity)).toEqual(['warning', 'error']);
  });
});

// ============================================================
// 宣言そのものの検証
// ============================================================

describe('$recursion 宣言の検証', () => {
  const only = (script: string): { code: string; message: string }[] =>
    validateRecursion(makeState(script)).map(d => ({ code: d.code, message: d.message }));

  it('正しい宣言は無診断', () => {
    expect(only(TREE_STATE)).toEqual([]);
  });

  it('アンカーが要素を指していない', () => {
    const diags = only(`
  $recursion: { "nodes": "children.*" },
  nodes: []`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.RecursionDeclarationInvalid);
    expect(diags[0].message).toContain('nodes');
  });

  it('反復サブパスの途中のワイルドカードを拒否する', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*.items.*" },
  nodes: []`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.RecursionDeclarationInvalid);
  });

  it('複数アンカーは初版では未対応', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*", "rows.*": "kids.*" },
  nodes: [], rows: []`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('2');
  });

  it('空の宣言を拒否する', () => {
    expect(only(`
  $recursion: {},
  nodes: []`)[0].code).toBe(WcsDiagnosticCode.RecursionDeclarationInvalid);
  });

  it('オブジェクトでない宣言を断定できる場合だけ拒否する', () => {
    expect(only(`
  $recursion: "nodes.*",
  nodes: []`)[0].code).toBe(WcsDiagnosticCode.RecursionDeclarationInvalid);
    // 識別子参照は実行時まで分からない — 黙る
    expect(only(`
  $recursion: SHARED,
  nodes: []`)).toEqual([]);
  });

  it('反復サブパスが識別子参照・`${}` 付きテンプレートなら断定せず黙る（形が決まらないので以降の検証も黙る）', () => {
    // Fixed by cycle-2 review — was: 文字列リテラルでない値を無条件に
    // `recursion-declaration-invalid`（error）にしていて、ランタイムでは正当な識別子参照で
    // `wcs-validate` が exit 1 になっていた（このテスト自身がその偽陽性を固定していた）。
    expect(only(`
  $recursion: { "nodes.*": REPEAT },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  sum() { return this.$getAll("nodes.**.value", []); }`)).toEqual([]);
    expect(only(`
  $recursion: { "nodes.*": \`\${list}.*\` },
  nodes: []`)).toEqual([]);
    expect(only(`
  $recursion: { "nodes.*": repeatOf("children") },
  nodes: []`)).toEqual([]);
  });

  it('`${}` の無いテンプレートリテラルは文字列として受理して spec を組む', () => {
    expect(only(`
  $recursion: { "nodes.*": \`children.*\` },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  poke() { this.$setAll("nodes.**.total", [], 0); }`).map(d => d.code)).toEqual([WcsDiagnosticCode.RecursionReadonly]);
  });

  it('反復サブパスが文字列でないと断定できる値（数値・真偽値・null・配列・オブジェクト・関数）は error', () => {
    for (const value of ['1', 'true', 'null', '["children.*"]', '{ path: "children.*" }', '() => "children.*"', 'function () {}']) {
      const diags = only(`
  $recursion: { "nodes.*": ${value} },
  nodes: []`);
      expect(codes(diags), value).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
      expect(diags[0].message, value).toContain('nodes.*');
    }
    // メソッド短縮記法も関数
    expect(codes(only(`
  $recursion: { "nodes.*"() { return "children.*"; } },
  nodes: []`))).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
  });
});

// ============================================================
// `**` getter の宣言の形
// ============================================================

describe('`**` getter の宣言', () => {
  const only = (script: string) => validateRecursion(makeState(script));

  it('アンカー違いの `**` getter', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "tree.**.total"() { return 0; }`);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionAnchor]);
  });

  it('ノード自身を名指す `**` getter', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**"() { return 0; }`);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(diags[0].message).toContain('nodes.**');
  });

  it('接尾辞が再帰の構造そのもの（子リスト・子ノード・length・途中のオブジェクト）の `**` getter は error', () => {
    // Fixed by cycle-2 review — runtime は構築時に raise するようになった（生成 getter が実データの
    // 子リストを全深さで影にする）。書き側の structural-write と同じ述語で宣言側も拒否する。
    // 添字綴り（`nodes.**.children.0`）も畳んで同じ判定（書き側・runtime と揃える）
    for (const key of ['nodes.**.children', 'nodes.**.children.*', 'nodes.**.children.length', 'nodes.**.children.*.children',
      'nodes.**.children.0', 'nodes.**.children.0.children.length']) {
      const diags = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "${key}"() { return 42; }`), 'wcs-state', 'en');
      expect(codes(diags), key).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
      expect(diags[0].message, key).toContain(`"${key}" names the recursion structure itself`);
    }
    const nested = validateRecursion(makeState(`
  $recursion: { "nodes.*": "branch.children.*" },
  nodes: [],
  get "nodes.**.branch"() { return {}; }`));
    expect(codes(nested)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    // 対照: `.children.*` の下の葉は通る
    expect(only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.children.*.label"() { return "x"; }`)).toEqual([]);
  });

  it('再帰 setter は未対応', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  set "nodes.**.total"(v) { void v; }`);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(diags[0].message).toContain('setter');
  });

  it('getter でない `**` キー', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  "nodes.**.total": 0`);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
  });

  it('同じ具体パスへ展開する 2 本を拒否する', () => {
    const diags = only(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  get "nodes.**.children.*.total"() { return 0; }`);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(diags[0].message).toContain('children.*');
  });
});

// ============================================================
// $getAll / $setAll の形
// ============================================================

describe('$getAll / $setAll の形', () => {
  const only = (body: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  probe() { ${body} }`));

  it('添字省略と [] は正当（一律にエラーにしない）', () => {
    expect(only('return this.$getAll("nodes.**.value");')).toEqual([]);
    expect(only('return this.$getAll("nodes.**.value", []);')).toEqual([]);
    expect(only('return this.$getAll("nodes.**.children.*.total");')).toEqual([]);
  });

  it('非空の接頭辞は $getAll では定義できない', () => {
    const diags = only('return this.$getAll("nodes.**.value", [0]);');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionGetAllForm]);
  });

  it('$getAll の添字が null・配列でないリテラルなら recursion-getall-form（runtime と同じ）、undefined は束縛形なので黙る', () => {
    // Fixed by cycle-2 review — `validateSetAllForm` は null を拾っていたのに `$getAll` 側だけ沈黙していた
    for (const arg of ['null', '"x"', '0', 'true', '{ depth: 1 }']) {
      const diags = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  probe() { return this.$getAll("nodes.**.value", ${arg}); }`), 'wcs-state', 'en');
      expect(codes(diags), arg).toEqual([WcsDiagnosticCode.RecursionGetAllForm]);
      expect(diags[0].message, arg).toContain('not null or a non-array value');
    }
    expect(only('return this.$getAll("nodes.**.value", undefined);')).toEqual([]);
    expect(only('return this.$getAll("nodes.**.value", indexes);')).toEqual([]);
  });

  it('$setAll の [] ブロードキャストは正当', () => {
    expect(only('this.$setAll("nodes.**.selected", [], false);')).toEqual([]);
  });

  it('$setAll の非空接頭辞 / 添字省略 / mapper / spread を拒否する', () => {
    expect(codes(only('this.$setAll("nodes.**.selected", [0], false);')))
      .toEqual([WcsDiagnosticCode.RecursionSetAllForm]);
    expect(codes(only('this.$setAll("nodes.**.selected");')))
      .toEqual([WcsDiagnosticCode.RecursionSetAllForm]);
    expect(codes(only('this.$setAll("nodes.**.selected", [], (c) => !c);')))
      .toEqual([WcsDiagnosticCode.RecursionSetAllForm]);
    expect(codes(only('this.$setAll("nodes.**.selected", [], [1, 2], { spread: true });')))
      .toEqual([WcsDiagnosticCode.RecursionSetAllForm]);
  });

  it('構造への一括書き込みを拒否する', () => {
    expect(codes(only('this.$setAll("nodes.**", [], null);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(only('this.$setAll("nodes.**.children", [], []);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(only('this.$setAll("nodes.**.children.*", [], null);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
  });

  it('多段の反復サブパスでは、子リストへ至る途中のオブジェクトへの一括書き込みも拒否する', () => {
    const nested = (call: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "branch.children.*" },
  nodes: [],
  wipe() { ${call} }`), 'wcs-state', 'en');
    const branch = nested('this.$setAll("nodes.**.branch", [], { children: [] });');
    expect(codes(branch)).toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(branch[0].message).toContain('an object on the way to the "branch.children" list');
    expect(codes(nested('this.$setAll("nodes.**.branch.children.*.branch", [], null);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(nested('this.$setAll("nodes.**.branch.children", [], []);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    // 葉は通る
    expect(codes(nested('this.$setAll("nodes.**.branch.note", [], "x");'))).toEqual([]);
    expect(codes(nested('this.$setAll("nodes.**.branchX", [], 1);'))).toEqual([]);
  });

  it('再帰 getter への書き込みを拒否する', () => {
    expect(codes(only('this.$setAll("nodes.**.total", [], 0);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
    // 深さ違いの同じ族
    expect(codes(only('this.$setAll("nodes.**.children.*.total", [], 0);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
    // getter が返した値の中
    expect(codes(only('this.$setAll("nodes.**.total.x", [], 0);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
  });

  it('アンカー違いは recursion-anchor', () => {
    expect(codes(only('return this.$getAll("tree.**.value", []);')))
      .toEqual([WcsDiagnosticCode.RecursionAnchor]);
  });

  it('パスが文字列リテラルでなければ黙る（断定できない）', () => {
    expect(only('return this.$getAll(PATH, [0]);')).toEqual([]);
  });

  it('コメントの中の呼び出しは拾わない', () => {
    expect(only('// this.$setAll("nodes.**", [], 1);\n    return 0;')).toEqual([]);
  });

  it('編集途中で閉じ括弧が無い呼び出しでは黙る', () => {
    expect(only('return this.$getAll("nodes.**.value", [0')).toEqual([]);
  });
});

// ============================================================
// getter 依存解析（循環と深さ方向の区別）
// ============================================================

describe('wcs/getter-cycle と再帰 getter', () => {
  it('深さが進む自己参照を循環扱いしない', () => {
    const html = makeState(TREE_STATE);
    expect(codes(validateSemantics(html))).not.toContain(WcsDiagnosticCode.GetterCycle);
  });

  it('深さ方向へ降りる相互参照も循環ではない', () => {
    // a(n) → b(child) → a(child) → … は木を下るだけで、葉で止まる
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.a"() { return this.$getAll("nodes.**.children.*.b"); },
  get "nodes.**.b"() { return this["nodes.**.a"]; }`);
    // b → a は深さ差 0 の辺、a → b は深さ差 1 で辺にならない ＝ 閉路なし
    expect(codes(validateSemantics(html))).not.toContain(WcsDiagnosticCode.GetterCycle);
  });

  it('同じ深さへ戻る自己参照は循環として報告する', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return this.$getAll("nodes.**.total", []).length; }`);
    expect(codes(validateSemantics(html))).toContain(WcsDiagnosticCode.GetterCycle);
  });

  it('同じ深さの相互参照も循環として報告する', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.a"() { return this["nodes.**.b"]; },
  get "nodes.**.b"() { return this["nodes.**.a"]; }`);
    expect(codes(validateSemantics(html))).toContain(WcsDiagnosticCode.GetterCycle);
  });

  it('`**` パスに wcs/index-arity を出さない（本数は深さで変わる）', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  probe() { return this.$getAll("nodes.**.value", []); }`);
    expect(codes(validateSemantics(html))).not.toContain(WcsDiagnosticCode.IndexArity);
  });
});

// ============================================================
// validateDocument（IDE / CLI が通る単一入口）
// ============================================================

describe('validateDocument 統合', () => {
  it('README の idiom は診断ゼロ', () => {
    const html = `<!doctype html>
${makeState(TREE_STATE)}
<template data-wcs="for: nodes">
  <li>
    <b data-wcs="textContent: nodes.*.total"></b>
    <input type="checkbox" data-wcs="checked: nodes.*.selected">
    <template data-wcs="for: nodes.*.children">
      <b data-wcs="textContent: nodes.*.children.*.total"></b>
    </template>
  </li>
</template>
<button data-wcs="onclick: clearSelection">clear</button>`;
    expect(validateDocument(html, { locale: 'en' })).toEqual([]);
  });

  it('壊れた使い方は error として集約される', () => {
    const html = `<!doctype html>
${makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  wipe() { this.$setAll("nodes.**.children", [], []); }`)}
<b data-wcs="textContent: nodes.**.total"></b>`;
    const diags = validateDocument(html, { locale: 'en' });
    expect(codes(diags).sort()).toEqual([
      WcsDiagnosticCode.RecursionStructuralWrite,
      WcsDiagnosticCode.RecursionUnsupported,
    ].sort());
    expect(diags.every(d => d.severity === 'error')).toBe(true);
  });

  it('ja / en で code と range は同じ', () => {
    const html = `${makeState(TREE_STATE)}\n<b data-wcs="textContent: nodes.**.total"></b>`;
    const ja = validateDocument(html, { locale: 'ja' });
    const en = validateDocument(html, { locale: 'en' });
    expect(ja.map(d => [d.code, d.start, d.end])).toEqual(en.map(d => [d.code, d.start, d.end]));
    expect(ja[0].message).not.toBe(en[0].message);
  });
});

// ============================================================
// 着地後レビュー（第 2 回）で直した静的側の穴
// ============================================================

describe('宣言が静的に読めない形では「未宣言」と断定しない', () => {
  // Fixed by post-landing review (V2/V3) — was: `validateDeclaration` は識別子参照を
  // 「断定しない」として null を返すのに、`validateApiCalls` は spec === null を無条件に
  // 「未宣言」と断定し、正当なコードに error を出して `wcs-validate` が exit 1 になっていた。
  it('識別子参照の $recursion では $getAll / $setAll の `**` に黙る', () => {
    const html = `<wcs-state><script type="module">
const REC = { "nodes.*": "children.*" };
export default {
  $recursion: REC,
  nodes: [],
  get "nodes.**.total"() { return 0; },
  sum() { return this.$getAll("nodes.**.value", []); },
  clear() { this.$setAll("nodes.**.selected", [], false); },
};
</script></wcs-state>`;
    expect(validateRecursion(html)).toEqual([]);
  });

  it('class 構文（impl-plan §1-1 の綴り）でも黙る', () => {
    const html = `<wcs-state><script type="module">
export default class TreeState {
  $recursion = { "nodes.*": "children.*" };
  nodes = [];
  get "nodes.**.total"() { return this["nodes.**.value"] + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0); }
  get treeTotal() { return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0); }
  clearSelection() { this.$setAll("nodes.**.selected", [], false); }
}
</script></wcs-state>`;
    expect(validateRecursion(html)).toEqual([]);
    expect(validateDocument(html, { locale: 'en' }).filter(d => d.code.startsWith('wcs/recursion'))).toEqual([]);
  });

  it('オブジェクトリテラルが読めて $recursion が無いときだけ「未宣言」（従来どおり）', () => {
    const diags = validateRecursion(makeState(`
  nodes: [],
  sum() { return this.$getAll("nodes.**.value", []); }`));
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags[0].message).toContain('$recursion');
  });

  it('`**` を解釈しない消費者（$resolve / 代入）は宣言が読めなくても error（runtime は必ず throw）', () => {
    const html = `<wcs-state><script type="module">
export default class TreeState {
  $recursion = { "nodes.*": "children.*" };
  nodes = [];
  poke() { this["nodes.**.value"] = 5; return this.$resolve("nodes.**.value", [0]); }
}
</script></wcs-state>`;
    const diags = validateRecursion(html);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported, WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags.map(d => d.severity)).toEqual(['error', 'error']);
  });

  it('hasDefaultExportObject はオブジェクトリテラルの有無を答える', () => {
    expect(hasDefaultExportObject('export default { a: 1 };')).toBe(true);
    expect(hasDefaultExportObject('export default defineState({ a: 1 });')).toBe(true);
    expect(hasDefaultExportObject('export default class S {}')).toBe(false);
    expect(hasDefaultExportObject('const s = {}; export default s;')).toBe(false);
  });
});

describe('パス検証: 接尾辞に反復語を含む getter と、getter の値の内側', () => {
  it('`get "nodes.**.children.*.total"()` の展開形を data-wcs から読める（V1）', () => {
    const html = `${makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [{ value: 1, children: [] }],
  get "nodes.**.children.*.total"() { return 0; }`)}
<template data-wcs="for: nodes">
  <template data-wcs="for: nodes.*.children">
    <b data-wcs="textContent: nodes.*.children.*.total"></b>
    <template data-wcs="for: nodes.*.children.*.children">
      <b data-wcs="textContent: nodes.*.children.*.children.*.total"></b>
    </template>
  </template>
</template>`;
    expect(validateBindings(html, 'data-wcs')).toEqual([]);
  });

  it('オブジェクトを返す `**` getter の値の内側は黙り、getter 名の打ち間違いは捉える（V10）', () => {
    const state = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [{ value: 1, children: [] }],
  get "nodes.**.stats"() { return { count: 1 }; }`);
    expect(validateBindings(`${state}
<template data-wcs="for: nodes"><b data-wcs="textContent: nodes.*.stats.count"></b>
  <template data-wcs="for: nodes.*.children"><b data-wcs="textContent: nodes.*.children.*.stats.count"></b></template>
</template>`, 'data-wcs')).toEqual([]);
    const typo = validateBindings(`${state}
<template data-wcs="for: nodes"><b data-wcs="textContent: nodes.*.statsx.count"></b></template>`, 'data-wcs');
    expect(codes(typo)).toEqual([WcsDiagnosticCode.BindingPathMissing]);
  });
});

describe('$setAll: 子リストの length への一括書き込み', () => {
  it('nodes.**.children.length は recursion-structural-write（V7）', () => {
    const diags = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  wipe() { this.$setAll("nodes.**.children.length", [], 0); }`), 'wcs-state', 'en');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(diags[0].message).toContain('the length of the "children" list');
    expect(diags[0].message).toContain('truncates the array');
    // 多段の反復サブパスでも、リスト側の length だけが構造
    const nested = (call: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "branch.children.*" },
  nodes: [],
  wipe() { ${call} }`));
    expect(codes(nested('this.$setAll("nodes.**.branch.children.length", [], 0);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(nested('this.$setAll("nodes.**.branch.length", [], 3);')).toEqual([]);
  });
});
describe('`**` を解釈しない消費者（代入・$postUpdate・$trackDependency・$listKeys）', () => {
  // Fixed by post-landing review (V4) — README の診断表は linter が代入を出すと読めるのに、
  // 静的側は 3 つとも 0 件だった（runtime は 3 つとも throw）。
  it('this["…**…"] = … / $postUpdate / $trackDependency は recursion-unsupported（error）', () => {
    const diags = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  poke() {
    this["nodes.**.value"] = 5;
    this['nodes.**.value'] += 1;
    this["nodes.**.value"] ??= 0;
    this.$postUpdate("nodes.**.value");
    this.$trackDependency("nodes.**.value");
  }`), 'wcs-state', 'en');
    expect(codes(diags)).toEqual(Array(5).fill(WcsDiagnosticCode.RecursionUnsupported));
    expect(diags.every(d => d.severity === 'error')).toBe(true);
    // 報告順は API 呼び出し → 代入（validator の走査順）
    expect(diags[0].message).toContain('$postUpdate(');
    expect(diags[1].message).toContain('$trackDependency(');
    expect(diags[2].message).toContain('this["nodes.**.value"] = …');
    // 代入の範囲は引用符の中身
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  poke() { this["nodes.**.value"] = 5; }`);
    const one = validateRecursion(html);
    expect(html.slice(one[0].start, one[0].end)).toBe('nodes.**.value');
  });

  it('比較（== / ===）と読み取りは代入ではない', () => {
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.big"() { return this["nodes.**.value"] === 5 || this["nodes.**.value"] == 6; }`))).toEqual([]);
  });

  it('$listKeys のキーの `**` は recursion-unsupported（runtime は宣言の処理で throw）', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  $listKeys: { "nodes.**.children": "id", "nodes": "id" },
  nodes: []`);
    const diags = validateRecursion(html);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(diags[0].severity).toBe('error');
    expect(html.slice(diags[0].start, diags[0].end)).toBe('nodes.**.children');
    expect(diags[0].message).toContain('$listKeys');
    // 宣言の無い state でも同じ（`**` はどこでも解釈されない）
    expect(codes(validateRecursion(makeState(`
  $listKeys: { "nodes.**.children": "id" },
  nodes: []`)))).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
  });

  it('analyzeListKeyEntries は $listKeys のエントリを位置付きで返す', () => {
    const script = `export default {
  $listKeys: { "items": "id", "nodes.*.children": (row) => row.key },
};`;
    const entries = analyzeListKeyEntries(script);
    expect(entries.map(e => e.key)).toEqual(['items', 'nodes.*.children']);
    expect(script.slice(entries[1].start, entries[1].end)).toBe('nodes.*.children');
    expect(analyzeListKeyEntries('export default { $listKeys: KEYS };')).toEqual([]);
    expect(analyzeListKeyEntries('export default class S {}')).toEqual([]);
  });
});

describe('具体パス綴りでの再帰 getter への書き込み（`**` を経ない入口）', () => {
  // Fixed by post-landing review (P18) — runtime は `setByAddress` の入口で止めるようになった。
  // 静的側も同じ判定（展開形とその値の内側）を `wcs/recursion-readonly` で出す。
  const only = (body: string, locale = 'en') => validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  probe() { ${body} }`), 'wcs-state', locale);

  it('$setAll / 値付き $resolve / 代入で展開形とその値の内側へ書くと recursion-readonly', () => {
    const diags = only(`
    this.$setAll("nodes.*.children.*.total", [], 5);
    this.$resolve("nodes.*.total", [0], 9);
    this["nodes.*.total"] = 1;
    this.$setAll("nodes.*.total.x", [], 0);`);
    expect(codes(diags)).toEqual(Array(4).fill(WcsDiagnosticCode.RecursionReadonly));
    // 報告順は API 呼び出し → 代入
    expect(diags[0].message).toContain('$setAll("nodes.*.children.*.total") writes into the recursive getter "nodes.**.total"');
    expect(diags[1].message).toContain('$resolve("nodes.*.total") writes into');
    expect(diags[2].message).toContain('$setAll("nodes.*.total.x") writes into');
    expect(diags[3].message).toContain('this["nodes.*.total"] = … writes into');
  });

  it('読みだけの $resolve・葉への書き込み・getter の無い state は黙る', () => {
    expect(only('return this.$resolve("nodes.*.total", [0]);')).toEqual([]);
    expect(only('this.$setAll("nodes.*.children.*.value", [], 5); this["nodes.*.value"] = 1;')).toEqual([]);
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  poke() { this.$setAll("nodes.*.total", [], 5); }`))).toEqual([]);
  });

  it('ja / en で code と range は同じ', () => {
    const ja = only('this["nodes.*.total"] = 1;', 'ja');
    const en = only('this["nodes.*.total"] = 1;', 'en');
    expect(ja.map(d => [d.code, d.start, d.end])).toEqual(en.map(d => [d.code, d.start, d.end]));
    expect(ja[0].message).toContain('再帰 getter "nodes.**.total"');
  });
});

describe('ボリューム（mount=）の $recursion と `**` getter', () => {
  // Fixed by post-landing review (S12) — runtime は接ぎ木前に raise するが、静的側は沈黙していた
  const html = `<wcs-state><script type="module">export default { tree: {} };</script></wcs-state>
<wcs-state mount="tree"><script type="module">
export default {
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  set "nodes.**.total"(v) { void v; },
};
</script></wcs-state>`;

  it('宣言と `**` getter を recursion-declaration-invalid（error）で報告する（get/set は 1 件に畳む）', () => {
    const diags = validateRecursion(html, 'wcs-state', 'en');
    expect(codes(diags)).toEqual([
      WcsDiagnosticCode.RecursionDeclarationInvalid,
      WcsDiagnosticCode.RecursionDeclarationInvalid,
    ]);
    expect(diags.every(d => d.severity === 'error')).toBe(true);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('$recursion');
    expect(html.slice(diags[1].start, diags[1].end)).toBe('nodes.**.total');
    expect(diags[0].message).toContain('mount="tree"');
    expect(diags[1].message).toContain('"nodes.**.total" cannot be declared in a volume');
  });

  it('`**` getter だけのボリュームも報告し、ボリュームの他の検証は行わない', () => {
    const onlyGetter = `<wcs-state mount="tree"><script type="module">
export default {
  nodes: [],
  get "nodes.**.total"() { return 0; },
  clear() { this.$setAll("nodes.**", [], null); },
};
</script></wcs-state>`;
    const diags = validateRecursion(onlyGetter);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    // `**` を含まないボリュームは従来どおり素通り
    expect(validateRecursion(`<wcs-state mount="tree"><script type="module">export default { nodes: [] };</script></wcs-state>`))
      .toEqual([]);
  });

  it('validateDocument に集約される', () => {
    expect(validateDocument(html, { locale: 'en' }).filter(d => d.code === WcsDiagnosticCode.RecursionDeclarationInvalid))
      .toHaveLength(2);
  });
});

// ============================================================
// 着地後レビュー（第 3 回）
// ============================================================

describe('spread で宣言を持ち込むオブジェクトリテラルでは「未宣言」と断定しない', () => {
  // Fixed by post-landing review (round 3, S9) — was: `...tree` で `$recursion` を持ち込む形は
  // オブジェクトリテラル自体は読めるので `undeclared` になり、`**` getter に warning・`$getAll` に
  // error を出して `wcs-validate` が exit 1 になっていた（ランタイムは正常に動く）。
  const spread = `<wcs-state><script type="module">
const tree = { $recursion: { "nodes.*": "children.*" } };
export default {
  ...tree,
  nodes: [],
  get "nodes.**.total"() { return 0; },
  get treeTotal() { return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0); },
};
</script></wcs-state>`;

  it('トップレベルの spread があれば $getAll / `**` getter に黙る', () => {
    expect(validateRecursion(spread)).toEqual([]);
  });

  it('入れ子の spread（`nodes: [...rows]`）は宣言を持ち込めないので従来どおり報告する', () => {
    const diags = validateRecursion(makeState(`
  nodes: [...rows],
  get "nodes.**.total"() { return 0; },
  sum() { return this.$getAll("nodes.**.value", []); }`));
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported, WcsDiagnosticCode.RecursionUnsupported]);
  });

  it('hasTopLevelSpread はトップレベルの `...` だけを数える（文字列の中は見ない）', () => {
    expect(hasTopLevelSpread('export default { ...base, a: 1 };')).toBe(true);
    expect(hasTopLevelSpread('export default { a: 1, ...base };')).toBe(true);
    expect(hasTopLevelSpread('export default { a: [...xs], b: { ...ys }, c: f(...zs) };')).toBe(false);
    expect(hasTopLevelSpread('export default { a: "...", b: 1 };')).toBe(false);
    expect(hasTopLevelSpread('export default class S {}')).toBe(false);
  });
});

describe('文字列・テンプレートリテラルの中の `this["…"] = …` は代入ではない', () => {
  // Fixed by post-landing review (round 3, S7) — 代入の走査が blankComments（文字列の中身が
  // 残る）だったため、`'this["nodes.**.value"] = 1'` という文字列を代入と誤認して error にしていた。
  it('文字列の中身は代入として拾わない', () => {
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  x: 'this["nodes.**.value"] = 1',
  y: \`this["nodes.**.value"] = 1\`,
  z: "this['nodes.**.value'] += 1"`))).toEqual([]);
  });

  it('同じ行に文字列と本物の代入があれば、本物だけを原文の位置で報告する', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  poke() { const s = 'this["nodes.**.value"] = 1'; this["nodes.**.value"] = 2; return s; }`);
    const diags = validateRecursion(html);
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionUnsupported]);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('nodes.**.value');
    expect(diags[0].start).toBeGreaterThan(html.indexOf("'this["));
  });
});

describe('添字綴り（nodes.1.total）での再帰 getter への書き込み', () => {
  // Fixed by post-landing review (round 3, S1) — ランタイムは `this["nodes.1.total"]` を
  // `nodes.*.total` に畳んで `recursion-readonly` にするが、静的側は `nodes.*` で始まらない
  // ので黙っていた（パリティ欠陥）。API のパス引数（`$setAll("nodes.1.total", …)`）も同じ。
  const only = (body: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  probe() { ${body} }`), 'wcs-state', 'en');

  it('代入・$setAll・値付き $resolve の添字綴りを recursion-readonly にする', () => {
    const diags = only(`
    this.$setAll("nodes.1.total", [], 9);
    this.$resolve("nodes.0.children.0.total", [], 1);
    this["nodes.1.total"] = 9;
    this["nodes.0.children.0.total.x"] = 1;`);
    expect(codes(diags)).toEqual(Array(4).fill(WcsDiagnosticCode.RecursionReadonly));
    expect(diags[0].message).toContain('$setAll("nodes.1.total") writes into the recursive getter "nodes.**.total"');
    expect(diags[2].message).toContain('this["nodes.1.total"] = …');
  });

  it('添字綴りの葉は黙る', () => {
    expect(only('this["nodes.1.value"] = 1; this.$setAll("nodes.0.children.1.value", [], 2);')).toEqual([]);
  });

  it('ワイルドカードと添字の混在綴り（nodes.*.children.0.total）も recursion-readonly（ランタイムと同じ）', () => {
    const diags = only(`
    this.$setAll("nodes.*.children.0.total", [], 5);
    this.$resolve("nodes.*.children.0.total", [0], 6);
    this["nodes.0.children.*.total.x"] = 1;`);
    expect(codes(diags)).toEqual(Array(3).fill(WcsDiagnosticCode.RecursionReadonly));
    expect(only('this.$resolve("nodes.*.children.0.value", [0], 5);')).toEqual([]);
  });

  it('indexSegmentsToWildcard はランタイムと同じ述語（`Number()` が NaN でないセグメント）を `*` に畳む', () => {
    expect(indexSegmentsToWildcard('nodes.1.children.0.total')).toBe('nodes.*.children.*.total');
    expect(indexSegmentsToWildcard('nodes.*.total')).toBe('nodes.*.total');
    expect(indexSegmentsToWildcard('nodes.v1.total10')).toBe('nodes.v1.total10');
    // 述語はランタイム（ResolvedAddress）と同じ「Number() が NaN でない区切り」
    expect(indexSegmentsToWildcard('nodes.1e3.total')).toBe('nodes.*.total');
    expect(indexSegmentsToWildcard('nodes.-1.total')).toBe('nodes.*.total');
    expect(indexSegmentsToWildcard('nodes.0x1.total')).toBe('nodes.*.total');
    expect(indexSegmentsToWildcard('nodes..total')).toBe('nodes.*.total');
    expect(indexSegmentsToWildcard('nodes.*.children.0.total')).toBe('nodes.*.children.*.total');
  });

  it('`**` パスの接尾辞の添字綴りも畳んで構造・読み取り専用にする（runtime の setAllRecursive と同じ）', () => {
    // Fixed by cycle-2 review — 添字畳みが `**` を経ない綴りにしか掛かっておらず、
    // `nodes.**.children.0` / `.children.0.children` / `.children.0.total` は静的側も沈黙していた
    expect(codes(only('this.$setAll("nodes.**.children.0", [], { value: 999, children: [] });')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(only('this.$setAll("nodes.**.children.0.children", [], []);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(only('this.$setAll("nodes.**.children.0.children.length", [], 0);')))
      .toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
    expect(codes(only('this.$setAll("nodes.**.children.0.total", [], 5);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
    // 葉は通る（ノード自身 `nodes.**` の空接尾辞も従来どおり構造）
    expect(only('this.$setAll("nodes.**.children.0.value", [], 5);')).toEqual([]);
    expect(codes(only('this.$setAll("nodes.**", [], null);'))).toEqual([WcsDiagnosticCode.RecursionStructuralWrite]);
  });
});

// ============================================================
// 第 3 サイクル
// ============================================================

describe('`**` getter の展開形と同名の具体 getter（構築時の衝突）', () => {
  // Fixed by cycle-3 review — runtime は「その深さを最初に読んだとき」にしか落ちず、静的側は
  // `**` どうし（sameFamily）しか見ていなかった。runtime は構築時に落とすようになり、静的側も同じ形を報告する。
  it('展開形そのものと同名の getter / データプロパティを recursion-declaration-invalid（error）にする', () => {
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  get "nodes.*.children.*.total"() { return 7; },
  "nodes.*.total": 0,
  get "nodes.*.label"() { return "x"; }`);
    const diags = validateRecursion(html, 'wcs-state', 'en');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid, WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(diags.every(d => d.severity === 'error')).toBe(true);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('nodes.*.children.*.total');
    expect(diags[0].message).toContain('"nodes.*.children.*.total" is already defined on the state, so the recursive getter "nodes.**.total" cannot expand to it');
    expect(html.slice(diags[1].start, diags[1].end)).toBe('nodes.*.total');
  });

  it('値の内側（nodes.*.total.x）・葉・`**` getter の無い state は黙る', () => {
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  get "nodes.*.total.x"() { return 1; },
  get "nodes.*.value"() { return 1; }`))).toEqual([]);
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.*.total"() { return 1; }`))).toEqual([]);
  });

  it('concreteExpansionSuffix は展開形そのものだけに一致する', () => {
    const spec = makeRecursionSpec('nodes.*', 'children.*');
    expect(concreteExpansionSuffix(spec, ['.total'], 'nodes.*.children.*.total')).toBe('.total');
    expect(concreteExpansionSuffix(spec, ['.total'], 'nodes.*.total.x')).toBeNull();
    expect(concreteExpansionSuffix(spec, ['.total'], 'other.*.total')).toBeNull();
  });
});

describe('$recursion の値に計算キー・spread があれば「空」と断定しない', () => {
  // Fixed by cycle-3 review — `parseTopLevelProperties` が `[expr]:` と `...` を拾えずエントリ 0 件になり、
  // `objectLiteral === true` だけで「it is empty」と偽陽性を出していた（runtime は受理する）。
  it('計算キー・spread は黙る（宣言は組めないので以降の検証も黙る）', () => {
    expect(validateRecursion(makeState(`
  $recursion: { ["nodes.*"]: "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  sum() { return this.$getAll("nodes.**.value", []); }`))).toEqual([]);
    expect(validateRecursion(makeState(`
  $recursion: { ...REC },
  nodes: [],
  sum() { return this.$getAll("nodes.**.value", []); }`))).toEqual([]);
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*", ...more },
  nodes: []`))).toEqual([]);
  });

  it('本当に空の `{}` と、静的に読める 1 件は従来どおり', () => {
    expect(codes(validateRecursion(makeState(`
  $recursion: {},
  nodes: []`)))).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: []`))).toEqual([]);
  });
});

describe('マウントされたコンポーネント（bind-component）の $recursion と `**` getter', () => {
  // Fixed by cycle-3 review — runtime は `wcs/mount-dollar-declaration` で warn して捨てる。静的側は沈黙していた。
  const component = `<wcs-state bind-component="state"><script type="module">
export default {
  $recursion: { "node.*": "children.*" },
  get "node.**.total"() { return 0; },
  get "node.**.total"() { return 1; },
};
</script></wcs-state>`;

  it('宣言と `**` getter を recursion-declaration-invalid（warning）で報告する', () => {
    const diags = validateRecursion(component, 'wcs-state', 'en');
    expect(codes(diags)).toEqual([WcsDiagnosticCode.RecursionDeclarationInvalid, WcsDiagnosticCode.RecursionDeclarationInvalid]);
    expect(diags.every(d => d.severity === 'warning')).toBe(true);
    expect(component.slice(diags[0].start, diags[0].end)).toBe('$recursion');
    expect(component.slice(diags[1].start, diags[1].end)).toBe('node.**.total');
    expect(diags[0].message).toContain('wcs/mount-dollar-declaration');
  });

  it('`**` を含まないコンポーネント state は従来どおり素通り', () => {
    expect(validateRecursion(`<wcs-state bind-component="state"><script type="module">
export default { node: {}, get label() { return this.node.value; } };
</script></wcs-state>`)).toEqual([]);
  });

  it('宣言に依存しない検査（`**` の代入・$resolve / $postUpdate・$listKeys キー）はマウント／ボリュームのブロックでも走る', () => {
    // Fixed by cycle-3 re-verification — warning の後に `continue` していたので、runtime が宣言の
    // 有無に関わらず throw する形まで沈黙していた。宣言に依存する `$getAll` / `$setAll` の形は
    // spec が組めないので黙る（ルートに置いたときだけ報告される）。
    const body = `
export default {
  $listKeys: { "node.**.children": "id" },
  get "node.**.total"() { return 0; },
  poke() {
    this["node.**.x"] = 1;
    this.$resolve("node.**.value", [0]);
    this.$postUpdate("node.**.value");
    return this.$getAll("node.**.value", [1]);
  },
};`;
    const mountedDiags = validateRecursion(`<wcs-state bind-component="state"><script type="module">${body}</script></wcs-state>`);
    expect(codes(mountedDiags)).toEqual([
      WcsDiagnosticCode.RecursionDeclarationInvalid,   // `**` getter（warning）
      WcsDiagnosticCode.RecursionUnsupported,          // $listKeys キー
      WcsDiagnosticCode.RecursionUnsupported,          // $resolve
      WcsDiagnosticCode.RecursionUnsupported,          // $postUpdate
      WcsDiagnosticCode.RecursionUnsupported,          // 代入
    ]);
    expect(mountedDiags.map(d => d.severity)).toEqual(['warning', 'error', 'error', 'error', 'error']);
    expect(mountedDiags.some(d => d.code === WcsDiagnosticCode.RecursionGetAllForm)).toBe(false);

    const volumeDiags = validateRecursion(`<wcs-state mount="tree"><script type="module">${body}</script></wcs-state>`);
    expect(codes(volumeDiags)).toEqual([
      WcsDiagnosticCode.RecursionDeclarationInvalid,
      WcsDiagnosticCode.RecursionUnsupported,
      WcsDiagnosticCode.RecursionUnsupported,
      WcsDiagnosticCode.RecursionUnsupported,
      WcsDiagnosticCode.RecursionUnsupported,
    ]);
    expect(volumeDiags[0].severity).toBe('error');
  });
});

describe('増減演算子（++ / --）での `**` 代入と再帰 getter への書き込み', () => {
  // Fixed by cycle-3 review — 代入走査が `=` 系だけを拾っていた。semanticValidator と同じ部品（scriptPatterns）を共有する。
  const only = (body: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  probe() { ${body} }`), 'wcs-state', 'en');

  it('後置・前置の ++ / -- を代入として拾う', () => {
    const diags = only(`
    this["nodes.**.count"]++;
    ++this["nodes.**.count"];
    this["nodes.*.total"]--;
    --this["nodes.0.children.0.total"];`);
    expect(codes(diags)).toEqual([
      WcsDiagnosticCode.RecursionUnsupported, WcsDiagnosticCode.RecursionUnsupported,
      WcsDiagnosticCode.RecursionReadonly, WcsDiagnosticCode.RecursionReadonly,
    ]);
    // 範囲は引用符の中身（前置でも）
    const html = makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  poke() { ++this["nodes.**.count"]; }`);
    const one = validateRecursion(html);
    expect(html.slice(one[0].start, one[0].end)).toBe('nodes.**.count');
  });

  it('葉の増減・比較は黙る', () => {
    expect(only('this["nodes.*.value"]++; --this["nodes.1.value"]; return this["nodes.*.value"] >= 1;')).toEqual([]);
  });
});

// ============================================================
// 第 4 サイクル
// ============================================================

describe('反復語ぶんずれた展開形の値の内側への再帰 $setAll', () => {
  // Fixed by cycle-4 review — `conflictingGetterSuffix` が `sameFamily`（全体）と `startsWith` しか見ず、
  // `nodes.**.children.*.total.x` に沈黙していた（runtime は走査後の第 2 相で初めて落ちていた）
  const only = (body: string) => validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
  probe() { ${body} }`), 'wcs-state', 'en');

  it('`.` 境界の各接頭辞で族を照合し recursion-readonly にする', () => {
    expect(codes(only('this.$setAll("nodes.**.children.*.total.x", [], 1);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
    expect(codes(only('this.$setAll("nodes.**.children.*.children.*.total.x.y", [], 1);')))
      .toEqual([WcsDiagnosticCode.RecursionReadonly]);
    // 葉は通る
    expect(only('this.$setAll("nodes.**.children.*.totals.x", [], 1);')).toEqual([]);
  });

  it('coversSuffix は族そのもの・値の内側・反復語ぶんのずれを認め、別名は認めない', () => {
    const spec = makeRecursionSpec('nodes.*', 'children.*');
    expect(coversSuffix(spec, '.total', '.total')).toBe(true);
    expect(coversSuffix(spec, '.total', '.total.x')).toBe(true);
    expect(coversSuffix(spec, '.total', '.children.*.total')).toBe(true);
    expect(coversSuffix(spec, '.total', '.children.*.total.x')).toBe(true);
    expect(coversSuffix(spec, '.total', '.totals')).toBe(false);
    expect(coversSuffix(spec, '.total', '.children.*.value')).toBe(false);
  });
});

describe('接尾辞が整形されていない `**` パス（空セグメント・`**` 直後の `*`）', () => {
  // Fixed by cycle-4 review — runtime と同じく `splitRecursivePath` で拒否する（recursion-anchor）
  it('getter キーも API のパスも recursion-anchor', () => {
    for (const path of ['nodes.**.', 'nodes.**..x', 'nodes.**.*', 'nodes.**.*.x']) {
      const getter = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "${path}"() { return 0; }`), 'wcs-state', 'en');
      expect(codes(getter), path).toEqual([WcsDiagnosticCode.RecursionAnchor]);
      expect(getter[0].message, path).toContain('well-formed suffix');
      const call = validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  probe() { return this.$getAll("${path}", []); }`));
      expect(codes(call), path).toEqual([WcsDiagnosticCode.RecursionAnchor]);
    }
    // 対照: 接尾辞の途中・末尾の `*`（`nodes.**.tags.*`）は正当
    expect(validateRecursion(makeState(`
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.tags.*.up"() { return 0; },
  probe() { return this.$getAll("nodes.**.tags.*", []); }`))).toEqual([]);
    expect(splitRecursivePath(makeRecursionSpec('nodes.*', 'children.*'), 'nodes.**.a..b')).toBeNull();
    expect(foldSuffixIndexes('.children.0.total')).toBe('.children.*.total');
    expect(foldSuffixIndexes('')).toBe('');
  });
});
