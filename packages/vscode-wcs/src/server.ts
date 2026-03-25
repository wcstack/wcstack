/**
 * server.ts
 *
 * Volar Language Server エントリポイント。
 * VSCode 拡張のバックエンドプロセスとして動作し、
 * HTML 内の <wcs-state> スクリプトに TypeScript 言語機能を提供する。
 */

import { createConnection, createServerBase } from '@volar/language-server/node.js';
import { createTypeScriptProject } from '@volar/language-server/lib/project/typescriptProject.js';
import { create as createTypeScriptServicePlugins } from 'volar-service-typescript';
import { createWcsLanguagePlugin } from './language/plugin.js';
import { createWcsCompletionPlugin } from './service/wcsCompletionPlugin.js';
import * as ts from 'typescript';

const connection = createConnection();
const server = createServerBase(connection, {
  timer: { setImmediate: setImmediate },
});

connection.onInitialize(params => {
  const tsProject = createTypeScriptProject(
    ts,
    undefined,
    (projectContext) => {
      // --- sys パッチ: TypeScript lib ファイルへのアクセスを実ファイルシステムにフォールバック ---
      // Volar の sys は LSP ベースの仮想ファイルシステムを使用するため、
      // TypeScript の lib ファイル（ThisType<T> 等の宣言を含む）にアクセスできない。
      // lib ディレクトリのファイルだけ ts.sys にフォールバックする。
      const tsLibDir = ts.getDefaultLibFilePath({}).replace(/[/\\][^/\\]+$/, '');
      patchSysForLibFiles(projectContext.sys, tsLibDir);

      // --- projectHost のコンパイラオプションをオーバーライド ---
      // configFileName が undefined（HTML ファイルは tsconfig 探索の対象外）の場合、
      // デフォルトのコンパイラオプションが使われるため、必要な設定を強制する。
      const origGetSettings = projectContext.projectHost.getCompilationSettings.bind(projectContext.projectHost);
      projectContext.projectHost.getCompilationSettings = () => ({
        ...origGetSettings(),
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noImplicitThis: true,  // ThisType<T> に必須
        allowJs: true,
        checkJs: true,
      });

      return {
        languagePlugins: [createWcsLanguagePlugin()],
      };
    },
  );

  const servicePlugins = [
    ...createTypeScriptServicePlugins(ts),
    createWcsCompletionPlugin(),
  ];
  return server.initialize(params, tsProject, servicePlugins);
});

connection.onInitialized(() => {
  server.initialized();
});

connection.onShutdown(() => {
  server.shutdown();
});

connection.listen();

/**
 * Volar の sys を TypeScript lib ファイル用にパッチする。
 * Volar の仮想ファイルシステムで lib ファイルが見つからない場合、
 * ts.sys（実ファイルシステム）にフォールバックする。
 */
function patchSysForLibFiles(
  volarSys: { fileExists: (path: string) => boolean; readFile: (path: string, encoding?: string) => string | undefined },
  tsLibDir: string,
): void {
  const origFileExists = volarSys.fileExists.bind(volarSys);
  const origReadFile = volarSys.readFile.bind(volarSys);

  volarSys.fileExists = (path: string) => {
    const result = origFileExists(path);
    if (!result && isTypescriptLibPath(path, tsLibDir)) {
      return ts.sys.fileExists(path);
    }
    return result;
  };

  volarSys.readFile = (path: string, encoding?: string) => {
    const result = origReadFile(path, encoding);
    if (result === undefined && isTypescriptLibPath(path, tsLibDir)) {
      return ts.sys.readFile(path, encoding);
    }
    return result;
  };
}

/** パスが TypeScript lib ディレクトリ内のファイルかどうかを判定 */
function isTypescriptLibPath(filePath: string, tsLibDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedLib = tsLibDir.replace(/\\/g, '/');
  const libPrefix = normalizedLib.endsWith('/') ? normalizedLib : normalizedLib + '/';
  return normalized.startsWith(libPrefix) || normalized === normalizedLib;
}
