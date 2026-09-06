/**
 * fileReader.ts — `<wcs-state src=...>` の外部 state を読む reader（node shell 層）。
 *
 * CLI（cli.ts）と Language Server（service/wcsCompletionPlugin.ts）の**両方**が
 * ここを使う。IDE と CI で同じ validator core を呼んでも、外部 state を読む側が
 * 片方にしか無ければ診断は一致しない —— `wcs-validate` は
 * `wcs/binding-path-missing` を出すのに IDE は候補ゼロで沈黙する、という
 * 「CI で初めて落ちる」ずれになる（ADR-09 §7.1 の IDE / CLI パリティ）。
 * 以前は CLI 側にしか無かったので、その穴をここで塞ぐ。
 *
 * ファイル I/O を持つので core（pure library）には置かない。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileReader } from "./service/statePathResolver.js";

/**
 * `<wcs-state src=...>` の外部 state を HTML ファイルのディレクトリ基準で読む reader。
 * 読めないパス(不存在 / 権限)は undefined = 従来どおりスキップ(検証は
 * 「候補ゼロなら沈黙」の保守側に倒れる)。static-wiring-dx-design.md §6-2。
 *
 * 読まないもの(undefined 固定):
 * - スキーム付き URL(`https://...` 等)と protocol-relative(`//host/...`) —
 *   ネットワーク参照であり、Windows では `//h/s` が resolve で UNC パスに化けて
 *   readFileSync が SMB 接続(NTLM 送出・タイムアウト待ち)を起こす。静的検証
 *   ツールはネットワークに出ない。
 * - 先頭 `/` の絶対パス — ランタイムでは Web ルート基準であり、ファイルシステムの
 *   ルートに写像すると無関係なファイルを読みうる。Web ルートは設定なしに決められない。
 */
export function createFileReader(htmlPath: string, read: (path: string) => string = (p) => readFileSync(p, "utf8")): FileReader {
  const base = dirname(htmlPath);
  // 同一ファイルは validator 3 つ + .ts プローブで最大 6 回要求される。メモ化で
  // I/O を 1 回に抑え、validator 間で読む内容が変わる TOCTOU も同時に消す。
  const cache = new Map<string, string | undefined>();
  return (relativePath: string) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath) || relativePath.startsWith("/")) {
      return undefined;
    }
    if (cache.has(relativePath)) {
      return cache.get(relativePath);
    }
    let content: string | undefined;
    try {
      content = read(resolve(base, relativePath));
      // PowerShell の Out-File 等が書く UTF-8 BOM は JSON.parse を黙って壊すので剥がす。
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }
    } catch {
      content = undefined;
    }
    cache.set(relativePath, content);
    return content;
  };
}

/**
 * LSP の document URI から reader を作る。**`file:` スキーム以外は undefined**。
 *
 * 未保存の `untitled:`、リモート / 仮想ファイルシステム（`vscode-vfs:` 等）には
 * 対応するローカルパスが無い。そこで無理に読むと無関係なファイルを掴むので、
 * 従来どおり「外部 state は読まない ＝ 候補ゼロで沈黙」に縮退させる。
 *
 * 読むのはディスク上の内容なので、外部 state ファイルを**編集中で未保存**のときは
 * 一時的に古い内容で検証する（CLI と同じ真実源を見るための意図的な選択）。
 */
export function createFileReaderForUri(
  uri: string,
  read?: (path: string) => string,
): FileReader | undefined {
  if (!uri.startsWith("file:")) {
    return undefined;
  }
  let htmlPath: string;
  try {
    htmlPath = fileURLToPath(uri);
  } catch {
    return undefined;
  }
  return createFileReader(htmlPath, read);
}
