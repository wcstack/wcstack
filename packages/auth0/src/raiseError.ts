export function raiseError(message: string): never {
  throw new Error(`[@wcstack/auth0] ${message}`);
}
