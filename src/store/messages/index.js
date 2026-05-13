import { assertContract } from "./contract.js";
import { createLocalMessagesStore } from "./local/index.js";
import { createRemoteMessagesStore } from "./remote/index.js";

export function createMessagesStore({ driver, path, url, token }) {
  switch (driver) {
    case "local":
      return assertContract(createLocalMessagesStore({ path }));
    case "remote":
      if (!url) throw new Error("messages.url required for remote driver");
      return assertContract(createRemoteMessagesStore({ url, token }));
    default:
      throw new Error(`unknown messages driver: ${driver}`);
  }
}
