import { State } from "./components/State";
import { IStateElement } from "./components/types";
import { config } from "./config";

export async function waitForStateInitialize(root: Document | Element | DocumentFragment): Promise<void> {
  const elements = root.querySelectorAll(config.tagNames.state);
  const promises: Promise<void>[] = [];
  await customElements.whenDefined(config.tagNames.state);
  for(const element of elements) {
    const stateElement = element as State as IStateElement;
    promises.push(stateElement.initializePromise);
  }
  await Promise.all(promises);
}
