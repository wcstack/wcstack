
export function raiseError(message: string): never {
  throw new Error(`[wc-router] ${message}`);
}