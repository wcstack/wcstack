import { IGuardContext, IRouteMatchResult } from "./components/types";
import { parseSearchParams } from "./searchParams";

/**
 * guard 判定関数に渡す第 3 引数を組み立てる。
 *
 * `<wcs-router>` が commit 後に露出する観測面（params / typedParams / searchParams /
 * routeName）と同じ語彙・同じ正規化を、commit **前**の guard 相で読めるようにする。
 * guard がデータをロードしてから進入を許可する（loader）とき、ロードに要る
 * パラメータをここから取る。
 *
 * frozen スナップショット — 消費側の変異は loud failure（router 観測面と同じ規範）。
 * routeName は最深マッチルートの name（fallback 時は fallback の name、無名は ""）。
 */
export function createGuardContext(matchResult: IRouteMatchResult): IGuardContext {
  return Object.freeze({
    params: Object.freeze({ ...matchResult.params }),
    typedParams: Object.freeze({ ...matchResult.typedParams }),
    searchParams: parseSearchParams(matchResult.search ?? ""),
    routeName: matchResult.routes[matchResult.routes.length - 1]?.name ?? "",
  });
}
