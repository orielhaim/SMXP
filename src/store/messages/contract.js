/**
 * MessagesStore contract.
 *
 * Methods:
 *   store(envelope, direction, deliveredTo) -> Promise<void>
 *   exists(id, direction) -> Promise<boolean>
 *   query(address, params) -> Promise<{ messages, cursors }>
 *   markConversationRead(address, conversationId, readStatus) -> number
 *   applyReceipt(address, readerAddress, conversationId, upToTimestamp) -> number
 *   getConversationMeta(address, conversationId) -> object | null
 *   unreadCount(address, grouped) -> number | Array
 *   close?() -> void
 *
 * query params: id, thread, direction, since_id, limit, after, before
 */
export const REQUIRED = Object.freeze([
  "store",
  "exists",
  "query",
  "markConversationRead",
  "applyReceipt",
  "getConversationMeta",
  "unreadCount",
]);

export function assertContract(store) {
  for (const m of REQUIRED) {
    if (typeof store?.[m] !== "function") {
      throw new TypeError(`MessagesStore missing method: ${m}()`);
    }
  }
  return store;
}
