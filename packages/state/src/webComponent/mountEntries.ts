/**
 * webComponent/mountEntries.ts — マウントのエントリ表（内側接頭辞 → 外側パス）と、その一致。
 *
 * コンポーネントのマウント記録（mount.ts）とボリュームの注入口（volumeShared.ts、要件 B14③）が
 * 同じ表と同じ一致規則を使う。書き込み翻訳の単一点（要件 §3.4）はこの 2 つの関数に集まる —
 * 読み取り専用（`#ro`）の判定もエントリが持つ。
 */
import { IPathInfo } from "../address/types";
import { DELIMITER } from "../define";

export interface IMountEntry {
  /** 内側接頭辞のセグメント（ルートエントリは 0 個 — あらゆる内側パスに一致する） */
  readonly innerSegments: readonly string[];
  readonly outerPathInfo: IPathInfo;
  /**
   * `#ro` が付いたか（`state#ro: user` / `state.name#ro: user.name`、要件 B14 ①）。
   * 真なら、内側からこのエントリを通るツリーへの書き込みは拒否される（外側自身の書き込みは止めない）。
   */
  readonly readonly: boolean;
}

function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > segments.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
}

/** 最長接頭辞のエントリ（entries は内側接頭辞の長い順に並べておくこと）。一致しなければ null。 */
export function findMountEntry(entries: readonly IMountEntry[], segments: readonly string[]): IMountEntry | null {
  for (const entry of entries) {
    if (startsWithSegments(segments, entry.innerSegments)) {
      return entry;
    }
  }
  return null;
}

/** 一致したエントリで内側パスを外側の絶対パスへ書き換える（`segments` は entry に一致していること）。 */
export function translateByMountEntry(entry: IMountEntry, segments: readonly string[]): string {
  const rest = segments.slice(entry.innerSegments.length);
  return rest.length === 0
    ? entry.outerPathInfo.path
    : entry.outerPathInfo.path + DELIMITER + rest.join(DELIMITER);
}
