import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<string | undefined>();

export function withRequesterSenderId<T>(requesterSenderId: string | undefined, fn: () => T): T {
  const value = requesterSenderId?.trim() || undefined;
  return store.run(value, fn);
}

export function getRequesterSenderId(): string | undefined {
  return store.getStore();
}
