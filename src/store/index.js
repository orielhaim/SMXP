import { createBlobsStore } from "./blob/index.js";
import { createCoreStore } from "./core/index.js";
import { createMessagesStore } from "./messages/index.js";

export let coreStore = null;
export let messagesStore = null;
export let blobsStore = null;

export function init(config) {
  coreStore = createCoreStore(config.core);
  messagesStore = createMessagesStore(config.messages);
  blobsStore = createBlobsStore(config.blobs);
}

export function closeStores() {
  coreStore.close();
  messagesStore.close();
  blobsStore.close();
}
