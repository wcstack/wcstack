/**
 * addressLedgerKeyGuard.test.ts — 「ツリー非依存アドレスを台帳のキーにしてはならない」の番人。
 *
 * `IStateAddress`（と、それを継承する `ILoopContext`）はどのツリーのものかを知らない。
 * listIndex が null なら pathInfo だけで intern されるので、これをモジュール寿命の台帳の
 * キーにすると、同じパス形状を持つ 2 つの `<wcs-state>` がエントリを共有して**静かに混線する**
 * （src/list/stateListBaseline.ts の冒頭コメントが証人）。行付きでも、同じ配列インスタンスを
 * 2 ツリーが持てば ListIndex ごと共有されるので同じことが起きる。
 *
 * 型では防げず、台帳を足すたびに人が思い出すしかない前提なので、綴りを機械的に禁じる
 * （docs/state-address-unification-design.md §4-3・§6-4 の案 E、impl-plan §4-1）。
 * 台帳のキーは、ツリーを含む `IAbsoluteStateAddress` にすること。
 *
 * 案 A（アドレス型の統合）が着地すれば、ツリー非依存のアドレス型そのものが無くなるので、
 * この番人は役目を終えて削除される（impl-plan §7-1 の C7）。
 */
import { describe, it, expect } from "vitest";
import {
  collectModuleLevelDeclarations,
  declaresCollectionKeyedBy,
  listSourceFiles,
  readSourceFile,
} from "./helpers/sourceScan";

/** ツリーを知らないアドレス型。これをキーにしたモジュール寿命のコレクションを禁じる */
const TREE_AGNOSTIC_KEY_TYPES = ["IStateAddress", "ILoopContext"] as const;

/**
 * 理由つきの許可リスト。**足すときは、なぜ混線しないのかを書くこと**。
 * 書けないなら、キーを `IAbsoluteStateAddress` に変えるのが正しい直し方。
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly name: string; readonly reason: string }> = [
  {
    file: "list/getListIndexByBindingInfo.ts",
    name: "listIndexByBindingInfoByLoopContext",
    reason:
      "内側のキーが IBindingInfo。binding は DOM ノードに 1 対 1 で結び付き、ノードは 1 つのツリーにしか" +
      "属さない。ループ文脈が 2 ツリーで共有されても、内側のキーがツリーを分ける。",
  },
];

function findViolations(file: string, source: string): string[] {
  return collectModuleLevelDeclarations(source)
    .filter((declaration) => declaresCollectionKeyedBy(declaration, TREE_AGNOSTIC_KEY_TYPES))
    .map((declaration) => `${file}:${declaration.line} ${declaration.name}`);
}

describe("番人: ツリー非依存アドレスをキーにするモジュール寿命の台帳", () => {
  const files = listSourceFiles();

  it("src を実際に走査していること（空振りの番人は無いのと同じ）", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("address/StateAddress.ts");
    expect(files).toContain("list/getListIndexByBindingInfo.ts");
  });

  it("許可リストの外に該当する宣言が無いこと", () => {
    const allowed = new Set(ALLOWED.map((entry) => `${entry.file} ${entry.name}`));
    const violations: string[] = [];
    for (const file of files) {
      for (const violation of findViolations(file, readSourceFile(file))) {
        const [location, name] = violation.split(" ");
        if (!allowed.has(`${location.slice(0, location.lastIndexOf(":"))} ${name}`)) {
          violations.push(violation);
        }
      }
    }
    expect(
      violations,
      "IStateAddress / ILoopContext はツリーを知らないので、モジュール寿命の台帳のキーにすると 2 つの " +
      "<wcs-state> が混線する。キーを IAbsoluteStateAddress にすること" +
      "（docs/state-address-unification-design.md §4-3）",
    ).toEqual([]);
  });

  it("許可リストの各項目が、今も該当する宣言として実在すること（古い許可を残さない）", () => {
    for (const entry of ALLOWED) {
      const found = findViolations(entry.file, readSourceFile(entry.file)).map((violation) => violation.split(" ")[1]);
      expect(found, `${entry.file} の ${entry.name}`).toContain(entry.name);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("番人の走査そのものの試験", () => {
  const scan = (source: string): string[] => findViolations("fixture.ts", source).map((violation) => violation.split(" ")[1]);

  it("1 行の型注釈を検出すること", () => {
    expect(scan(`const ledger: WeakMap<IStateAddress, number> = new WeakMap();`)).toEqual(["ledger"]);
    expect(scan(`const seen: Set<ILoopContext> = new Set();`)).toEqual(["seen"]);
    expect(scan(`export const ledger: Map<IStateAddress, number> = new Map();`)).toEqual(["ledger"]);
    expect(scan(`let ledger: WeakSet<IStateAddress> | null = null;`)).toEqual(["ledger"]);
  });

  it("型注釈が複数行にまたがる綴りを検出すること", () => {
    const source = [
      `const ledger: WeakMap<`,
      `  IStateAddress,`,
      `  readonly unknown[]`,
      `> = new WeakMap();`,
      `const other = 1;`,
    ].join("\n");
    expect(scan(source)).toEqual(["ledger"]);
  });

  it("CRLF のソースでも検出すること", () => {
    expect(scan(`const a = 1;\r\nconst ledger: WeakMap<IStateAddress, number> = new WeakMap();\r\n`)).toEqual(["ledger"]);
  });

  it("型注釈が無く、コンストラクタの型引数だけに現れる綴りを検出すること", () => {
    expect(scan(`const ledger = new Map<ILoopContext, number>();`)).toEqual(["ledger"]);
  });

  it("入れ子のコレクションのキーも検出すること", () => {
    expect(scan(`const ledger: Map<string, WeakMap<IStateAddress, number>> = new Map();`)).toEqual(["ledger"]);
  });

  it("値の位置に現れるだけなら検出しないこと", () => {
    expect(scan(`const byBinding: WeakMap<IBindingInfo, IStateAddress> = new WeakMap();`)).toEqual([]);
    expect(scan(`const byBinding: WeakMap<IBindingInfo, (address: IStateAddress) => void> = new WeakMap();`)).toEqual([]);
  });

  it("ツリーを含む絶対アドレスをキーにした台帳は検出しないこと", () => {
    expect(scan(`const ledger: WeakMap<IAbsoluteStateAddress, number> = new WeakMap();`)).toEqual([]);
    expect(scan(`const pattern: WeakMap<ITreePath, WeakMap<IListIndex, number>> = new WeakMap();`)).toEqual([]);
  });

  it("関数内の局所コレクションは検出しないこと（1 回の walk に閉じる）", () => {
    const source = [
      `function walk(): void {`,
      `  const visited: Set<IStateAddress> = new Set();`,
      `  visited.clear();`,
      `}`,
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("モジュール直下の関数式の本体にある局所コレクションは検出しないこと", () => {
    const source = [
      `export const walk = (count: number): number => {`,
      `  const visited = new Set<IStateAddress>();`,
      `  return visited.size + count;`,
      `};`,
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("クラスのフィールドは対象外であること（インデントされている）", () => {
    const source = [
      `class Handler {`,
      `  private seen: Set<IStateAddress> = new Set();`,
      `}`,
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("`;` の無い宣言の次の行を巻き込まないこと", () => {
    const source = [
      `const count = 1`,
      `const ledger: WeakMap<IStateAddress, number> = new WeakMap();`,
    ].join("\n");
    expect(scan(source)).toEqual(["ledger"]);
  });
});
