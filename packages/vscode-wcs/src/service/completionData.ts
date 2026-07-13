/**
 * completionData.ts
 *
 * data-wcs 属性の補完候補データ。
 * @wcstack/state の仕様に基づく静的な補完データを提供する。
 */

import { builtinFilterMeta, STRUCTURAL_BINDING_TYPE_SET, type IFilterMeta } from './wcsManifest.js';

// ============================================================
// フィルタ
// ============================================================

/** フィルタ補完情報。@wcstack/state の IFilterMeta に name を加えたもの。 */
export interface FilterInfo extends IFilterMeta {
  name: string;
}

/**
 * 組み込みフィルタ一覧（@wcstack/state の filterMeta 正本から自動導出）。
 * 手リストを廃止し manifest（単一正本）から導出することで、二重実装・手作業同期によるドリフトを排除。
 */
export const BUILTIN_FILTERS: FilterInfo[] = Object.entries(builtinFilterMeta).map(
  ([name, meta]) => ({ name, ...meta }),
);

// ============================================================
// プロパティ（バインディング左辺）
// ============================================================

export interface PropertyInfo {
  name: string;
  description: string;
  /** 補完時に `: ` を自動挿入するか */
  insertColon: boolean;
}

/** よく使われる DOM プロパティ */
export const COMMON_PROPERTIES: PropertyInfo[] = [
  { name: 'textContent', description: 'テキストコンテンツ', insertColon: true },
  { name: 'innerHTML', description: 'HTML コンテンツ', insertColon: true },
  { name: 'value', description: 'フォーム要素の値', insertColon: true },
  { name: 'checked', description: 'チェック状態', insertColon: true },
  { name: 'disabled', description: '無効化', insertColon: true },
  { name: 'hidden', description: '非表示', insertColon: true },
  { name: 'src', description: 'ソース URL', insertColon: true },
  { name: 'href', description: 'リンク先 URL', insertColon: true },
];

/** プレフィックス付きプロパティ */
export const PROPERTY_PREFIXES: PropertyInfo[] = [
  { name: 'class.', description: 'CSS クラスの切り替え', insertColon: false },
  { name: 'style.', description: 'インラインスタイルの設定', insertColon: false },
  { name: 'attr.', description: 'HTML 属性の設定', insertColon: false },
  { name: 'command.', description: 'command-token 起動（右辺: $command.<name>）', insertColon: false },
  { name: 'eventToken.', description: 'event-token 配線（右辺: $eventTokens 宣言名）', insertColon: false },
];

/** 特殊バインディング（parseBindTextsForElement.ts の special-propPart） */
export const SPECIAL_BINDINGS: PropertyInfo[] = [
  { name: '...', description: 'スプレッド — wcBindable の properties+inputs を一括配線', insertColon: true },
  { name: 'radio', description: 'ラジオボタングループの双方向バインディング', insertColon: true },
  { name: 'checkbox', description: 'チェックボックスグループの双方向バインディング', insertColon: true },
];

/**
 * 構造ディレクティブ。名前集合は @wcstack/state の STRUCTURAL_BINDING_TYPE_SET 正本から導出
 * （手書きの二重定義を排除）。説明と insertColon は補完 UI 用に vscode-wcs 側で保持する。
 */
const STRUCTURAL_DIRECTIVE_INFO: Record<string, { description: string; insertColon: boolean }> = {
  for: { description: 'リストレンダリング (<template>)', insertColon: true },
  if: { description: '条件付きレンダリング (<template>)', insertColon: true },
  elseif: { description: 'else-if 条件 (<template>)', insertColon: true },
  else: { description: 'else ブロック (<template>)', insertColon: false },
};
export const STRUCTURAL_DIRECTIVES: PropertyInfo[] = [...STRUCTURAL_BINDING_TYPE_SET].map((name) => ({
  name,
  ...STRUCTURAL_DIRECTIVE_INFO[name],
}));

/** よく使われるイベントハンドラ */
export const COMMON_EVENTS: PropertyInfo[] = [
  { name: 'onclick', description: 'クリックイベント', insertColon: true },
  { name: 'onchange', description: '変更イベント', insertColon: true },
  { name: 'oninput', description: '入力イベント', insertColon: true },
  { name: 'onsubmit', description: '送信イベント', insertColon: true },
  { name: 'onfocus', description: 'フォーカスイベント', insertColon: true },
  { name: 'onblur', description: 'フォーカス離脱イベント', insertColon: true },
  { name: 'onkeydown', description: 'キー押下イベント', insertColon: true },
  { name: 'onkeyup', description: 'キー離上イベント', insertColon: true },
  { name: 'onmouseover', description: 'マウスオーバーイベント', insertColon: true },
  { name: 'onmouseout', description: 'マウスアウトイベント', insertColon: true },
];

/**
 * バインディング修飾子（`prop#modifier` — カンマ区切りで複数指定可）。
 * prevent/stop はイベント系、ro は two-way / radio / checkbox の書き戻し抑止。
 * このほか two-way では `on<event>`（例: `value#onblur`）でトリガーイベントを上書きできる
 * （event/twowayHandler.ts）— イベント名は自由記述のため静的候補には含めない。
 */
export const EVENT_MODIFIERS = [
  { name: 'prevent', description: 'event.preventDefault() を呼び出す' },
  { name: 'stop', description: 'event.stopPropagation() を呼び出す' },
  { name: 'ro', description: '双方向バインディングの書き戻しを抑止（読み取り専用）' },
];
