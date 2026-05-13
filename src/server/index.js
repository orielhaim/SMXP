import { openapi } from "@elysia/openapi";
import { Elysia, t } from "elysia";
import config from "../config.js";
import {
  CONTENT_TYPES,
  DISPOSITIONS,
  MESSAGE_TYPES,
} from "../shared/envelope.js";
import { coreStore } from "../store/index.js";
import { adminRoutes } from "./admin.js";
import { DelegateSendError, processDelegateSend } from "./delegate-send.js";
import { DeliveryError } from "./delivery.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { blobsRoutes } from "./routes/blobs.js";
import { delegationsRoutes } from "./routes/delegations.js";
import { mailRoutes } from "./routes/mail.js";
import { processReceive } from "./receive.js";
import { streamRoutes } from "./routes/stream.js";

const EncryptionSchema = t.Object({
  algorithm: t.String(),
  key: t.String(),
  nonce_prefix: t.String(),
  chunk_size: t.Number(),
  plaintext_size: t.Number(),
  plaintext_sha256: t.Optional(t.String()),
});

const AttachmentSchema = t.Object({
  blob_id: t.String(),
  host: t.String(),
  sha256: t.String(),
  size: t.Number(),
  name: t.Optional(t.String()),
  content_type: t.Optional(t.String()),
  disposition: t.Optional(
    t.Union(DISPOSITIONS.map((value) => t.Literal(value))),
  ),
  port: t.Optional(t.Number()),
  download_token: t.Optional(t.String()),
  encryption: t.Optional(EncryptionSchema),
  thumbnail: t.Optional(t.Any()),
});

const EnvelopeSchema = t.Object({
  version: t.String(),
  id: t.String(),
  from: t.String(),
  to: t.String(),
  timestamp: t.Number(),
  conversation_id: t.String(),
  server_signature: t.String(),
  server_key_id: t.String(),
  type: t.Optional(t.Union(MESSAGE_TYPES.map((value) => t.Literal(value)))),
  content_type: t.Optional(
    t.Union(CONTENT_TYPES.map((value) => t.Literal(value))),
  ),
  name: t.Optional(t.String()),
  subject: t.Optional(t.String()),
  body: t.Optional(t.String()),
  in_reply_to: t.Optional(t.String()),
  expires: t.Optional(t.Number()),
  attachments: t.Optional(t.Array(AttachmentSchema)),
});

const DelegateSendSchema = t.Object({
  from: t.String(),
  to: t.String(),
  delegator: t.String(),
  timestamp: t.Number(),
  server_signature: t.String(),
  server_key_id: t.String(),
  name: t.Optional(t.String()),
  subject: t.Optional(t.String()),
  body: t.Optional(t.String()),
  expires: t.Optional(t.Number()),
  type: t.Optional(t.Union(MESSAGE_TYPES.map((value) => t.Literal(value)))),
  conversation_id: t.Optional(t.String()),
  in_reply_to: t.Optional(t.String()),
  content_type: t.Optional(
    t.Union(CONTENT_TYPES.map((value) => t.Literal(value))),
  ),
});

function serverKeyHandler(domain) {
  const d = domain.trim().toLowerCase();
  const keys = coreStore.domains.keys(d);
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
    .post(
      "/.smxp/receive",
      async ({ body, set }) => {
        try {
          set.status = 201;
          return await processReceive(body);
        } catch (err) {
          if (err instanceof DeliveryError) {
            set.status = err.status;
            return { error: err.message };
          }
          set.status = 500;
          return { error: err.message };
        }
      },
      {
        body: EnvelopeSchema,
        detail: { tags: ["Protocol"], summary: "Receive inbound envelope" },
      },
    )

    .post(
      "/.smxp/delegate-send",
      async ({ body, set }) => {
        try {
          set.status = 201;
          return await processDelegateSend(body);
        } catch (err) {
          if (err instanceof DelegateSendError) {
            set.status = err.status;
            return { error: err.message };
          }
          set.status = 500;
          return { error: err.message };
        }
      },
      {
        body: DelegateSendSchema,
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
        domains: coreStore.domains.all().map((d) => d.domain),
        port: config.port,
      }),
      { detail: { tags: ["Protocol"], summary: "Health check" } },
    );
}

export function startServer() {
  const app = createApp().listen({ hostname: config.host, port: config.port });
  const domains = coreStore.domains.all().map((d) => d.domain);
  const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;

  console.log(
    `[SMXP] Listening on ${config.host}:${config.port} | domains: ${domains.join(", ") || "(none)"}`,
  );
  console.log(
    `[SMXP] OpenAPI UI → http://${displayHost}:${config.port}/openapi`,
  );

  return app;
}
