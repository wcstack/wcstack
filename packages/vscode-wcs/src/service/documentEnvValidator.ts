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
 *   script src と inline module の import 指定子だけを参照として数える。import map が両方の
 *   エントリを割り当てているだけでも warning（別ファイルの module がコアを import すると二重化する —
 *   docs/seam-apps.md、signals-shop）。
 * - RouteBareMustache: `<wcs-route>`（またはレイアウトのテンプレート）の直下のテキストの `{{ }}`
 *   （最初に着いたルートでしか束ねられない）
 * - LayoutSlotMissing: 既定の `<slot>` の無いレイアウトのテンプレートに、名前付きスロットの外の中身を
 *   渡している（入れ子のルートが表示されない。ランタイムも同じ code で警告する）
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

  // --- ScriptOrder: state/auto の後の devtools/auto ---
  // info: 4.0 は後から付いた DevTools に既存の束縛をすべて送り直す（state の devtools/devtools.ts の
  // `_setSink`）ので、欠けるのは付く前のタイムラインだけ（3.x は配線台帳が取れなかったので warning だった）
  const stateIndex = autos.findIndex(a => a.pkgs.includes('state'));
  if (stateIndex !== -1) {
    for (const later of autos.slice(stateIndex + 1)) {
      if (!later.pkgs.includes('devtools')) continue;
      diagnostics.push({
        code: WcsDiagnosticCode.ScriptOrder,
        start: later.start, end: later.end, severity: 'info',
        message: msgs.devtoolsAfterState(),
      });
    }
  }

  // --- BaseHrefMissing: router/auto があるのに <base href> がない ---
  // `<script src>` に加えて、インラインの module script の import（import map で解決する
  // `import "@wcstack/router/auto"` — signals のページの書き方）も数える。import は型だけの
  // こともあるので、こちらは一括バンドルと同じく `<wcs-router>` のあるページに限る
  // （docs/seam-apps.md、signals-shop）
  const hasRouterTag = /<wcs-router\b/i.test(scanText);
  const router = autos.find(a => a.pkgs.includes('router') && (!a.bundle || hasRouterTag))
    ?? (hasRouterTag
      ? collectInlineImports(scanText).find(i => /@wcstack\/router\b/.test(i.spec) || BUNDLE_AUTO.test(i.spec))
      : undefined);
  // A synchronous `<head>` script that creates the `<base>` provides one too: the router README §1.4's form for a
  // locale in the basename (examples/router-i18n — the lint warned on the documented page, the city-library seam app)
  if (router && !/<base\b[^>]*\bhref\s*=/i.test(scanText) && !headScriptCreatesBase(scanText)) {
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
  } else {
    // 両方を割り当てた import map: このページの import が /dom だけでも、読み込む別ファイルの module が
    // `@wcstack/signals` を import すると 2 つ目のコアになる（lint はそのファイルを読まない）
    const both = findSignalsImportMapBoth(scanText);
    if (both) {
      diagnostics.push({
        code: WcsDiagnosticCode.SignalsDualEntry,
        start: both.start, end: both.end, severity: 'warning',
        message: msgs.signalsImportMapBoth(),
      });
    }
  }

  // --- RouteBareMustache / LayoutSlotMissing: タグとテキストの並びから ---
  const structure = scanStructure(scanText);
  for (const at of structure.bareMustaches) {
    diagnostics.push({
      code: WcsDiagnosticCode.RouteBareMustache,
      start: at.start, end: at.end, severity: 'warning',
      message: msgs.routeBareMustache(at.inLayout),
    });
  }
  for (const layout of structure.layoutsWithoutDefaultSlot) {
    diagnostics.push({
      code: WcsDiagnosticCode.LayoutSlotMissing,
      start: layout.start, end: layout.end, severity: 'warning',
      message: msgs.layoutSlotMissing(layout.id),
    });
  }

  return diagnostics;
}

/**
 * `<script type="importmap">` が `@wcstack/signals` と `@wcstack/signals/dom`（または接頭辞の
 * `@wcstack/signals/`）の両方を割り当てていれば、前者のキーの範囲。どちらも `dist/` のファイル
 * （チャンクを共有する）なら null。
 */
function findSignalsImportMapBoth(html: string): { start: number; end: number } | null {
  const mapRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = mapRegex.exec(html)) !== null) {
    if (!/\btype\s*=\s*(["'])importmap\1/i.test(match[1])) continue;
    let imports: Record<string, unknown> | undefined;
    try {
      imports = (JSON.parse(match[2]) as { imports?: Record<string, unknown> }).imports;
    } catch {
      continue;
    }
    if (imports === null || typeof imports !== 'object') continue;
    const core = imports['@wcstack/signals'];
    const dom = imports['@wcstack/signals/dom'] ?? imports['@wcstack/signals/'];
    if (typeof core !== 'string' || typeof dom !== 'string') continue;
    if (core.includes('/dist/') && dom.includes('/dist/')) continue;
    const key = '"@wcstack/signals"';
    const at = match[2].indexOf(key);
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    const start = bodyStart + (at === -1 ? 0 : at + 1);
    return { start, end: start + key.length - 2 };
  }
  return null;
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
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = extractSrc(match[0]);
    const kind = src ? classifySignalsSpecifier(src.value) : null;
    if (src && kind) {
      refs.push({
        kind,
        start: match.index + src.offsetInTag,
        end: match.index + src.offsetInTag + src.value.length,
      });
    }
  }
  for (const im of collectInlineImports(html)) {
    const kind = classifySignalsSpecifier(im.spec);
    if (kind) refs.push({ kind, start: im.start, end: im.end });
  }
  return refs.sort((a, b) => a.start - b.start);
}

/** インラインの module script の import 指定子 1 つ。 */
interface InlineImport {
  spec: string;
  start: number;
  end: number;
}

/**
 * インラインの module script の import 指定子（import 文・副作用の import・dynamic import）を
 * 文書順で集める。JS コメントは空白化して見る。importmap のキー宣言だけでは何も読み込まれない
 * ため、数えない。
 */
function collectInlineImports(html: string): InlineImport[] {
  const out: InlineImport[] = [];
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (extractSrc(`<script${match[1]}>`) || !/\btype\s*=\s*(["'])module\1/i.test(match[1])) continue;
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    const body = blankJsComments(match[2]);
    const importRegex = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']*)\1/g;
    let im: RegExpExecArray | null;
    while ((im = importRegex.exec(body)) !== null) {
      const start = bodyStart + im.index + im[0].indexOf(im[1]) + 1;
      out.push({ spec: im[2], start, end: start + im[2].length });
    }
  }
  return out;
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

/**
 * Whether a synchronous inline script in `<head>` creates a `<base>` element: `document.createElement("base")`, or
 * `<base` in what `document.write` / `writeln` / `insertAdjacentHTML` is given. That script runs while the document is
 * parsed, before the router's module (deferred) reads `document.baseURI` — the router README §1.4 writes
 * `<base href="/<lang>/">` this way once the locale is known. Only a classic script without `src` before `</head>` (or
 * `<body>`) counts: a module script or one in the body may run too late to be the base the router reads.
 */
function headScriptCreatesBase(html: string): boolean {
  const lower = html.toLowerCase();
  const ends = [lower.indexOf('</head'), lower.indexOf('<body')].filter((i) => i !== -1);
  const headEnd = ends.length === 0 ? html.length : Math.min(...ends);
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null && match.index < headEnd) {
    if (extractSrc(`<script${match[1]}>`)) continue;
    const type = attrValue(match[1], 'type');
    if (type !== null && !/^\s*(?:text|application)\/(?:x-)?(?:javascript|ecmascript)\s*$/i.test(type) && type.trim() !== '') continue;
    const code = blankJsComments(match[2]);
    if (/\bcreateElement\s*\(\s*(["'`])base\1\s*\)/i.test(code)) return true;
    const writes = /\b(?:write|writeln|insertAdjacentHTML)\s*\(/g;
    let call: RegExpExecArray | null;
    while ((call = writes.exec(code)) !== null) {
      if (/<base\b/i.test(callArguments(code, call.index + call[0].length))) return true;
    }
  }
  return false;
}

/** The text of a call's arguments from just after its `(` to the matching `)` (strings skipped; the rest if unclosed). */
function callArguments(code: string, from: number): string {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < code.length && code[i] !== ch; i++) if (code[i] === '\\') i++;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth === 0) return code.slice(from, i);
      depth--;
    }
  }
  return code.slice(from);
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
// route の直下のテキストと、レイアウトのスロット（docs/seam-apps.md、router-admin）
// ============================================================

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ROUTE_TAG = 'wcs-route';
const LAYOUT_TAG = 'wcs-layout';

interface OpenElement {
  name: string;
  /** `<wcs-layout layout>` が使うテンプレートか（直下のテキストの `{{ }}` は遷移で束ねられない）。 */
  layoutTemplate: boolean;
  /** `<wcs-layout>` の、名前付きスロットの外の中身があるか（直下の slot の無い子・空でないテキスト）。 */
  unslotted?: boolean;
  layoutId?: string;
  nameStart: number;
  nameEnd: number;
}

/** 属性の値（無ければ null）。 */
function attrValue(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m === null ? null : (m[1] ?? m[2] ?? m[3] ?? '');
}

/**
 * タグとその間のテキストを文書順に読み、開いている要素をスタックで追う。
 * - bareMustaches: 直上の要素が `<wcs-route>` かレイアウトのテンプレートであるテキストの `{{ … }}`
 * - layoutsWithoutDefaultSlot: 名前付きスロットの外の中身を持つ `<wcs-layout layout="X">`（`src` 無し）で、
 *   `<template id="X">` の中身に既定の `<slot>`（`name` が無いか空）が無いもの
 * `<script>` / `<style>` の中身は数えない。閉じタグは、開いている同名の要素まで閉じる（省略された閉じタグ）。
 */
function scanStructure(html: string): {
  bareMustaches: { start: number; end: number; inLayout: boolean }[];
  layoutsWithoutDefaultSlot: { start: number; end: number; id: string }[];
} {
  const scan = html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open: string, _name: string, body: string, close: string) => open + ' '.repeat(body.length) + close);
  const tagRegex = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const layoutIds = new Set<string>();
  for (const m of scan.matchAll(/<wcs-layout\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    const id = attrValue(m[1], 'layout');
    if (id !== null && id !== '') layoutIds.add(id);
  }
  const bareMustaches: { start: number; end: number; inLayout: boolean }[] = [];
  const layouts: { start: number; end: number; id: string }[] = [];
  /** テンプレートの id → 中身に既定の slot があるか */
  const templateHasDefaultSlot = new Map<string, boolean>();
  const stack: OpenElement[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const text = (from: number, to: number): void => {
    const top = stack[stack.length - 1];
    if (top === undefined || to <= from) return;
    const chunk = scan.slice(from, to);
    if (top.name === LAYOUT_TAG && chunk.trim() !== '') top.unslotted = true;
    if (top.name !== ROUTE_TAG && !top.layoutTemplate) return;
    for (const m of chunk.matchAll(/\{\{[\s\S]*?\}\}/g)) {
      bareMustaches.push({ start: from + m.index!, end: from + m.index! + m[0].length, inLayout: top.layoutTemplate });
    }
  };
  while ((match = tagRegex.exec(scan)) !== null) {
    text(last, match.index);
    last = match.index + match[0].length;
    const name = match[2].toLowerCase();
    const nameStart = match.index + 1 + match[1].length;
    if (match[1] === '/') {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at === -1) continue;
      for (const closed of stack.splice(at)) {
        if (closed.name === LAYOUT_TAG && closed.unslotted && closed.layoutId !== undefined) {
          layouts.push({ start: closed.nameStart, end: closed.nameEnd, id: closed.layoutId });
        }
      }
      continue;
    }
    const attrs = match[3];
    const parent = stack[stack.length - 1];
    // a direct child of <wcs-layout>: content for the default slot unless it names a slot
    if (parent?.name === LAYOUT_TAG && !attrValue(attrs, 'slot')) parent.unslotted = true;
    // a <slot> inside a layout template: is it the default one
    for (const open of stack) {
      if (open.layoutTemplate && name === 'slot' && !attrValue(attrs, 'name')) templateHasDefaultSlot.set(open.layoutId!, true);
    }
    if (VOID_TAGS.has(name) || /\/\s*$/.test(attrs)) continue;
    const id = name === 'template' ? attrValue(attrs, 'id') : null;
    const element: OpenElement = {
      name, layoutTemplate: id !== null && layoutIds.has(id), nameStart, nameEnd: nameStart + match[2].length,
    };
    if (element.layoutTemplate) {
      element.layoutId = id!;
      if (!templateHasDefaultSlot.has(id!)) templateHasDefaultSlot.set(id!, false);
    }
    if (name === LAYOUT_TAG && attrValue(attrs, 'src') === null) {
      const layoutId = attrValue(attrs, 'layout');
      if (layoutId !== null && layoutId !== '') element.layoutId = layoutId;
    }
    stack.push(element);
  }
  text(last, scan.length);
  for (const closed of stack) {
    if (closed.name === LAYOUT_TAG && closed.unslotted && closed.layoutId !== undefined) {
      layouts.push({ start: closed.nameStart, end: closed.nameEnd, id: closed.layoutId });
    }
  }
  // a layout whose template is on the page (an unknown one is the runtime's warning) and has no default slot
  const layoutsWithoutDefaultSlot = layouts.filter((l) => templateHasDefaultSlot.get(l.id) === false);
  return { bareMustaches, layoutsWithoutDefaultSlot };
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
