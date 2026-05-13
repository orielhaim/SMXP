import { createCoreStore } from "./core/index.js";
import { createMessagesStore } from "./messages/index.js";
import { createBlobsStore } from "./blobs/index.js";
import config from "../config.js";

let core = null;
let messages = null;
let blobs = null;

export function coreStore() {
  if (!core) core = createCoreStore(config.core);
  return core;
}

export function messagesStore() {
  if (!messages) messages = createMessagesStore(config.messages);
  return messages;
}

export function blobsStore() {
  if (!blobs) blobs = createBlobsStore(config.blobs);
  return blobs;
}

export function closeStores() {
  core?.close?.();
  messages?.close?.();
  blobs?.close?.();
  core = messages = blobs = null;
}
