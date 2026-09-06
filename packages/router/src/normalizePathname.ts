import { config } from "./config.js";

// basenameFileExtensions ベースの正規表現をキャッシュ（config 変更時のみ再生成）。
let _cachedExtensions: ReadonlyArray<string> | null = null;
let _cachedExtPattern: RegExp | null = null;

/**
 * config.basenameFileExtensions から拡張子削除用の正規表現を生成（キャッシュ付き）。
 * config 変更が検知された場合のみ再生成する。
 */
export function getExtPattern(): RegExp | null {
  const exts = config.basenameFileExtensions;
  if (exts.length === 0) return null;
  if (_cachedExtensions === exts && _cachedExtPattern) {
    return _cachedExtPattern;
  }
  _cachedExtensions = exts;
  _cachedExtPattern = new RegExp(
    `\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`,
    'i'
  );
  return _cachedExtPattern;
}

/**
 * URL pathname を route path に正規化する。
 * - 先頭スラッシュを保証
 * - 連続スラッシュを単一化
 * - 末尾のファイル拡張子（例: .html）をディレクトリルートとして扱う
 * - ルート以外の末尾スラッシュを除去
 */
export function normalizePathname(path: string): string {
  let p = path || "/";
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  const extPattern = getExtPattern();
  if (extPattern) {
    p = p.replace(extPattern, "");
  }
  if (p === "") p = "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * fullPath から basename を取り除いた route path を返す。
 *
 * applyRoute のマッチング入力と same-match 判定
 * （docs/router-state-contract-design.md §4.4）で共有する。same-match の比較は
 * **basename スライス後の path 同士**で行う規範 — `router.path` に格納されるのは
 * スライス後のパスであり、スライス前の fullPath と比較すると basename 運用で
 * same-match が決して成立しない。
 */
export function sliceBasename(fullPath: string, basename: string): string {
  let sliced = fullPath;
  if (basename !== "") {
    if (fullPath === basename) {
      sliced = "";
    } else if (fullPath.startsWith(basename + "/")) {
      sliced = fullPath.slice(basename.length);
    }
  }
  // when fullPath === basename (e.g. "/app"), treat it as root "/"
  return sliced === "" ? "/" : sliced;
}

/**
 * basename を正規化する。
 * - "" or "/" -> ""
 * - "/app/" -> "/app"
 * - "/app/index.html" -> "/app"
 */
export function normalizeBasename(path: string): string {
  let p = path || "";
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  const extPattern = getExtPattern();
  if (extPattern) {
    p = p.replace(extPattern, "");
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "/") return "";
  return p;
}
