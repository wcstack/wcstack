export type CommandSubscriber = (...args: unknown[]) => unknown;

export interface ICommandToken {
  readonly name: string;
  readonly size: number;
  subscribe(fn: CommandSubscriber): () => void;
  unsubscribe(fn: CommandSubscriber): boolean;
  emit(...args: unknown[]): unknown[];
}
