import { Elysia } from "elysia";
import config from "../config.js";
import { getAllDomains } from "../store/domains.js";
import { ensureServerKeys } from "../store/server-config.js";
import {
  adminCreateAlias,
  adminCreateDomain,
  adminDeleteAlias,
  adminDeleteDomain,
  adminGetAlias,
  adminGetDomain,
  adminListAliases,
  adminListDomains,
  adminVerifyDomain,
} from "./admin.js";
import { handleKeysRequest } from "./keys-endpoint.js";
import { handleReceive } from "./receive.js";
import { authRoutes } from "./routes/auth.js";
import { mailRoutes } from "./routes/mail.js";
import { accountRoutes } from "./routes/account.js";

export function handleServerKeyRequest() {
  const serverKeys = ensureServerKeys();

  return new Response(
    JSON.stringify({
      public_key: serverKeys.public_key,
      key_id: serverKeys.key_id,
      algorithm: serverKeys.algorithm,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function createServerApp() {
  return new Elysia()
    .use(authRoutes())
    .use(mailRoutes())
    .use(accountRoutes())
    .post("/.smxp/receive", ({ request }) => handleReceive(request))
    .get("/.well-known/smxp/keys/:domain/:alias", ({ params }) =>
      handleKeysRequest(params.domain, params.alias),
    )
    .get("/.smxp/admin/domains", ({ request }) => adminListDomains(request))
    .post("/.smxp/admin/domains", ({ request }) => adminCreateDomain(request))
    .get("/.smxp/admin/domains/:domain", ({ request, params }) =>
      adminGetDomain(request, params.domain),
    )
    .post("/.smxp/admin/domains/:domain/verify", ({ request, params }) =>
      adminVerifyDomain(request, params.domain),
    )
    .delete("/.smxp/admin/domains/:domain", ({ request, params }) =>
      adminDeleteDomain(request, params.domain),
    )
    .get("/.smxp/admin/aliases", ({ request }) => adminListAliases(request))
    .post("/.smxp/admin/aliases", ({ request }) => adminCreateAlias(request))
    .get("/.smxp/admin/aliases/:domain/:alias", ({ request, params }) =>
      adminGetAlias(request, params.domain, params.alias),
    )
    .delete("/.smxp/admin/aliases/:domain/:alias", ({ request, params }) =>
      adminDeleteAlias(request, params.domain, params.alias),
    )
    .get("/.smxp/server-key", () => handleServerKeyRequest())
    .get("/.smxp/health", () => ({
      status: "ok",
      domains: getAllDomains().map((domain) => domain.domain),
      port: config.port,
    }));
}

export function startServer() {
  const app = createServerApp().listen({
    hostname: config.host,
    port: config.port,
  });

  const domains = getAllDomains().map((domain) => domain.domain);
  console.log(
    `[SMXP] Server listening on localhost:${config.port} for domains ${domains.join(", ") || "(none)"}`,
  );
  return app;
}
