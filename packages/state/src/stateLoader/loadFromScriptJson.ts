import { raiseError } from "../raiseError";
import { IState } from "../types";


export function loadFromScriptJson(id: string): IState {
  const script = document.getElementById(id) as HTMLScriptElement;
  if (script && script.type === 'application/json') {
    try {
      const data = JSON.parse(script.textContent || '{}');
      return data;
    } catch (e) {
      raiseError('Failed to parse JSON from script element:' + e);
    }
  }
  return {};
}