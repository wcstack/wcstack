/**
 * protocol.ts — TypeScript 7.1 の content mapper のプロトコル（wire の型）。
 *
 * TypeScript が mapper を子プロセスとして起こし、標準入出力の JSON-RPC 2.0
 * （`Content-Length` の枠）で `initialize` → `openProject` → `transform` → `closeProject`
 * を送る。要求を送るのはいつも TypeScript で、mapper は答えるだけ。
 *
 * 出典は microsoft/TypeScript の `tsc/internal/contentmapper/hostimpl.go`（7.1。
 * round 2 #63936 で `protocolVersion` が消え、診断の `code` が必須になった後の形）と
 * `tsc/internal/spanmap/spanmap.go`。設計は docs/typescript-content-mapper.md。
 */

export type PositionEncoding = 'utf-8' | 'utf-16';

export interface InitializeParams {
  /** mapper が書くメッセージの BCP 47 の言語（このパッケージは使わない — メッセージは英語だけ）。 */
  readonly locale?: string;
  /** TypeScript が受け付ける位置の単位。 */
  readonly positionEncodings: readonly string[];
}

export interface InitializeResult {
  readonly positionEncoding: PositionEncoding;
  /** mapper が書く診断のコードの接頭辞（`wcs1001`）。`typescript` / `tsc` / 扱う拡張子と同じ名前は拒まれる。 */
  readonly diagnosticSource: string;
}

export interface OpenProjectParams {
  /** 設定ファイルの絶対パス（無ければ空）。 */
  readonly configFileName: string;
  /** TypeScript が振る不透明なハンドル。1 つのプロセスが複数のプロジェクトを受ける。 */
  readonly projectHandle: string;
  /** tsconfig の `contentMappers` の項目の `options`。 */
  readonly options?: unknown;
  /** 実効のコンパイラオプション（このパッケージは使わない）。 */
  readonly compilerOptions: unknown;
}

/** `options` の誤り。`path` は `options` からの道筋（`["urlImports"]`）。 */
export interface OptionDiagnostic {
  readonly path: readonly (string | number)[];
  readonly messageText: string;
  readonly code: number;
}

/**
 * `configIdentity` / `watchedFiles` は manifest で `dynamicConfig` を宣言した mapper だけが返せる
 * （宣言せずに返すと TypeScript はプロジェクトを開けない）。このパッケージは宣言しない。
 */
export interface OpenProjectResult {
  readonly optionDiagnostics?: readonly OptionDiagnostic[];
}

export interface CloseProjectParams {
  readonly projectHandle: string;
}

export interface TransformParams {
  readonly fileName: string;
  readonly content: string;
  readonly projectHandle: string;
}

/**
 * `[virtualStart, virtualLength, originalStart, originalLength, kind]`。kind 0 は `Verbatim`
 * （両側のテキストが一致しなければならない）。6 つ目（features）を省くと全部の言語機能。
 * 仮想側の昇順・重なり無し。
 */
export type Mapping = [number, number, number, number, 0];

/**
 * `[originalStart, originalLength, virtualStart, virtualEnd, policy]` — mapping と違い、仮想側は
 * 長さではなく終端。policy 0 は ignore（その仮想範囲の TypeScript の診断を出さない）。
 * 仮想範囲は互いに重なってはならない。ignore の元の範囲は表示にしか使われない。
 */
export type DiagnosticDirective = [number, number, number, number, 0];

export interface DiagnosticDirectives {
  readonly unusedExpectDirectiveDiagnostics: readonly never[];
  readonly directives: readonly DiagnosticDirective[];
}

export interface MappedOutput {
  readonly text: string;
  /** `.ts` / `.mts` / `.js` …。`.mts` / `.cts` / `.mjs` / `.cjs` はいつもモジュールとして読まれる。 */
  readonly extension: string;
  readonly mappings: readonly Mapping[];
  readonly diagnosticDirectives?: DiagnosticDirectives;
}

/** 正規の出力 1 つと、import できない supplemental の出力（同じ program に入る）。 */
export interface TransformResult extends MappedOutput {
  readonly supplemental?: readonly MappedOutput[];
}

/** JSON-RPC 2.0 のエラーコード。 */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
