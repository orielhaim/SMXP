import config from "../config.js";
import { assertMessageStore } from "./message-store.js";
import { createBuiltinMessageStore } from "./messages-builtin.js";
import { createExternalMessageStore } from "./messages-external.js";

const messageStore = assertMessageStore(
  config.messageStoreUrl
    ? createExternalMessageStore(config.messageStoreUrl)
    : createBuiltinMessageStore(),
);

export default messageStore;

export const storeMessage = (...args) => messageStore.store(...args);
export const messageExists = (...args) => messageStore.exists(...args);
export const queryMessages = (...args) => messageStore.query(...args);
