import { openCoreDb } from "./db.js";
import { domainsApi } from "./domains.js";
import { addressesApi } from "./addresses.js";
import { tokensApi } from "./tokens.js";
import { routesApi } from "./routes.js";
import { delegationsApi } from "./delegations.js";
import { keyCacheApi } from "./keycache.js";

export function createCoreStore({ path }) {
  const db = openCoreDb(path);
  const domains = domainsApi(db);
  const addresses = addressesApi(db, domains);
  const tokens = tokensApi(db);
  const routes = routesApi(db);
  const delegations = delegationsApi(db);
  const keys = keyCacheApi(db);

  return {
    domains,
    addresses,
    tokens,
    routes,
    delegations,
    keys,
    raw: db,
    close: () => db.close(),
  };
}
