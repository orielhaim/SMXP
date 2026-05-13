import { openapi } from "@elysia/openapi";
import { Elysia, t } from "elysia";
import config from "../config.js";
import { coreStore, messagesStore, blobsStore } from "../store/index.js";
import { adminRoutes } from "./admin.js";
import { handleDelegateSend } from "./delegate-send.js";
import { handleReceive } from "./receive.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { blobsRoutes } from "./routes/blobs.js";
import { delegationsRoutes } from "./routes/delegations.js";
import { mailRoutes } from "./routes/mail.js";
import { streamRoutes } from "./routes/stream.js";

function serverKeyHandler(domain) {
  const d = domain.trim().toLowerCase();
  const keys = coreStore().domains.keys(d);
  if (!keys) {
    return new Response(JSON.stringify({ error: "domain not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return {
    public_key: keys.public_key,
    key_id: keys.key_id,
    algorithm: keys.algorithm,
  };
}

export function createApp() {
  // Warm-up: ensure stores are initialized
  coreStore();
  messagesStore();
  blobsStore();

  return new Elysia()
    .use(
      openapi({
        exclude: {
          staticFile: false,
        },
        documentation: {
          info: {
            title: "SMXP API",
            version: "1.0.0",
            description: "Simple Message eXchange Protocol",
          },
          tags: [
            { name: "Auth", description: "Session and API key management" },
            {
              name: "Mail",
              description: "Send, receive, and manage messages",
            },
            {
              name: "Account",
              description: "Account info, password, and sessions",
            },
            {
              name: "Delegations",
              description: "Grant and manage delegations",
            },
            { name: "Stream", description: "Real-time SSE message stream" },
            { name: "Blobs", description: "Store and retrieve blobs" },
            {
              name: "Admin",
              description: "Server administration (requires admin secret)",
            },
            {
              name: "Protocol",
              description: "Federation protocol endpoints (server-to-server)",
            },
          ],
        },
      }),
    )

    .use(authRoutes())
    .use(mailRoutes())
    .use(accountRoutes())
    .use(delegationsRoutes())
    .use(streamRoutes())
    .use(blobsRoutes())
    .use(adminRoutes())
    .post("/.smxp/receive", ({ request }) => handleReceive(request), {
      detail: { tags: ["Protocol"], summary: "Receive inbound envelope" },
    })

    .post(
      "/.smxp/delegate-send",
      ({ request }) => handleDelegateSend(request),
      {
        detail: {
          tags: ["Protocol"],
          summary: "Receive a signed delegated-send request",
        },
      },
    )

    .get(
      "/.smxp/server-key/:domain",
      ({ params }) => serverKeyHandler(params.domain),
      {
        params: t.Object({ domain: t.String() }),
        detail: {
          tags: ["Protocol"],
          summary: "Fetch this server's public key for a domain",
        },
      },
    )

    .get(
      "/.smxp/health",
      () => ({
        status: "ok",
        domains: coreStore()
          .domains.all()
          .map((d) => d.domain),
        port: config.port,
      }),
      { detail: { tags: ["Protocol"], summary: "Health check" } },
    );
}

export function startServer() {
  const app = createApp().listen({ hostname: config.host, port: config.port });
  const domains = coreStore()
    .domains.all()
    .map((d) => d.domain);
  const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;

  console.log(
    `[SMXP] Listening on ${config.host}:${config.port} | domains: ${domains.join(", ") || "(none)"}`,
  );
  console.log(
    `[SMXP] OpenAPI UI → http://${displayHost}:${config.port}/openapi`,
  );

  return app;
}
