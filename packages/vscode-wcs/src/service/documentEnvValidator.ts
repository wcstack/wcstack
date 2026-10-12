/**
 * documentEnvValidator.ts
 *
 * 文書レベルの環境検査 — バインディング式ではなく、ページの読み込み構成そのものが
 * 静かに壊れるパターンを検出する:
 *
 * - ScriptOrder: `@wcstack/devtools/auto` が `@wcstack/state/auto` より後に読まれている
 *   （devtools README: 配線台帳のライブ捕捉のため state より先が必須。
 *   なお I/O ノードと state の順序は module script の遅延実行により無関係 —
 *   公式 examples も state 先行のため、一般の順序規則は検査しない）
 * - BaseHrefMissing: `@wcstack/router/auto` を読むページに `<base href>` がない
 *   （SPA のディープリンクで basename が誤導出される）
 * - RouterOutletMisplaced: `<wcs-router>` の直後に無い `<wcs-outlet>` があり、直後に outlet を
 *   持たない router がある（router は直後の兄弟だけを outlet にし、無ければ自前で作る。置いた
 *   outlet は空のまま — docs/router-outlet-placement.md。ランタイムも同じ code で警告する）
 * - SignalsDualEntry: `@wcstack/signals` と `@wcstack/signals/dom` の実参照が同一ページに
 *   混在（CDN では各エントリがコア同梱の自己完結バンドルのため、リアクティブコアが
 *   二重化して境界で反応が壊れる）。コメント内の言及に誤反応しないよう、
 *   script src と inline module の import 指定子だけを参照として数える。
 *
 * pure(DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';

interface ScriptSrcOccurrence {
  /** 読み込まれるパッケージ名（`@wcstack/<pkg>` の `<pkg>`。一括バンドル `wcstack/auto` は中身の全部）。 */
  pkgs: readonly string[];
  /** 一括バンドル `wcstack/auto` か。router を使わないページもあるので、router の検査は `<wcs-router>` を見る。 */
  bundle: boolean;
  /** src 属性値の開始オフセット。 */
  start: number;
  /** src 属性値の終了オフセット。 */
  end: number;
}

interface SignalsRef {
  /** 参照エントリ: '/dom' か、それ以外（コア直 import）。 */
  kind: 'dom' | 'bare';
  start: number;
  end: number;
}

/**
 * HTML テキストの読み込み構成を検査する。
 */
export function validateDocumentEnv(html: string, locale?: string): WcsDiagnostic[] {
  const diagnostics: WcsDiagnostic[] = [];
  const msgs = getMessages(locale);
  // HTML コメント内の説明文・コメントアウトされたタグに誤反応しないよう、
  // オフセットを保ったままコメントを空白化したテキストを走査する。
  const scanText = blankHtmlComments(html);
  const autos = findWcstackAutoScripts(scanText);

  // --- ScriptOrder: state/auto の後の devtools/auto（実在する唯一の順序依存） ---
  const stateIndex = autos.findIndex(a => a.pkgs.includes('state'));
  if (stateIndex !== -1) {
    for (const later of autos.slice(stateIndex + 1)) {
      if (!later.pkgs.includes('devtools')) continue;
      diagnostics.push({
        code: WcsDiagnosticCode.ScriptOrder,
        start: later.start, end: later.end, severity: 'warning',
        message: msgs.devtoolsAfterState(),
      });
    }
  }

  // --- BaseHrefMissing: router/auto があるのに <base href> がない ---
  const router = autos.find(a => a.pkgs.includes('router') && (!a.bundle || /<wcs-router\b/i.test(scanText)));
  if (router && !/<base\b[^>]*\bhref\s*=/i.test(scanText)) {
    diagnostics.push({
      code: WcsDiagnosticCode.BaseHrefMissing,
      start: router.start, end: router.end, severity: 'warning',
      message: msgs.baseHrefMissing(),
    });
  }

  // --- RouterOutletMisplaced: どの router にも使われない <wcs-outlet> ---
  for (const outlet of findMisplacedOutlets(scanText)) {
    diagnostics.push({
      code: WcsDiagnosticCode.RouterOutletMisplaced,
      start: outlet.start, end: outlet.end, severity: 'warning',
      message: msgs.routerOutletMisplaced(),
    });
  }

  // --- SignalsDualEntry: /dom とコア直参照の混在 ---
  const refs = collectSignalsRefs(scanText);
  const dom = refs.find(r => r.kind === 'dom');
  const bare = refs.find(r => r.kind === 'bare');
  if (dom && bare) {
    const later = bare.start > dom.start ? bare : dom;
    diagnostics.push({
      code: WcsDiagnosticCode.SignalsDualEntry,
      start: later.start, end: later.end, severity: 'error',
      message: msgs.signalsDualEntry(),
    });
  }

  return diagnostics;
}

/**
 * `@wcstack/<pkg>/auto` の入口。版の指定（`@wcstack/router@4/auto` — チュートリアルや esm.run の
 * 固定の形）と、jsDelivr の dist の直接の路（`@wcstack/router@4.0.2/dist/auto.min.js` —
 * SRI を付ける本番の形。`@wcstack/state/dist/split/auto.js` も）を含む。版の付いた形を
 * 見落とすと、本番の書き方のページでだけ検査が黙る。
 */
const SCOPED_AUTO = /@wcstack\/([a-z0-9-]+)(?:@[^/"'\s]+)?\/(?:auto\b|dist\/(?:split\/)?auto(?:\.min)?\.js\b)/;
/** 一括バンドル `wcstack/auto`（`wcstack@4/auto`・`wcstack@4.0.2/dist/auto.min.js`）。 */
const BUNDLE_AUTO = /(?:^|\/)wcstack(?:@[^/"'\s]+)?\/(?:auto\b|dist\/auto\.min\.js\b)/;
/** 一括バンドルの中身（packages/wcstack/README.md）。 */
const BUNDLE_PACKAGES: readonly string[] = ['state', 'router', 'fetch', 'storage', 'autoloader'];

/**
 * `/auto` の入口を読む `<script src>` を文書順で列挙する。
 * CDN（esm.run / jsdelivr / unpkg）・ローカルパスのいずれでも、上の 2 つの形で判定する。
 */
function findWcstackAutoScripts(html: string): ScriptSrcOccurrence[] {
  const out: ScriptSrcOccurrence[] = [];
  const scriptRegex = /<script\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = extractSrc(match[0]);
    if (!src) continue;
    const pkgMatch = SCOPED_AUTO.exec(src.value);
    const bundle = pkgMatch === null && BUNDLE_AUTO.test(src.value);
    if (pkgMatch === null && !bundle) continue;
    out.push({
      pkgs: bundle ? BUNDLE_PACKAGES : [pkgMatch![1]],
      bundle,
      start: match.index + src.offsetInTag,
      end: match.index + src.offsetInTag + src.value.length,
    });
  }
  return out;
}

/**
 * `@wcstack/signals` 系の実参照（script src / inline module の import 指定子）を集める。
 * importmap のキー宣言だけでは何も読み込まれないため、参照として数えない。
 */
function collectSignalsRefs(html: string): SignalsRef[] {
  const refs: SignalsRef[] = [];
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const openTag = html.slice(match.index, match.index + match[0].indexOf('>') + 1);
    const src = extractSrc(openTag);
    if (src) {
      const kind = classifySignalsSpecifier(src.value);
      if (kind) {
        refs.push({
          kind,
          start: match.index + src.offsetInTag,
          end: match.index + src.offsetInTag + src.value.length,
        });
      }
      continue;
    }
    // inline module: import 文 / dynamic import の指定子だけを見る（JS コメントは空白化）。
    if (!/\btype\s*=\s*(["'])module\1/i.test(match[1])) continue;
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    const body = blankJsComments(match[2]);
    const importRegex = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']*@wcstack\/signals[^"']*)\1/g;
    let im: RegExpExecArray | null;
    while ((im = importRegex.exec(body)) !== null) {
      const kind = classifySignalsSpecifier(im[2]);
      if (!kind) continue;
      const specStart = bodyStart + im.index + im[0].indexOf(im[1]) + 1;
      refs.push({ kind, start: specStart, end: specStart + im[2].length });
    }
  }
  return refs;
}

/** signals 指定子の分類（signals 以外は null）。 */
function classifySignalsSpecifier(spec: string): 'dom' | 'bare' | null {
  if (!spec.includes('@wcstack/signals')) return null;
  return /@wcstack\/signals\/dom\b/.test(spec) ? 'dom' : 'bare';
}

/** 開きタグ文字列から src 属性値と（タグ内）オフセットを取り出す。 */
function extractSrc(openTag: string): { value: string; offsetInTag: number } | null {
  const srcMatch = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!srcMatch) return null;
  return {
    value: srcMatch[2],
    offsetInTag: srcMatch.index + srcMatch[0].indexOf(srcMatch[1]) + 1,
  };
}

/** HTML コメントをオフセット保存のまま空白化する。 */
function blankHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
}

/** JS の行・ブロックコメントをオフセット保存のまま空白化する（文字列内は考慮しない簡易版）。 */
function blankJsComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre: string) => pre + ' '.repeat(m.length - pre.length));
}

// ============================================================
// router と outlet の並び（docs/router-outlet-placement.md）
// ============================================================

const ROUTER_TAG = 'wcs-router';
const OUTLET_TAG = 'wcs-outlet';

interface TagToken {
  name: string;
  close: boolean;
  /** タグ名の範囲（診断の位置）。 */
  start: number;
  end: number;
}

/**
 * どの router にも使われない `<wcs-outlet>` の開始タグを返す。
 *
 * router は自分の直後の兄弟要素だけを outlet として使い、無ければ自分の直後に作る（`Router.ts`
 * の `_getOutlet`）。だから直前の兄弟が `<wcs-router>` でない outlet は、どの router にも使われない。
 * 報告するのは、そういう outlet があり、かつ直後に outlet を持たない router があるとき — router が
 * 自前の outlet を作り、ページがそこに描かれる形（ランタイムの警告と同じ条件）。
 *
 * タグの並びで判定する: `</wcs-router>` の次のタグが開始タグなら、それが router の次の兄弟、
 * 終了タグなら次の兄弟は無い。`<wcs-outlet>` の前のタグが `</wcs-router>` なら直前の兄弟は router。
 * `<script>` / `<style>` の中身は数えない（`innerHTML` に書いた文字列はページの要素ではない）。
 */
function findMisplacedOutlets(html: string): { start: number; end: number }[] {
  const scan = html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open: string, _name: string, body: string, close: string) => open + ' '.repeat(body.length) + close);
  const tokens: TagToken[] = [];
  const tagRegex = /<(\/?)([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(scan)) !== null) {
    const nameStart = match.index + 1 + match[1].length;
    tokens.push({ name: match[2].toLowerCase(), close: match[1] === '/', start: nameStart, end: nameStart + match[2].length });
  }

  let routerWithoutOutlet = false;
  const misplaced: { start: number; end: number }[] = [];
  tokens.forEach((token, i) => {
    if (token.name === ROUTER_TAG && token.close) {
      const next = tokens[i + 1];
      if (!next || next.close || next.name !== OUTLET_TAG) routerWithoutOutlet = true;
    }
    if (token.name === OUTLET_TAG && !token.close) {
      const prev = tokens[i - 1];
      if (!(prev && prev.close && prev.name === ROUTER_TAG)) misplaced.push({ start: token.start, end: token.end });
    }
  });
  return routerWithoutOutlet ? misplaced : [];
}
