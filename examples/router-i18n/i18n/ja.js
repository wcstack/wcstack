// Japanese catalog. Note `about.fallbackNote` is missing on purpose: catalog.js
// deep merges en.js underneath, so that one key renders in English while the
// rest of the page stays Japanese.
export default {
  app: {
    title: "注文履歴",
    lead: "辞書は 1 つ、ロケールは 2 つ。言語切替は再描画ではなく本物のナビゲーション。",
  },
  nav: {
    orders: "注文",
    about: "このデモについて",
  },
  orders: {
    heading: "あなたの注文",
    empty: "注文はまだありません。",
    placed: "注文日",
    total: "合計",
    // Japanese has a single plural category ("other"). Writing "one" here would
    // be dead weight — Intl.PluralRules never selects it for ja.
    count: {
      other: "{n} 件の注文",
    },
    status: {
      pending: "処理中",
      shipped: "発送済み",
      delivered: "配達完了",
      cancelled: "キャンセル",
    },
  },
  about: {
    heading: "このデモについて",
    body: "辞書は ES モジュールなので、パスゲッターからは import で、テンプレートからは <wcs-state> 経由で届く。言語切替がページを再読み込みするのは意図的。",
  },
  langName: {
    en: "English",
    ja: "日本語",
  },
};
