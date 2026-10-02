import { IState } from "../types";


/**
 * `state="<id>"`: the state is the JSON of `<script type="application/json" id="<id>">`.
 *
 * A parse failure is not wrapped: the SyntaxError of `JSON.parse` propagates as is, and the
 * element rejects connectedCallbackPromise with that same object.
 *
 * The script is looked up in the document (`document.getElementById`), never inside a shadow
 * root: a script beside the element in a shadow root is not found. No such script (a missing id,
 * one only inside a shadow root, or a script of another type) is not a failure in 3.x: the
 * element warns once and initializes with an empty state (README, `connectedCallbackPromise`).
 * 4.0 searches the element's own root first, then the document, and rejects only when the id
 * is missing in both — so the warning makes no claim about 4.0.
 */
export function loadFromScriptJson(id: string): IState {
  const script = document.getElementById(id) as HTMLScriptElement;
  if (script && script.type === 'application/json') {
    return JSON.parse(script.textContent || '{}');
  }
  console.warn(`[@wcstack/state] state="${id}": no <script type="application/json" id="${id}"> in the document (3.x does not look inside shadow roots), so the state starts empty.`);
  return {};
}
