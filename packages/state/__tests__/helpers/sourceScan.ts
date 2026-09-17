/**
 * helpers/sourceScan.ts
 *
 * `src/` のソースを文字列として走査する番人テストの共通部品
 * （docs/state-address-unification-impl-plan.md §4-1。前例は tagNameMap.test.ts）。
 *
 * TypeScript の AST は使わない。番人が捕まえるのは「典型的な綴り」であって、
 * 型引数を別名で書いた宣言や、値を包んでキーにする台帳までは追わない
 * （docs/state-address-unification-design.md §6-4 の「塞げないもの」）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const SRC_ROOT = resolve(__dirname, "..", "..", "src");

/** `root` 以下の `.ts` を再帰的に列挙する（`root` からの相対パス・区切りは `/`）。 */
export function listSourceFiles(root: string = SRC_ROOT): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return files.sort();
}

export function readSourceFile(file: string, root: string = SRC_ROOT): string {
  return readFileSync(join(root, file), "utf8");
}

export interface IModuleLevelDeclaration {
  /** 宣言した識別子 */
  readonly name: string;
  /** 宣言の開始行（1 始まり） */
  readonly line: number;
  /** トップレベルの `=` より前（`const name: Type` の部分）。`=` が無ければ宣言全体 */
  readonly head: string;
  /** トップレベルの `=` より後（初期化子）。`=` が無ければ空文字 */
  readonly init: string;
}

const DECLARATION_START = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;

/**
 * **モジュール直下**の `const` / `let` / `var` 宣言を集める。行頭（インデント無し）で始まる
 * 宣言だけがモジュール直下 — 関数内の局所変数やクラスのフィールドはインデントされている。
 *
 * 宣言は複数行にまたがりうる（型注釈を `<` の後で折り返す綴り）。括弧の深さが 0 に戻り、
 * 行が `;` で終わったところまでを 1 つの宣言とする。暴走の歯止めとして、次の行が
 * 行頭から始まる新しい文なら、そこで打ち切る。
 */
export function collectModuleLevelDeclarations(source: string): IModuleLevelDeclaration[] {
  const lines = source.split(/\r?\n/);
  const declarations: IModuleLevelDeclaration[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = DECLARATION_START.exec(lines[i]);
    if (start === null) {
      continue;
    }
    let text = "";
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (j > i && /^[^\s)\]}>]/.test(line)) {
        // 行頭から始まる新しい文。前の宣言は `;` 無しで終わっていた
        j--;
        break;
      }
      text += (j > i ? "\n" : "") + line;
      for (const ch of line) {
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
      }
      if (depth <= 0 && line.trimEnd().endsWith(";")) {
        break;
      }
    }
    const split = indexOfTopLevelAssignment(text);
    declarations.push({
      name: start[1],
      line: i + 1,
      head: split === -1 ? text : text.slice(0, split),
      init: split === -1 ? "" : text.slice(split + 1),
    });
    i = Math.max(i, j);
  }
  return declarations;
}

/**
 * 宣言の中で、型注釈と初期化子を分ける `=` の位置。`=>`・`==`・`<=`・`>=`・`!=` は飛ばし、
 * 括弧と型引数の内側（`Map<K, (a: A) => void>` の `=>` など）も飛ばす。
 */
function indexOfTopLevelAssignment(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "=" && text[i + 1] === ">") {
      i++; // `=>` の `>` を型引数の閉じと数えない
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
      depth--;
    } else if (ch === "=" && depth === 0) {
      const prev = text[i - 1];
      if (text[i + 1] === "=" || prev === "=" || prev === "!" || prev === "<" || prev === ">") {
        continue;
      }
      return i;
    }
  }
  return -1;
}

const COLLECTION = "(?:WeakMap|Map|WeakSet|Set|ReadonlyMap|ReadonlySet)";

/**
 * 宣言が、`keyTypes` のいずれかを**キー**（第 1 型引数）にするコレクションを持つか。
 * 見るのは型注釈（`head`）と、初期化子が `new Map<…>()` の形のときのコンストラクタの型引数。
 * 初期化子がそれ以外（関数式・オブジェクトリテラル）なら中は見ない — そこに現れる
 * コレクションは呼び出しごとの局所値で、モジュール寿命の台帳ではない。
 * 入れ子（`Map<string, WeakMap<IStateAddress, …>>`）も捕まえる。
 */
export function declaresCollectionKeyedBy(declaration: IModuleLevelDeclaration, keyTypes: readonly string[]): boolean {
  const keyed = new RegExp(`\\b${COLLECTION}\\s*<\\s*(?:${keyTypes.join("|")})\\b`);
  if (keyed.test(declaration.head)) {
    return true;
  }
  const constructed = new RegExp(`^\\s*new\\s+${COLLECTION}\\s*<`).exec(declaration.init);
  if (constructed === null) {
    return false;
  }
  return keyed.test(declaration.init.slice(0, endOfTypeArguments(declaration.init, constructed[0].length - 1) + 1));
}

/** `text[open]` の `<` に対応する `>` の位置（見つからなければ末尾）。 */
function endOfTypeArguments(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "=" && text[i + 1] === ">") {
      i++;
      continue;
    }
    if (text[i] === "<") depth++;
    else if (text[i] === ">" && --depth === 0) return i;
  }
  return text.length - 1;
}

/**
 * ソースが import しているモジュールを、`src/` からの相対パス（拡張子なし・区切りは `/`）で返す。
 * 静的 import・`export … from`・動的 `import()` の指定子を拾い、相対指定だけを `file` の位置から解決する
 * （bare specifier は対象外）。
 */
export function collectImportedModules(file: string, source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const resolved: string[] = [];
  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) {
      continue;
    }
    const segments = dir === "" ? [] : dir.split("/");
    for (const part of specifier.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
    }
    resolved.push(segments.join("/").replace(/\.ts$/, ""));
  }
  return resolved.sort();
}
