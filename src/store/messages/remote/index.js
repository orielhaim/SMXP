import { smxpFetch } from "../../../shared/fetch.js";

function endpoint(base, path) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function createRemoteMessagesStore({ url, token = null }) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};

  return {
    async store(envelope, direction, deliveredTo) {
      await smxpFetch
        .post(endpoint(url, "/store"), {
          headers,
          json: { envelope, direction, deliveredTo },
        })
        .json();
    },

    async exists(id, direction = "in") {
      const r = await smxpFetch
        .post(endpoint(url, "/exists"), { headers, json: { id, direction } })
        .json();
      return !!r.exists;
    },

    async query(address, params = {}) {
      return await smxpFetch
        .post(endpoint(url, "/query"), { headers, json: { address, params } })
        .json();
    },

    markConversationRead() {
      throw new Error("remote messages store does not support read status");
    },

    applyReceipt() {
      throw new Error("remote messages store does not support receipts");
    },

    getConversationMeta() {
      throw new Error("remote messages store does not support read status");
    },

    unreadCount() {
      throw new Error("remote messages store does not support read status");
    },
  };
}
