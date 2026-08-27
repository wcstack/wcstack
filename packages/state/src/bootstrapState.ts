import { setConfig } from "./config";
import { registerDevtoolsSource } from "./devtools/bridge";
import { registerBinder } from "./bindings/binder";
import { registerComponents } from "./registerComponents";
import { IWritableConfig } from "./types";

/**
 * `<html lang>` を既定ロケールとして採る。
 *
 * ロケール依存フィルタ（`locale` / `date` / `time` / `datetime`）は `config.locale`
 * を読むが、それを設定できる公開の入口は `bootstrapState({ locale })` しかない。
 * 一方 `auto` エントリは `bootstrapState()` を引数なしで呼ぶため、CDN 一発
 * （`<script src=".../@wcstack/state/auto">`）で読み込んだページには**ロケールを
 * 渡す口が無かった**。auto バンドルは SRI のため自己完結で、別途 `@wcstack/state`
 * を import して `bootstrapState` を呼んでも別インスタンスになり効かない。
 *
 * `<html lang>` はページのロケールを書く HTML 標準の場所であり、SSR ではサーバーが、
 * 静的ページでは head のスニペットが DOM 解析前に書く。そこを既定にすると
 * **ロケールの正本が 1 つになり**、「設定を早く呼ぶ」という守りにくい順序の約束が
 * 「`<html lang>` が state のロードより前にある」という構造的な保証に変わる。
 *
 * 明示指定（`bootstrapState({ locale })`）が常に優先する。
 */
function localeFromDocument(): string | undefined {
  const lang = document.documentElement?.lang;
  if (!lang) {
    return undefined;
  }
  try {
    // 妥当な BCP-47 タグでなければ Intl が RangeError を投げる。不正な lang を
    // そのまま採ると、これまで既定 'en' で動いていたページのフィルタが実行時に
    // 落ちる。既定へ落として警告するほうが、黙って壊すより回復しやすい。
    Intl.getCanonicalLocales(lang);
    return lang;
  } catch {
    console.warn(
      `[@wcstack/state] <html lang="${lang}"> is not a valid BCP-47 language tag. ` +
      `Falling back to the default locale for filters.`
    );
    return undefined;
  }
}

function resolveConfig(config?: IWritableConfig): IWritableConfig | undefined {
  if (typeof config?.locale === "string") {
    return config;
  }
  const locale = localeFromDocument();
  if (locale === undefined) {
    return config;
  }
  return { ...config, locale };
}

export function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  const resolved = resolveConfig(config);
  if (resolved) {
    setConfig(resolved);
  }
  registerComponents(registry);
  // binder プロトコルの提供（docs/binder-protocol-design.md）。router が後から
  // 差し込むノードをバインドできるようにする。登録は冪等。
  registerBinder();
  // DevTools Hook Protocol への source 登録（SSR では no-op・冪等）
  registerDevtoolsSource();
}
