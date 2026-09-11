/**
 * recursion.declaration.test.ts — `$recursion` 宣言のバリデーション単体テスト
 * （docs/state-recursive-path-impl-plan.md §1-1 / Phase B）。
 *
 * 初版が受け付けるのは「単一の自己再帰」だけで、アンカーも反復サブパスも
 * 「固定プロパティ列 + 末尾の `.*` ひとつ」に限る。ここで固定するのは
 *  1. 宣言が無ければ null（＝再帰の経路にまったく入らないゼロコスト規約）
 *  2. 受理形が `{ anchor, repeat, recursiveAnchor }` になること
 *  3. 拒否形が **原因を名指しした** 診断で落ちること
 * の三つ。3 を 1 件ずつ確かめるのは、まとめて「throw する」とだけ見ると
 * 別の理由で落ちていても気づけないため。
 *
 * 検証するのは**綴りの形だけ**である。反復サブパスがアンカーと同じ語で始まっても
 * （`{ "nodes.*": "nodes.*" }`）拒否しない — それは `{ nodes: [{ nodes: [...] }] }`
 * という自己相似な木の最も自然な綴りであって、相対か絶対かは名前の形では
 * 判定できないため（Phase B の反証レビューで「絶対パスの取り違え」ガードを撤去）。
 */
import { describe, it, expect } from "vitest";
import { processRecursionDeclaration } from "../src/recursion/declaration";
import type { IState } from "../src/types";

/** `$recursion` だけを持つ最小の state */
const decl = (value: unknown): IState => ({ $recursion: value } as unknown as IState);

describe("processRecursionDeclaration: 宣言が無い state", () => {
  it("$recursion が無ければ null を返すこと（ゼロコスト経路）", () => {
    expect(processRecursionDeclaration({} as IState)).toBe(null);
  });

  it("$recursion に undefined を明示しても null を返すこと", () => {
    expect(processRecursionDeclaration(decl(undefined))).toBe(null);
  });
});

describe("processRecursionDeclaration: 受理する形", () => {
  it('{ "nodes.*": "children.*" } を仕様に落とし、recursiveAnchor が "nodes.**" になること', () => {
    const spec = processRecursionDeclaration(decl({ "nodes.*": "children.*" }))!;
    expect(spec).not.toBe(null);
    expect(spec.anchor).toBe("nodes.*");
    expect(spec.repeat).toBe("children.*");
    expect(spec.recursiveAnchor).toBe("nodes.**");
  });

  it("ネストしたアンカーでも recursiveAnchor は末尾の * だけを ** に置き換えること", () => {
    const spec = processRecursionDeclaration(decl({ "data.tree.*": "branch.children.*" }))!;
    expect(spec.anchor).toBe("data.tree.*");
    expect(spec.repeat).toBe("branch.children.*");
    expect(spec.recursiveAnchor).toBe("data.tree.**");
  });

  it("反復サブパスがネストしていても受理すること", () => {
    const spec = processRecursionDeclaration(decl({ "nodes.*": "meta.children.*" }))!;
    expect(spec.repeat).toBe("meta.children.*");
    expect(spec.recursiveAnchor).toBe("nodes.**");
  });

  it("返す仕様は凍結されていること（レジストリが state の世代を跨いで保持する）", () => {
    const spec = processRecursionDeclaration(decl({ "nodes.*": "children.*" }))!;
    expect(Object.isFrozen(spec)).toBe(true);
  });

  it("反復サブパスがアンカーと同じ語で始まっても受理すること（自己相似な木）", () => {
    // Fixed by Phase B review — was: `{ "nodes.*": "nodes.*" }` を「絶対パスの
    // 取り違え」として拒否していた。これは `{ nodes: [{ nodes: [...] }] }` という
    // 自己相似な木の最も自然な綴りで、深さ 1 は `nodes.*.nodes.*` に展開される。
    // 反復サブパスが相対か絶対かは、名前の形では判定できない。
    const spec = processRecursionDeclaration(decl({ "nodes.*": "nodes.*" }))!;
    expect(spec.anchor).toBe("nodes.*");
    expect(spec.repeat).toBe("nodes.*");
    expect(spec.recursiveAnchor).toBe("nodes.**");
  });

  it("アンカーと綴りが近いだけの反復サブパスも受理すること", () => {
    // `nodesX` は `"nodes.*".startsWith` では引っかかるが、別のプロパティである。
    // 接頭辞比較で弾く実装が復活すると、正当な宣言が拒否される。
    const spec = processRecursionDeclaration(decl({ "nodes.*": "nodesX.*" }))!;
    expect(spec.repeat).toBe("nodesX.*");
    expect(spec.recursiveAnchor).toBe("nodes.**");
  });

  it("ネストしたアンカーでも、アンカーの先頭セグメントで始まる反復サブパスを受理すること", () => {
    // Fixed by Phase B review — was: アンカー `data.tree.*` の先頭セグメント
    // `data` で始まる `data.children.*` を「絶対パスの取り違え」として拒否していた。
    expect(processRecursionDeclaration(decl({ "data.tree.*": "data.children.*" }))!.repeat)
      .toBe("data.children.*");
    expect(processRecursionDeclaration(decl({ "data.tree.*": "tree.children.*" }))!.repeat)
      .toBe("tree.children.*");
  });
});

describe("processRecursionDeclaration: 宣言そのものの形を拒否する", () => {
  it("オブジェクトでない宣言を、期待する形を示して拒否すること", () => {
    expect(() => processRecursionDeclaration(decl("nodes.*")))
      .toThrow(/\$recursion must be an object mapping one anchor path to its repeating sub-path/);
    expect(() => processRecursionDeclaration(decl(null)))
      .toThrow(/\$recursion must be an object mapping one anchor path to its repeating sub-path/);
    expect(() => processRecursionDeclaration(decl(42)))
      .toThrow(/\$recursion must be an object mapping one anchor path to its repeating sub-path/);
  });

  it("関数の宣言も「オブジェクトであれ」の入口で拒否すること", () => {
    // typeof は "function" で "object" ではない。ここを通すと Object.entries が
    // 空を返し、「アンカーが空」という別の理由の診断にすり替わる。
    expect(() => processRecursionDeclaration(decl(() => ({ "nodes.*": "children.*" }))))
      .toThrow(/\$recursion must be an object mapping one anchor path to its repeating sub-path/);
  });

  it("配列の宣言が typeof \"object\" のゲートを素通りせず、添字がアンカー形として拒否されること", () => {
    // 配列は typeof "object" なので入口は通る。最後に効くのはアンカーの形の検査で、
    // 添字キー "0" が「リストの要素を名指ししていない」として落ちる。
    expect(() => processRecursionDeclaration(decl(["children.*"])))
      .toThrow(/\$recursion anchor "0" must name a list element/);
  });

  it("空の宣言を「アンカーがちょうど 1 つ要る」と名指しして拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({})))
      .toThrow(/must declare exactly one anchor; it is empty/);
  });

  it("複数アンカーを、宣言されたアンカー名を挙げて拒否すること", () => {
    const two = { "nodes.*": "children.*", "rows.*": "kids.*" };
    expect(() => processRecursionDeclaration(decl(two)))
      .toThrow(/declares 2 anchors \("nodes\.\*", "rows\.\*"\)/);
    expect(() => processRecursionDeclaration(decl(two)))
      .toThrow(/supports exactly one self-recursive anchor per state/);
  });
});

describe("processRecursionDeclaration: アンカーの形を拒否する", () => {
  it("空文字のアンカーを非空文字列の要求として拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "": "children.*" })))
      .toThrow(/\$recursion anchor must be a non-empty string/);
  });

  it("単一セグメント（.* を持たない）のアンカーを「リストの要素を名指しせよ」と拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ nodes: "children.*" })))
      .toThrow(/\$recursion anchor "nodes" must name a list element/);
  });

  it("末尾が * でないアンカーを「リスト自体ではなく要素を指す」と拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.value": "children.*" })))
      .toThrow(/\$recursion anchor "nodes\.value" must end with "\.\*"/);
    expect(() => processRecursionDeclaration(decl({ "nodes.value": "children.*" })))
      .toThrow(/it names the element of the list, not the list itself/);
  });

  it("空セグメントを含むアンカーを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes..items.*": "children.*" })))
      .toThrow(/must not contain empty path segments/);
  });

  it("途中にワイルドカードを持つアンカーを「* は末尾にちょうど 1 つ」と拒否すること", () => {
    const mid = { "nodes.*.children.*": "children.*" };
    expect(() => processRecursionDeclaration(decl(mid)))
      .toThrow(/\$recursion anchor "nodes\.\*\.children\.\*" must have exactly one "\*", at the end/);
    expect(() => processRecursionDeclaration(decl(mid)))
      .toThrow(/Wildcards in the middle are not supported in this version/);
  });

  it("`$` 名前空間のアンカーを予約として拒否すること（反復サブパスも同じ）", () => {
    // `$command` / `$1` 等は raw state に実体を持たないので、木のノードにはなり得ない
    // （checkDeclaredPath が同じ 2 つで早期 return しているのと対称）。
    expect(() => processRecursionDeclaration(decl({ "$streams.*": "children.*" })))
      .toThrow(/\$recursion anchor "\$streams\.\*" must not start with "\$" — that namespace is reserved/);
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "$streams.*" })))
      .toThrow(/\$recursion repeating sub-path "\$streams\.\*" must not start with "\$"/);
  });

  it("マウントの予約セグメント（`#`）を含む宣言を拒否すること（アンカー・反復サブパスとも）", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.#m1.*": "children.*" })))
      .toThrow(/\$recursion anchor "nodes\.#m1\.\*" must not contain "#" — that segment is reserved for mounts/);
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.#m1.*" })))
      .toThrow(/\$recursion repeating sub-path "children\.#m1\.\*" must not contain "#"/);
  });

  it("途中に添字セグメントを持つアンカーを「木の形の宣言であって 1 行の宣言ではない」と拒否すること", () => {
    // Fixed by 第 5 サイクル — was: 両側とも受理していた。エンジンは具体パスの添字を
    // `*` に畳む（`indexSegmentsToWildcard`）ので、宣言の途中の添字は意味を持たない
    // 奇形のまま残り、`nodes.0.*` と `nodes.*.*` が同じものとして動く。
    expect(() => processRecursionDeclaration(decl({ "nodes.0.items.*": "children.*" })))
      .toThrow(/\$recursion anchor "nodes\.0\.items\.\*" must not contain an index segment \("0"\)/);
    expect(() => processRecursionDeclaration(decl({ "nodes.0.items.*": "children.*" })))
      .toThrow(/the recursion is declared over the shape of the tree, not over one row/);
  });

  it("** を含むアンカーを「宣言こそが ** に意味を与える」と拒否すること", () => {
    const rec = { "nodes.**.children.*": "children.*" };
    expect(() => processRecursionDeclaration(decl(rec)))
      .toThrow(/\$recursion anchor "nodes\.\*\*\.children\.\*" must not contain "\*\*"/);
    expect(() => processRecursionDeclaration(decl(rec)))
      .toThrow(/the declaration is what gives "\*\*" its meaning/);
  });
});

describe("processRecursionDeclaration: 反復サブパスの形を拒否する", () => {
  it("文字列でない反復サブパスを、アンカー名を挙げて拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": 1 })))
      .toThrow(/\$recursion entry "nodes\.\*" must map to the repeating sub-path as a string/);
    expect(() => processRecursionDeclaration(decl({ "nodes.*": null })))
      .toThrow(/\$recursion entry "nodes\.\*" must map to the repeating sub-path as a string/);
    expect(() => processRecursionDeclaration(decl({ "nodes.*": ["children.*"] })))
      .toThrow(/\$recursion entry "nodes\.\*" must map to the repeating sub-path as a string/);
  });

  it("空文字の反復サブパスを非空文字列の要求として拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "" })))
      .toThrow(/\$recursion repeating sub-path must be a non-empty string/);
  });

  it("単一セグメントの反復サブパスを「リストの要素を名指しせよ」と拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children" })))
      .toThrow(/\$recursion repeating sub-path "children" must name a list element/);
  });

  it("末尾が * でない反復サブパスを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.first" })))
      .toThrow(/\$recursion repeating sub-path "children\.first" must end with "\.\*"/);
  });

  it("空セグメントを含む反復サブパスを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children..*" })))
      .toThrow(/\$recursion repeating sub-path "children\.\.\*" must not contain empty path segments/);
  });

  it("途中にワイルドカードを持つ反復サブパスを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.*.kids.*" })))
      .toThrow(/\$recursion repeating sub-path "children\.\*\.kids\.\*" must have exactly one "\*", at the end/);
  });

  it("** を含む反復サブパスを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.**.*" })))
      .toThrow(/\$recursion repeating sub-path "children\.\*\*\.\*" must not contain "\*\*"/);
  });

  it("途中に添字セグメントを持つ反復サブパスを拒否すること", () => {
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.0.*" })))
      .toThrow(/\$recursion repeating sub-path "children\.0\.\*" must not contain an index segment \("0"\)/);
  });

  it("添字に見えるだけの綴り（先頭 0 付き・負数・小数）も添字として拒否すること", () => {
    // 畳みの述語（`!isNaN(Number(segment))`）と同じ範囲で落とす — 片方だけが
    // 添字とみなす綴りがあると、宣言は通るのに展開形が別物になる。
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.01.*" })))
      .toThrow(/must not contain an index segment \("01"\)/);
    expect(() => processRecursionDeclaration(decl({ "nodes.*": "children.-1.*" })))
      .toThrow(/must not contain an index segment \("-1"\)/);
  });
});

describe("processRecursionDeclaration: リスト側の綴りを仕様に載せる", () => {
  it("anchorList / repeatList が末尾の .* を落とした形になること", () => {
    const spec = processRecursionDeclaration(decl({ "nodes.*": "children.*" }))!;
    expect(spec.anchorList).toBe("nodes");
    expect(spec.repeatList).toBe("children");
  });

  it("ネストした宣言でもリスト側が最後のセグメントだけを落とすこと", () => {
    const spec = processRecursionDeclaration(decl({ "data.tree.*": "branch.children.*" }))!;
    expect(spec.anchorList).toBe("data.tree");
    expect(spec.repeatList).toBe("branch.children");
  });
});
