
let count = 0;
export function getUUID(): string {
  return `u${(count++).toString(36)}`;
}
