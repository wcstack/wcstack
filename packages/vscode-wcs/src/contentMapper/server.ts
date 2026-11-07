/**
 * server.ts — content mapper の JSON-RPC の受け答え（protocol.ts）。
 *
 * 要求を送るのはいつも TypeScript で、mapper は 1 つずつ答える。1 つのプロセスが、同じ版の
 * mapper を使う複数のプロジェクト（`projectHandle`）を受ける。TypeScript は `closeProject` の後に
 * 同じハンドルでプロジェクトを開き直すことがある（設定の読み直し・言語の切り替え）。
 *
 * - stdout には protocol のメッセージだけを書く（`console.log` は入口で stderr へ回す）。
 * - 答えは要求ごとに必ず返す。変換の中の例外も JSON-RPC のエラーにして返し、プロセスは落とさない
 *   （TypeScript はそのファイルを空として読み、1 つのプロジェクトで 5 回失敗すると mapper を呼ばなくなる）。
 * - stdin が閉じたら、書きかけの stdout が流れ切るのを待って自然に終わる（`process.exit` しない）。
 */

import { parseMapperOptions, type MapperOptions } from './options.js';
import {
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  type InitializeResult,
  type OpenProjectResult,
  type PositionEncoding,
  type TransformResult,
} from './protocol.js';
import { transformHtml } from './transform.js';

/** 診断のコードの接頭辞（`wcs1001`）。 */
export const DIAGNOSTIC_SOURCE = 'wcs';

type Id = string | number | null;

export interface RpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: Id;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** 1 つのプロセスの状態（位置の単位と、開いているプロジェクト）。 */
export class MapperSession {
  private encoding: PositionEncoding | undefined;
  private readonly projects = new Map<string, MapperOptions>();

  /** 1 つのメッセージ（JSON のテキスト）に答える。通知（id が無い）には `undefined`。 */
  handleText(body: string): RpcResponse | undefined {
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return failure(null, RPC_PARSE_ERROR, 'Parse error');
    }
    return this.handle(message);
  }

  handle(message: unknown): RpcResponse | undefined {
    if (!isRecord(message)) return failure(null, RPC_INVALID_REQUEST, 'Invalid request');
    const id = message.id;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return failure(hasId ? id : null, RPC_INVALID_REQUEST, 'Invalid request');
    }
    if (!hasId) return undefined;
    try {
      return { jsonrpc: '2.0', id, result: this.dispatch(message.method, message.params) };
    } catch (error) {
      if (error instanceof RpcError) return failure(id, error.code, error.message);
      return failure(id, RPC_INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  }

  private dispatch(method: string, params: unknown): unknown {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'openProject':
        return this.openProject(params);
      case 'transform':
        return this.transform(params);
      case 'closeProject':
        return this.closeProject(params);
      default:
        throw new RpcError(RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private initialize(params: unknown): InitializeResult {
    const offered = isRecord(params) && Array.isArray(params.positionEncodings) ? params.positionEncodings : undefined;
    if (offered === undefined) throw new RpcError(RPC_INVALID_PARAMS, 'initialize requires positionEncodings');
    // utf-16 はプラグインが数える JavaScript の文字列のオフセットそのもの
    if (offered.includes('utf-16')) this.encoding = 'utf-16';
    else if (offered.includes('utf-8')) this.encoding = 'utf-8';
    else throw new RpcError(RPC_INVALID_PARAMS, 'The host offers neither utf-16 nor utf-8 positions');
    return { positionEncoding: this.encoding, diagnosticSource: DIAGNOSTIC_SOURCE };
  }

  private openProject(params: unknown): OpenProjectResult {
    if (!isRecord(params) || typeof params.projectHandle !== 'string' || typeof params.configFileName !== 'string') {
      throw new RpcError(RPC_INVALID_PARAMS, 'openProject requires string configFileName and projectHandle');
    }
    const { options, diagnostics } = parseMapperOptions(params.options);
    this.projects.set(params.projectHandle, options);
    return diagnostics.length > 0 ? { optionDiagnostics: diagnostics } : {};
  }

  private transform(params: unknown): TransformResult {
    if (!isRecord(params) || typeof params.fileName !== 'string' || typeof params.content !== 'string' || typeof params.projectHandle !== 'string') {
      throw new RpcError(RPC_INVALID_PARAMS, 'transform requires string fileName, content and projectHandle');
    }
    if (this.encoding === undefined) throw new RpcError(RPC_INTERNAL_ERROR, 'The mapper has not been initialized');
    const options = this.projects.get(params.projectHandle);
    if (options === undefined) throw new RpcError(RPC_INTERNAL_ERROR, `Project has not been opened: ${params.projectHandle}`);
    return transformHtml(params.fileName, params.content, { ...options, encoding: this.encoding });
  }

  private closeProject(params: unknown): null {
    if (!isRecord(params) || typeof params.projectHandle !== 'string') {
      throw new RpcError(RPC_INVALID_PARAMS, 'closeProject requires a string projectHandle');
    }
    this.projects.delete(params.projectHandle);
    return null;
  }
}

function failure(id: Id, code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 1 つのメッセージを `Content-Length` の枠に入れる。 */
export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/**
 * `Content-Length` の枠を読む。チャンクの切れ目は任意（1 つのメッセージが分かれても、複数が
 * 1 つのチャンクに入ってもよい）。長さはバイトで数える。`Content-Length` の無いヘッダーは捨てる。
 */
export function createFrameReader(onBody: (body: string) => void, onBadHeader: (header: string) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (match === null) {
        buffer = buffer.subarray(headerEnd + 4);
        onBadHeader(header);
        continue;
      }
      const start = headerEnd + 4;
      const length = Number(match[1]);
      if (buffer.length < start + length) return;
      const body = buffer.subarray(start, start + length).toString('utf8');
      buffer = buffer.subarray(start + length);
      onBody(body);
    }
  };
}

export interface MapperStreams {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

/** 標準入出力に繋ぐ。 */
export function startStdioMapper(streams: MapperStreams, session = new MapperSession()): void {
  const read = createFrameReader(
    (body) => {
      const response = session.handleText(body);
      if (response !== undefined) streams.stdout.write(frame(response));
    },
    (header) => {
      streams.stderr.write(`[@wcstack/typescript content mapper] ignored a message without Content-Length: ${JSON.stringify(header)}\n`);
    },
  );
  streams.stdin.on('data', (chunk: Buffer | string) => read(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk));
}
