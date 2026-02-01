import { State } from "./components/State";
import { IStateElement } from "./components/types";
import { config } from "./config";

export async function waitForStateInitialize(): Promise<void> {
  const elements = document.querySelectorAll(config.tagNames.state);
  const promises: Promise<void>[] = [];
  for(const element of elements) {
    const stateElement = element as State as IStateElement;
    promises.push(stateElement.initializePromise);
  }
  await Promise.all(promises);
}
