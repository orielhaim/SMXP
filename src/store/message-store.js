/**
 * MessageStore contract.
 *
 * Implementations must expose:
 * - store(envelope, direction, deliveredTo): persist a normalized envelope.
 * - exists(id, direction): return whether a message exists in that direction.
 * - query(address, params): return { messages, cursors } for the address.
 *
 * query params may include id, thread, direction, since_id, limit, after, before.
 * Unknown params are store-specific filters. The built-in store ignores them.
 */
export const MESSAGE_STORE_METHODS = Object.freeze([
  "store",
  "exists",
  "query",
]);

export function assertMessageStore(store) {
  for (const method of MESSAGE_STORE_METHODS) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`Message store is missing ${method}()`);
    }
  }

  return store;
}
