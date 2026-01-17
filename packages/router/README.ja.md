# @wcstack/router

カスタム要素を使って宣言的に定義し、SPAのルーティングを行います

## 特徴
* カスタム要素を使った宣言的なルーティング定義
* ルーティング定義内にレイアウト定義を混在できる
* レイアウト定義ではLightDOMを使ったslot指定が可能
* navigation API対応
* 簡易ではあるもののパラメータバインド対応
* グローバルフォールバック対応
* ゼロコンフィグ
* 依存関係ゼロ
* ビルドレス

## 使い方

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <main-header slot="header"></main-header>
        <main-body>
          <wcs-route index>
            <main-dashboard></main-dashboard>
          </wcs-route>
          <wcs-route path="products">
            <product-list></product-list>
          </wcs-route>
          <wcs-route path="products/:productId">
            <product-item data-bind="props"></product-item>
          </wcs-route>
        </main-body>
      </wcs-layout>
    </wcs-route>

    <wcs-route path="/admin">
      <wcs-layout layout="admin-layout">
        <admin-header slot="header"></admin-header>
        <admin-body></admin-body>
      </wcs-layout>
    </wcs-route>
  </template>
</wcs-router>

<wsc-outlet>
  <!-- ルートパス・レイアウトに従ったDOMツリーを作成し、ここに表示 -->
</wcs-outlet>

<template id="main-layout">
  <section>
    <h1> Main </h1>
    <slot name="header"></slot>
  </section>
  <section>
    <slot></slot>
  </section>
</template>

<template id="admin-layout">
  <section>
    <h1> Admin Main </h1>
    <slot name="header"></slot>
  </section>
  <section>
    <slot></slot>
  </section>
</template>

```

※<main-header/><main-body/><main-dashboard/><product-list/><product-item/><admin-header/><admin-body/>はアプリ側のカスタムコンポーネント
※上記カスタム要素は、オートローダーやコードによる定義が別途必要

