import { isLightDomMappedStateElement } from "./bindings/lightDomComponentScope";
import { State } from "./components/State";
import { IStateElement } from "./components/types";
import { config } from "./config";
import { getCustomElementRegistry } from "./platform/customElementRegistry";
import { raiseError } from "./raiseError";

export async function waitForStateInitialize(root: Document | Element | DocumentFragment): Promise<void> {
  const elements = root.querySelectorAll(config.tagNames.state);
  const promises: Promise<void>[] = [];
  const registry = getCustomElementRegistry(root);
  if (registry === null) {
    // null レジストリのサブツリーでは <wcs-state> が upgrade されないので
    // initializePromise が生えず、待っても永久に初期化されない。
    raiseError(`CustomElementRegistry is unavailable for <${config.tagNames.state}>.`);
  }
  await registry.whenDefined(config.tagNames.state);
  for(const element of elements) {
    // Light DOM の mapped コンポーネントの state は待たない。それはこの root の
    // バインディングが張られてからでないと初期化できず（自分を束ねるホスト binding を
    // 待つ）、ここで待つと循環する（§1.13）。Shadow DOM 形では別 rootNode にいるので
    // そもそもこの集合に現れず、plain 形は循環しないので従来どおり待つ。
    if (isLightDomMappedStateElement(element)) {
      continue;
    }
    const stateElement = element as State as IStateElement;
    promises.push(stateElement.initializePromise);
  }
  await Promise.all(promises);
}
