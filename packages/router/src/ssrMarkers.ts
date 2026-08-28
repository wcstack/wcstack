/**
 * SSR ハイドレーションマーカー（docs/ssr-router-design.md §3.3 / §4）。
 *
 * サーバー（_renderForSsr）が書き、クライアント（_hydrateFromSsr / Link の採用）が
 * 読む。キーは route の absolutePath — placeholder の UUID はパースごとに再生成され
 * サーバーとクライアントで一致しないため、同一 template から決定的に導ける
 * absolutePath だけが突合キーになれる。
 */

/** サーバー描画済み outlet の目印（要素属性） */
export const SSR_OUTLET_ATTR = 'data-wcs-ssr';

/** Link がサーバーで生成した anchor の目印（要素属性）。クライアントが採用して外す */
export const SSR_LINK_ATTR = 'data-wcs-ssr-link';

/** route placeholder コメントの安定キー形式（`@@wcs-route-ph:<absolutePath>`） */
export const ROUTE_PH_PREFIX = '@@wcs-route-ph:';

/** 表示中ルート内容の開始マーカー（`@@wcs-route-start:<absolutePath>`） */
export const ROUTE_START_PREFIX = '@@wcs-route-start:';

/** 表示中ルート内容の終了マーカー（`@@wcs-route-end:<absolutePath>`） */
export const ROUTE_END_PREFIX = '@@wcs-route-end:';
