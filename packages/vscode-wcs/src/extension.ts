/**
 * extension.ts
 *
 * VSCode 拡張エントリポイント（クライアント側）。
 * Language Server を起動し、HTML ファイルの言語機能を委譲する。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.cjs'));

  client = new LanguageClient(
    'wcsLanguageServer',
    'WcStack Language Server',
    {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc },
    },
    {
      documentSelector: [
        { scheme: 'file', language: 'html' },
      ],
    },
  );

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
