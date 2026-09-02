/**
 * `bind-component` の**完了前**に親スコープの初期適用がコンポーネントの state プロパティへ
 * 行った書き込みの控え（docs/state-mount-design.md D19 / impl-plan P1-1・P1-10）。
 *
 * 完了前の親→子の適用は `applyChangeToProperty` が素のプロパティに値を積む
 * （webComponent/completeWebComponent.ts）。丸ごとマウントと R1 が入って、この積みが
 * 2 つの取り違えを生むようになった。
 *
 * 1. **丸ごと（1 セグメント・`state: user`）**: `element.state = userObject` と親の
 *    オブジェクトそのもので state プロパティを**置き換える**。子がまだ宣言していない
 *    タイミング（happy-dom の template clone は upgrade 済みで、挿入前に適用が走る）では
 *    宣言台帳のガードが効かず、作者の state オブジェクト（getter / 私有キー）が失われる。
 *    → 置き換え前のオブジェクトを控え、子の初期化時に戻す（`takeOverwrittenObject`）。
 * 2. **部分（2 セグメント・`state.theme: theme`）**: `element.state.theme = themeObject` と
 *    作者のオブジェクトに**キーを注入する**。R1 の判定はこれを own data key と区別できない。
 *    → 注入したキーを控え、衝突の報告（ownKeyShadow）から外す（`getInjectedKeys`）。
 *    私有判定そのものは innerState が「部分規則が覆うキー」を静的に除くので、ここには依らない。
 *
 * どちらもカスタム要素・オブジェクト値のときだけ記録するので、通常のプロパティ書き込み
 * （textContent / value / checked …）のホットパスには typeof 判定 1 つしか載らない。
 */
const overwrittenObjectByElement = new WeakMap<Element, Map<string, object>>();
const injectedKeysByElement = new WeakMap<Element, Map<string, Set<string>>>();

/** 1 セグメント書き込みで置き換えられる直前のオブジェクトを控える。最初の 1 回だけ（作者のもの）。 */
export function rememberOverwrittenObject(element: Element, prop: string, previous: object): void {
  let byProp = overwrittenObjectByElement.get(element);
  if (!byProp) {
    byProp = new Map();
    overwrittenObjectByElement.set(element, byProp);
  }
  if (!byProp.has(prop)) {
    byProp.set(prop, previous);
  }
}

/** 控えを取り出して消す。無ければ undefined。 */
export function takeOverwrittenObject(element: Element, prop: string): object | undefined {
  const byProp = overwrittenObjectByElement.get(element);
  if (!byProp) {
    return undefined;
  }
  const previous = byProp.get(prop);
  byProp.delete(prop);
  return previous;
}

/** 2 セグメント書き込み（`state.theme`）が作者のオブジェクトに無かったキーを作ったことを控える。 */
export function recordInjectedKey(element: Element, prop: string, key: string): void {
  let byProp = injectedKeysByElement.get(element);
  if (!byProp) {
    byProp = new Map();
    injectedKeysByElement.set(element, byProp);
  }
  let keys = byProp.get(prop);
  if (!keys) {
    keys = new Set();
    byProp.set(prop, keys);
  }
  keys.add(key);
}

export function getInjectedKeys(element: Element, prop: string): ReadonlySet<string> | undefined {
  return injectedKeysByElement.get(element)?.get(prop);
}
