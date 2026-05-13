import { assertContract } from "./contract.js";
import { createLocalBlobsStore } from "./local/index.js";
import { createRemoteBlobsStore } from "./remote/index.js";

export function createBlobsStore({
  driver,
  dbPath,
  dataRoot,
  maxSize,
  url,
  token,
}) {
  switch (driver) {
    case "local":
      return assertContract(
        createLocalBlobsStore({ dbPath, dataRoot, maxSize }),
      );
    case "remote":
      return assertContract(createRemoteBlobsStore({ url, token }));
    default:
      throw new Error(`unknown blobs driver: ${driver}`);
  }
}
