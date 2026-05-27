
export function raiseError(message: string, options?: { cause?: unknown }): never {
  if (options && 'cause' in options) {
    throw new Error(`[@wcstack/router] ${message}`, { cause: options.cause });
  }
  throw new Error(`[@wcstack/router] ${message}`);
}