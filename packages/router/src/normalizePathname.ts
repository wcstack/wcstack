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

// URL のパーサがパスの中でそのまま残す文字だけで、"." / ".." のセグメントも無い: もう location.pathname の形に
// なっているので、パーサを通さない（リンクが千個ある一覧は、ナビゲーションのたびにリンクごとに 2 つのパスを正規化する）
const PLAIN_PATH = /^(?!.*\/\.{1,2}(?:\/|$))[\w\-.~!$&'()*+,;=:@/%[\]|^]*$/;

/**
 * パスを、ブラウザが `location.pathname` に書く形にする: URL のパスに置けない文字はパーセントエンコードし
 * （`/café` → `/caf%C3%A9`、空白 → `%20`）、すでにあるエスケープはそのまま残す。
 *
 * アプリが渡すパス — `navigate("/café")`、`<wcs-link to="/users/€">`、`basename` 属性 — は書かれたままの文字列で、
 * URL から来るパスはエンコード済み。比べる所はどこもこの 1 つの形で比べる: 書かれたままの形で比べていたので、
 * `to="/users/€"` のリンクはそのページでも現在のページにならず、Navigation API の無い経路の `path` は読み込みの
 * ときと違う文字列になった（#694）。
 *
 * 渡すのは pathname だけ（クエリとフラグメントは呼び出し側が先に分ける）。先頭は "/" 1 つで、連続スラッシュは無い
 * こと。`?` と `#` はパスの文字として扱う。バックスラッシュのあるパスは、パーサがそれをスラッシュに読み替えるので
 * 触らない。
 */
export function encodePathname(path: string): string {
  if (PLAIN_PATH.test(path) || path.includes("\\")) return path;
  return new URL(path.replace(/\?/g, "%3F").replace(/#/g, "%23"), "http://localhost").pathname;
}

/**
 * URL のパスの 1 セグメントを、それが表す文字列にする（`caf%C3%A9` → `café`、`a%2Fb` → `a/b`）。
 * UTF-8 として正しくないエスケープ（`%E0%A4%A`）のあるセグメントは、そのまま返す。
 */
export function decodeSegment(segment: string): string {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * URL pathname を route path に正規化する。
 * - 先頭スラッシュを保証
 * - 連続スラッシュを単一化
 * - `location.pathname` の形にパーセントエンコード（encodePathname）
 * - 末尾のファイル拡張子（例: .html）をディレクトリルートとして扱う
 * - ルート以外の末尾スラッシュを除去
 */
export function normalizePathname(path: string): string {
  let p = path || "/";
  if (!p.startsWith("/")) p = "/" + p;
  p = encodePathname(p.replace(/\/{2,}/g, "/"));
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
  // （`basename` 属性に書かれた ASCII でない文字も、URL のパスと同じ形で比べる）
  p = encodePathname(p.replace(/\/{2,}/g, "/"));
  const extPattern = getExtPattern();
  if (extPattern) {
    p = p.replace(extPattern, "");
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "/") return "";
  return p;
}
