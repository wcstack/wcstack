/**
 * diagnostics/install.ts — 開発時の診断の install（@wcstack/state/features/diagnostics）。
 * core の受け口（core/diagnosticsHooks.ts）へ、束縛時のパス存在検査を置く。
 */
import { IPathDiagnostics, setPathDiagnostics } from "../core/diagnosticsHooks";
import { checkDeclaredPath, markExportedPath, resetPathDiagnostics } from "./pathChecks";

/** 受け口へ置く実装。外へ出す口は `installDiagnostics` だけなので export しない */
const pathDiagnosticsFeature: IPathDiagnostics = {
  check: checkDeclaredPath,
  reset: resetPathDiagnostics,
  markExported: markExportedPath,
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;
  setPathDiagnostics(pathDiagnosticsFeature);
}
