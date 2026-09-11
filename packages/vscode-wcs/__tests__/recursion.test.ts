import { describe, it, expect } from 'vitest';
import { validateRecursion } from '../src/service/recursionValidator';
import { validateBindings } from '../src/service/bindingValidator';
import { validateTemplateSyntax } from '../src/service/templateSyntaxValidator';
import { validateWatchDeclarations } from '../src/service/watchDeclarationValidator';
import { validateSemantics } from '../src/service/semanticValidator';
import { validateDocument } from '../src/core/validateDocument';
import { analyzeRecursionDeclaration, analyzeStatePaths } from '../src/service/stateAnalyzer';
import {
  checkNodePath,
  collectRecursionSpecs,
  foldRecursion,
  makeRecursionSpec,
  matchesRecursion,
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

  it('値が文字列リテラルでなければ断定しない…が、形が決まらないので宣言は成立しない', () => {
    const diags = only(`
  $recursion: { "nodes.*": REPEAT },
  nodes: []`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.RecursionDeclarationInvalid);
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
