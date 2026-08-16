import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { IAbsolutePathInfo } from "../address/types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { IBindingInfo } from "../binding/types";
import { getBindingSession } from "../bindings/BindingSession";
import { config } from "../config";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { getStateElementByWebComponent, setOuterStateElementByWebComponent } from "./stateElementByWebComponent";

export interface IMappingRule {
  innerAbsPathInfo: IAbsolutePathInfo;
  outerAbsPathInfo: IAbsolutePathInfo;
}

const innerMappingByElement: WeakMap<Element, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const outerMappingByElement: WeakMap<Element, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const primaryMappingRuleSetByElement: WeakMap<Element, Set<IMappingRule>> = new WeakMap();
const primaryBindingByMappingRule: WeakMap<IMappingRule, IBindingInfo> = new WeakMap();

function createMappingRuleByBinding(innerState: IStateElement, binding: IBindingInfo): IMappingRule {
  const innerPathInfo = getPathInfo(binding.propSegments.slice(1).join(DELIMITER));
  const innerAbsPathInfo = getAbsolutePathInfo(innerState, innerPathInfo);
  const outerAbsStateAddress = getAbsoluteStateAddressByBinding(binding);
  const outerAbsPathInfo  = outerAbsStateAddress.absolutePathInfo;
  return { innerAbsPathInfo, outerAbsPathInfo };
}

export function buildPrimaryMappingRule(webComponent: Element, stateName: string, bindings: IBindingInfo[]): void {
  if (bindings.length === 0) {
    return;
  }
  const innerState = getStateElementByWebComponent(webComponent, stateName);
  if (innerState === null) {
    raiseError('State element not found for web component.');
  }
  const innerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  const outerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  for (const binding of bindings) {
    const mappingRule = createMappingRuleByBinding(innerState, binding);
    let primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
    if (typeof primaryMappingRuleSet === 'undefined') {
      primaryMappingRuleSetByElement.set(webComponent, new Set([mappingRule]));
    } else {
      primaryMappingRuleSet.add(mappingRule);
    }
    const innerAbsPathInfo = mappingRule.innerAbsPathInfo;
    const outerAbsPathInfo = mappingRule.outerAbsPathInfo;
    primaryBindingByMappingRule.set(mappingRule, binding);
    innerMappingRule.set(innerAbsPathInfo, outerAbsPathInfo);
    outerMappingRule.set(outerAbsPathInfo, innerAbsPathInfo);
    // 1 つ外のスコープへのリンク。Δ の境界越え合成（§1.12）が引く。
    // プライマリ規則はすべて同じホスト要素の data-wcs 由来なので、どの規則から
    // 採っても同じスコープを指す。
    setOuterStateElementByWebComponent(webComponent, outerAbsPathInfo.stateElement);
  }
  innerMappingByElement.set(webComponent, innerMappingRule);
  outerMappingByElement.set(webComponent, outerMappingRule);
}

/**
 * プライマリ規則だけを残して、遅延導出された派生規則の memo を捨てる（§1.9）。
 *
 * 派生規則は導出と同時に「親スコープの購読者」を立てる。その購読者は子の切断で
 * teardown されるが、memo は要素をキーに残り続けるため、再接続後は**導出が二度と
 * 走らず購読者も張り直されない** — 親がサブパスへ書いても子に届かなくなる。
 * リスト行の content 再利用で実際に踏む（行を差し替えると、その行の子だけが
 * 以後の行フィールド書き込みを受け取れない）。
 *
 * `buildPrimaryMappingRule` は再バインド時に同じことをしている（台帳を作り直す）。
 * 再接続では bindWebComponent が走らないので、ここで同じ状態に戻す。
 */
export function resetDerivedMappingRules(webComponent: Element): void {
  const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
  if (typeof primaryMappingRuleSet === 'undefined') {
    return;
  }
  const innerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  const outerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  for (const rule of primaryMappingRuleSet) {
    innerMappingRule.set(rule.innerAbsPathInfo, rule.outerAbsPathInfo);
    outerMappingRule.set(rule.outerAbsPathInfo, rule.innerAbsPathInfo);
  }
  innerMappingByElement.set(webComponent, innerMappingRule);
  outerMappingByElement.set(webComponent, outerMappingRule);
}

/**
 * このコンポーネントに張られたプライマリ規則の**内側パス**を列挙する。
 *
 * 切断 → 再接続を跨いだ子（行 content の再利用で起きる）は、切断中に親で起きた変更の
 * 通知を受け取れていない。再接続時に「束ねているパスを読み直せ」と撃つための入力で、
 * 何が変わったかは分からないのでプライマリ規則の粒度で丸ごと読み直す（§1.9）。
 */
export function getPrimaryInnerPaths(webComponent: Element): string[] {
  const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
  if (typeof primaryMappingRuleSet === 'undefined') {
    return [];
  }
  const paths: string[] = [];
  for (const rule of primaryMappingRuleSet) {
    paths.push(rule.innerAbsPathInfo.pathInfo.path);
  }
  return paths;
}

export function getInnerAbsolutePathInfo(webComponent: Element, outerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null {
  const mapping = outerMappingByElement.get(webComponent);
  if (typeof mapping === 'undefined') {
    return null;
  }
  return mapping.get(outerAbsPathInfo) ?? null;
}

/**
 * 内側のパスを外側のパスへ翻訳する。規則が無ければプライマリ規則から導出する。
 *
 * `registerSubscriber` は導出に**副作用を持たせるか**の切り替え。既定（子の read /
 * write からの呼び出し）では導出した規則を台帳に memo し、対応するバインディングを
 * 親スコープの購読者として登録する。`false` を渡すと**参照専用**になり、台帳にも
 * 購読者にも触れない。
 *
 * 参照専用が要るのは、バインディング登録の最中（`BindingSession.registerAddress` →
 * `setPathInfo` / 行の相乗り登録）に翻訳だけしたい場合。ここで購読者登録まで走ると
 * `session.initialize` がセッション操作の内側から再入する。
 *
 * 参照専用の結果を台帳に memo しないのは、後から来た**本物の read が memo に当たって
 * 購読者登録を永久に飛ばしてしまう**ため。導出のやり直しは初回だけで、以降は本物の
 * read が張った memo に当たる（行 2 本目以降の登録は先頭行の read が埋めた台帳を引く）。
 */
export function getOuterAbsolutePathInfo(
  webComponent: Element,
  innerAbsPathInfo: IAbsolutePathInfo,
  registerSubscriber: boolean = true,
): IAbsolutePathInfo | null {
  let innerMapping = innerMappingByElement.get(webComponent);
  if (typeof innerMapping === 'undefined') {
    innerMapping = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
    innerMappingByElement.set(webComponent, innerMapping);
  }
  if (innerMapping.has(innerAbsPathInfo)) {
    return innerMapping.get(innerAbsPathInfo)!
  }
  let outerMapping = outerMappingByElement.get(webComponent);
  if (typeof outerMapping === 'undefined') {
    outerMapping = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
    outerMappingByElement.set(webComponent, outerMapping);
  }
  // 内側からのアクセスの場合、ルールがなければプライマリルールから新たにルールとバインディングを生成する
  const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
  if (typeof primaryMappingRuleSet === 'undefined') {
    // マッピングルールが存在しない場合はnullを返し、ローカル状態へのフォールバックを許可する
    return null;
  }
  let primaryMappingRule: IMappingRule | null = null;
  for(const currentPrimaryMappingRule of primaryMappingRuleSet) {
    // innerPathInfoがprimaryMappingRuleのinnerPathInfoを包含しているか
    if (!innerAbsPathInfo.pathInfo.cumulativePathInfoSet.has(currentPrimaryMappingRule.innerAbsPathInfo.pathInfo)) {
      continue;
    }
    if (currentPrimaryMappingRule.innerAbsPathInfo.pathInfo.segments.length === innerAbsPathInfo.pathInfo.segments.length) {
      raiseError('Duplicate mapping rule for web component.');
    }
    primaryMappingRule = currentPrimaryMappingRule;
    break;
  }
  if (primaryMappingRule === null) {
    // マッピングルールに一致しない場合はnullを返し、ローカル状態へのフォールバックを許可する
    return null;
  }
  // マッチした残りのパスをouterPathInfoに付与して新たなルールを生成
  const primaryBinding = primaryBindingByMappingRule.get(primaryMappingRule);
  /* c8 ignore start */
  if (typeof primaryBinding === 'undefined') {
    raiseError('Binding not found for primary mapping rule on web component.');
  }
  /* c8 ignore stop */
  const outerRemainingSegments = innerAbsPathInfo.pathInfo.segments.slice(primaryMappingRule.innerAbsPathInfo.pathInfo.segments.length);
  const outerSegments = primaryMappingRule.outerAbsPathInfo.pathInfo.segments.concat(outerRemainingSegments);
  const outerPathInfo = getPathInfo(outerSegments.join(DELIMITER));
  const rootNode = webComponent.getRootNode() as Node;
  const outerStateElement = getStateElementByName(rootNode, primaryBinding.stateName);
  if (outerStateElement === null) {
    raiseError(`State element with name "${primaryBinding.stateName}" not found for web component.`);
  }
  const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
  if (!registerSubscriber) {
    // 参照専用: 台帳にも購読者にも触れず、翻訳結果だけ返す
    return outerAbsPathInfo;
  }
  innerMapping.set(innerAbsPathInfo, outerAbsPathInfo);
  outerMapping.set(outerAbsPathInfo, innerAbsPathInfo);

  // ルールに対応するバインディングを生成し、親スコープの購読者として登録する。
  //
  // 子が読んだサブパス（inner "user.name" ＝ outer "person.name"）は、子が
  // そのパスに関心を宣言したということ。親がそこへ書いたときに子へ再読込通知が
  // 届くよう、プライマリと同じ形のバインディングを立てて絶対アドレス台帳に載せる。
  //
  // propSegments は stateProp（プライマリの先頭セグメント）を保つ必要がある。
  // 適用側は先頭セグメントで束ね先の state 要素を引く（apply/applyChangeToWebComponent.ts）
  // ため、inner パスだけにすると通知先を解決できない。
  //
  // 登録はプライマリを所有する BindingSession 経由で行う。台帳登録・teardown・
  // ノード削除時の破棄（MutationObserver 配送）が既存のライフサイクルにそのまま乗り、
  // 絶対アドレス台帳のエントリが component を強参照したまま残るのを防ぐ。
  // node 台帳（addBindingByNode）へは積まない — stateProp を保った結果、
  // 再バインド時に buildPrimaryMappingRule のプライマリ抽出フィルタへ混入するため。
  const propSegments = [primaryBinding.propSegments[0], ...innerAbsPathInfo.pathInfo.segments];
  const newBinding: IBindingInfo = {
    ...primaryBinding,
    propName: propSegments.join(DELIMITER),
    propSegments,
    statePathName: outerAbsPathInfo.pathInfo.path,
    statePathInfo: outerAbsPathInfo.pathInfo,
  }
  // 登録できないケースは登録だけ諦める。ここは翻訳が本務なので read を落とさない
  // ＝ この機構が入る前と同じ挙動に留める（debug 時のみ観測可能にする）。2 通りある。
  //
  // (a) セッションが引けない: 内部的な想定外（プライマリは親スコープの収集で必ず
  //     session.initialize を通っている）。
  // (b) 導出した outer パスがワイルドカードを含むのに listIndex が決まらない:
  //     子が配列マッピングの上で for を回している場合（規則 state.items: rows に対し
  //     子の行が items.*.name を読む → outer は rows.*.name）。派生バインディングの
  //     node は親スコープにあるコンポーネント要素で、ループは子の Shadow 内なので
  //     コンポーネントからは行を特定できない ＝ この 1 本では行を表現できない。
  //     ここで登録を試みると getAbsoluteStateAddressByBinding が raiseError する。
  //     この形の親→子配送は派生バインディングではなく、子の行バインディング自身を
  //     親のパターン台帳（(absolutePathInfo, listIndex)）へ相乗りさせて成立させる
  //     （BindingSession.registerAddress / webComponent/outerListPath.ts、§1.8）。
  const skipRegistration = (reason: string): void => {
    if (config.debug) {
      console.warn(`parent→child notification for "${outerAbsPathInfo.pathInfo.path}" is not registered: ${reason}.`, { webComponent, primaryBinding });
    }
  };
  const session = getBindingSession(primaryBinding);
  if (session === null) {
    skipRegistration('no binding session for the primary mapping rule');
    return outerAbsPathInfo;
  }
  if (outerAbsPathInfo.pathInfo.wildcardCount > 0 && getListIndexByBindingInfo(newBinding) === null) {
    skipRegistration('the derived outer path is a wildcard path but no list index resolves from the component');
    return outerAbsPathInfo;
  }
  // 戻り値（初期 apply 対象）は使わない。この導出は子の read の最中に起きるので、
  // 子は既に最新値を読んでおり、ここでの再通知は冗長かつ再入になる。
  session.initialize([newBinding], { registerAddress: true });

  return outerAbsPathInfo;
}