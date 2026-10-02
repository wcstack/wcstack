import { IState } from "../types";

/**
 * `src="*.json"`. A failure to fetch or parse the file is not a failure of the element in 3.x:
 * it is logged (with the URL, and the HTTP status for an error response) and the element
 * initializes with an empty state, so connectedCallbackPromise resolves and a volume grafts `{}`.
 * 4.0 rejects instead (README, `connectedCallbackPromise`).
 */
export async function loadFromJsonFile(url: string): Promise<IState> {
  let detail: unknown;
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.json();
    }
    detail = `HTTP ${response.status} ${response.statusText}`;
  } catch (e) {
    detail = e;
  }
  console.error(`[@wcstack/state] Failed to load JSON file "${url}", so the state starts empty (4.0 rejects instead):`, detail);
  return {};
}
