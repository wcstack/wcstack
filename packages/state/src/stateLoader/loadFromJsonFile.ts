import { raiseError } from "../raiseError";
import { IState } from "../types";

export async function loadFromJsonFile(url: string): Promise<IState> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      raiseError(`Failed to fetch JSON file: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('Failed to load JSON file:', e);
    return {};
  }
}