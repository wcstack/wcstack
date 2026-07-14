import { IContent } from "../structural/types";
import type { BindingSession } from "./BindingSession";

const bindingSessionByContent = new WeakMap<IContent, BindingSession>();

export function getBindingSessionByContent(content: IContent): BindingSession | null {
  return bindingSessionByContent.get(content) ?? null;
}

export function setBindingSessionByContent(content: IContent, session: BindingSession): void {
  bindingSessionByContent.set(content, session);
}
