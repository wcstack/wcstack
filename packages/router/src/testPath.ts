import { builtinParamTypes } from "./builtinParamTypes";
import { IRoute, IRouteMatchResult } from "./components/types";

export function testPath(route: IRoute, path: string, segments: string[]): IRouteMatchResult | null {
  const params: Record<string, string> = {};
  const typedParams: Record<string, any> = {};
  let testResult = true;
  let catchAllFound = false;
  let i = 0, segIndex = 0;
  while (i < route.absoluteSegmentInfos.length) {
    const segmentInfo = route.absoluteSegmentInfos[i];
    // index属性のルートはセグメントを消費しないのでスキップ
    if (segmentInfo.isIndex) {
      i++;
      continue;
    }
    // 先頭の空セグメント（絶対パスの /）はsegmentsから除外されているのでスキップ
    if (i === 0 && segmentInfo.segmentText === '' && segmentInfo.type === 'static') {
      i++;
      continue;
    }
    const segment = segments[segIndex];
    if (segment === undefined) {
      // セグメントが足りない
      testResult = false;
      break;
    }
    let match: boolean = false;
    if (segmentInfo.type === "param") {
      const paramType = segmentInfo.paramType || 'any';
      const builtinParamType = builtinParamTypes[paramType];
      const value = builtinParamType.parse(segment);
      if (typeof value !== 'undefined') {
        if (segmentInfo.paramName) {
          params[segmentInfo.paramName] = segment;
          typedParams[segmentInfo.paramName] = value;
        }
        match = true;
      }
    } else {
      match = segmentInfo.pattern.exec(segment) !== null;
    }
    if (match) {
      if (segmentInfo.type === 'catch-all') {
        // Catch-all: match remaining segments
        const remainingSegments = segments.slice(segIndex).join('/');
        params['*'] = remainingSegments;
        typedParams['*'] = remainingSegments;
        catchAllFound = true;
        break; // No more segments to process
      }
    } else {
      testResult = false;
      break; 
    }
    i++;
    segIndex++;
  }
  let finalResult = false;
  if (testResult) {
    if (catchAllFound) {
      // catch-all は残り全部マッチ済み
      finalResult = true;
    } else if (i === route.absoluteSegmentInfos.length && segIndex === segments.length) {
      // 全セグメントが消費された。
      // 末尾スラッシュ（例: /users/）は matchRoutes 側で処理済み: normalizePathname が
      // ルート以外の末尾スラッシュを除去し、matchRoutes の filter が末尾の空セグメントを
      // 落とすため、testPath に渡る segments に末尾 '' は含まれない。よってここで
      // 末尾スラッシュ用の分岐は不要（trailing-slash の結合テストは matchRoutes.test.ts 参照）。
      finalResult = true;
    }
  }
  
  if (finalResult) {
    return {
      path: path,
      routes: route.routes,
      params: params,
      typedParams: typedParams,
      lastPath: ""
    };
  }
  return null;
}