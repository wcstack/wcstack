import { State } from "./components/State";
import { IStateElement } from "./components/types";
import { config } from "./config";

export function findStateElement(rootElement: Document, stateName: string): IStateElement | null {
  const retElement = rootElement.querySelector<State>(`${config.tagNames.state}[name="${stateName}"]`) as IStateElement | null;
  return retElement;
}