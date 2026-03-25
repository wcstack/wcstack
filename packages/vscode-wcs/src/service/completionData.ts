/**
 * completionData.ts
 *
 * data-wcs 属性の補完候補データ。
 * @wcstack/state の仕様に基づく静的な補完データを提供する。
 */

// ============================================================
// フィルタ
// ============================================================

export interface FilterInfo {
  name: string;
  description: string;
  hasArgs: boolean;
  /** フィルタ適用後の結果型（'passthrough' は入力型をそのまま返す） */
  resultType: 'boolean' | 'number' | 'string' | 'passthrough';
  /** 受け入れ可能な入力型（'any' は任意の型を受け入れる） */
  acceptTypes: 'any' | string[];
  /** 引数の最小数 */
  minArgs: number;
  /** 引数の最大数 */
  maxArgs: number;
  /** 各引数の期待型（省略時はチェックしない） */
  argTypes?: ('number' | 'string' | 'any')[];
}

/** 組み込みフィルタ一覧（@wcstack/state builtinFilters.ts と同期） */
export const BUILTIN_FILTERS: FilterInfo[] = [
  // 比較・論理
  { name: 'eq',  description: '等しいか比較',     hasArgs: true,  resultType: 'boolean', acceptTypes: 'any',                 minArgs: 1, maxArgs: 1, argTypes: ['any'] },
  { name: 'ne',  description: '異なるか比較',     hasArgs: true,  resultType: 'boolean', acceptTypes: 'any',                 minArgs: 1, maxArgs: 1, argTypes: ['any'] },
  { name: 'not', description: 'ブール値を反転',   hasArgs: false, resultType: 'boolean', acceptTypes: ['boolean'],           minArgs: 0, maxArgs: 0 },
  { name: 'lt',  description: 'より小さいか',     hasArgs: true,  resultType: 'boolean', acceptTypes: ['number', 'string'],  minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'le',  description: '以下か',           hasArgs: true,  resultType: 'boolean', acceptTypes: ['number', 'string'],  minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'gt',  description: 'より大きいか',     hasArgs: true,  resultType: 'boolean', acceptTypes: ['number', 'string'],  minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'ge',  description: '以上か',           hasArgs: true,  resultType: 'boolean', acceptTypes: ['number', 'string'],  minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  // 算術
  { name: 'inc', description: '加算',             hasArgs: true,  resultType: 'number',  acceptTypes: ['number'],            minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'dec', description: '減算',             hasArgs: true,  resultType: 'number',  acceptTypes: ['number'],            minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'mul', description: '乗算',             hasArgs: true,  resultType: 'number',  acceptTypes: ['number'],            minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'div', description: '除算',             hasArgs: true,  resultType: 'number',  acceptTypes: ['number'],            minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'mod', description: '剰余',             hasArgs: true,  resultType: 'number',  acceptTypes: ['number'],            minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  // 数値フォーマット
  { name: 'fix',     description: '固定小数点表記',             hasArgs: true,  resultType: 'string',  acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'locale',  description: 'ロケール形式で数値フォーマット', hasArgs: true, resultType: 'string', acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['string'] },
  { name: 'round',   description: '四捨五入',                   hasArgs: true,  resultType: 'number',  acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'floor',   description: '切り下げ',                   hasArgs: true,  resultType: 'number',  acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'ceil',    description: '切り上げ',                   hasArgs: true,  resultType: 'number',  acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'percent', description: 'パーセンテージ形式',         hasArgs: true,  resultType: 'string',  acceptTypes: ['number'], minArgs: 0, maxArgs: 1, argTypes: ['number'] },
  { name: 'int',     description: '整数にパース',               hasArgs: false, resultType: 'number',  acceptTypes: ['string', 'number'], minArgs: 0, maxArgs: 0 },
  { name: 'float',   description: '浮動小数点数にパース',       hasArgs: false, resultType: 'number',  acceptTypes: ['string', 'number'], minArgs: 0, maxArgs: 0 },
  // 文字列
  { name: 'uc',     description: '大文字に変換',               hasArgs: false, resultType: 'string', acceptTypes: ['string'], minArgs: 0, maxArgs: 0 },
  { name: 'lc',     description: '小文字に変換',               hasArgs: false, resultType: 'string', acceptTypes: ['string'], minArgs: 0, maxArgs: 0 },
  { name: 'cap',    description: '先頭文字を大文字に',         hasArgs: false, resultType: 'string', acceptTypes: ['string'], minArgs: 0, maxArgs: 0 },
  { name: 'trim',   description: '前後の空白を削除',           hasArgs: false, resultType: 'string', acceptTypes: ['string'], minArgs: 0, maxArgs: 0 },
  { name: 'slice',  description: '部分文字列 (start[,end])',   hasArgs: true,  resultType: 'string', acceptTypes: ['string'], minArgs: 1, maxArgs: 2, argTypes: ['number', 'number'] },
  { name: 'substr', description: '部分文字列 (pos,len)',       hasArgs: true,  resultType: 'string', acceptTypes: ['string'], minArgs: 1, maxArgs: 2, argTypes: ['number', 'number'] },
  { name: 'pad',    description: 'パディング (length[,char])', hasArgs: true,  resultType: 'string', acceptTypes: ['string'], minArgs: 1, maxArgs: 2, argTypes: ['number', 'string'] },
  { name: 'rep',    description: '繰り返し (count)',           hasArgs: true,  resultType: 'string', acceptTypes: ['string'], minArgs: 1, maxArgs: 1, argTypes: ['number'] },
  { name: 'rev',    description: '文字順を反転',               hasArgs: false, resultType: 'string', acceptTypes: ['string'], minArgs: 0, maxArgs: 0 },
  // 日付・時刻
  { name: 'date',     description: 'ロケール形式の日付',   hasArgs: false, resultType: 'string', acceptTypes: 'any', minArgs: 0, maxArgs: 0 },
  { name: 'time',     description: 'ロケール形式の時刻',   hasArgs: false, resultType: 'string', acceptTypes: 'any', minArgs: 0, maxArgs: 0 },
  { name: 'datetime', description: 'ロケール形式の日時',   hasArgs: false, resultType: 'string', acceptTypes: 'any', minArgs: 0, maxArgs: 0 },
  { name: 'ymd',      description: 'YYYY-MM-DD 形式',     hasArgs: true,  resultType: 'string', acceptTypes: 'any', minArgs: 0, maxArgs: 1, argTypes: ['string'] },
  // 真偽値・変換
  { name: 'falsy',    description: '偽値か判定',             hasArgs: false, resultType: 'boolean',     acceptTypes: 'any',        minArgs: 0, maxArgs: 0 },
  { name: 'truthy',   description: '真値か判定',             hasArgs: false, resultType: 'boolean',     acceptTypes: 'any',        minArgs: 0, maxArgs: 0 },
  { name: 'defaults', description: '偽値の場合デフォルト値', hasArgs: true,  resultType: 'passthrough', acceptTypes: 'any',        minArgs: 1, maxArgs: 1, argTypes: ['any'] },
  { name: 'boolean',  description: 'ブール値に変換',         hasArgs: false, resultType: 'boolean',     acceptTypes: 'any',        minArgs: 0, maxArgs: 0 },
  { name: 'number',   description: '数値に変換',             hasArgs: false, resultType: 'number',      acceptTypes: 'any',        minArgs: 0, maxArgs: 0 },
  { name: 'string',   description: '文字列に変換',           hasArgs: false, resultType: 'string',      acceptTypes: 'any',        minArgs: 0, maxArgs: 0 },
  { name: 'null',     description: '空文字列をnullに変換',   hasArgs: false, resultType: 'passthrough', acceptTypes: ['string'],   minArgs: 0, maxArgs: 0 },
];

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
];

/** 構造ディレクティブ */
export const STRUCTURAL_DIRECTIVES: PropertyInfo[] = [
  { name: 'for', description: 'リストレンダリング (<template>)', insertColon: true },
  { name: 'if', description: '条件付きレンダリング (<template>)', insertColon: true },
  { name: 'elseif', description: 'else-if 条件 (<template>)', insertColon: true },
  { name: 'else', description: 'else ブロック (<template>)', insertColon: false },
];

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

/** イベント修飾子 */
export const EVENT_MODIFIERS = [
  { name: 'prevent', description: 'event.preventDefault() を呼び出す' },
  { name: 'stop', description: 'event.stopPropagation() を呼び出す' },
];
