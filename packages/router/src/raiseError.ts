
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/router] ${message}`);
}