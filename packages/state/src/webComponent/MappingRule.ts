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
import { getStateElementByWebComponent } from "./stateElementByWebComponent";

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
  }
  innerMappingByElement.set(webComponent, innerMappingRule);
  outerMappingByElement.set(webComponent, outerMappingRule);
}

export function getInnerAbsolutePathInfo(webComponent: Element, outerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null {
  const mapping = outerMappingByElement.get(webComponent);
  if (typeof mapping === 'undefined') {
    return null;
  }
  return mapping.get(outerAbsPathInfo) ?? null;
}

export function getOuterAbsolutePathInfo(webComponent: Element, innerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null {
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
  //     コンポーネントからは行を特定できない。この形の親→子配送は元から成立して
  //     おらず（子側の for が初期化されない）、ここで登録を試みると
  //     getAbsoluteStateAddressByBinding が raiseError して無言の不成立が例外に化ける。
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