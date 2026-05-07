import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import config from "../config.js";
import { signObject } from "../crypto/sign.js";
import { getAddress } from "../store/addresses.js";
import { getDb } from "../store/db.js";
import { getDelegationByDelegate } from "../store/delegations.js";
import { getAllDomains } from "../store/domains.js";
import { ensureServerKeys } from "../store/server-config.js";
import { adminRoutes } from "./admin.js";
import { handleReceive } from "./receive.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { delegationsRoutes } from "./routes/delegations.js";
import { mailRoutes } from "./routes/mail.js";
import { streamRoutes } from "./routes/stream.js";

// ── Protocol endpoint handlers ────────────────────────────────────────────────

function serverKeyHandler() {
  const { public_key, key_id, algorithm } = ensureServerKeys();
  return { public_key, key_id, algorithm };
}

function keysHandler(domain, alias) {
  const d = domain.trim().toLowerCase();
  const a = alias.trim().toLowerCase();
  const address = getAddress(d, a);

  if (!address || address.mode !== "inbox") {
    return new Response(JSON.stringify({ error: "inbox address not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = getDb();
  const serverKey = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_secret_key");
  const serverKeyId = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_key_id");

  if (!serverKey || !serverKeyId) {
    return new Response(JSON.stringify({ error: "server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    alias: a,
    domain: d,
    public_key: address.public_key,
    key_id: address.key_id,
    algorithm: address.algorithm,
  };

  return {
    ...payload,
    server_signature: signObject(payload, serverKey.value),
    server_key_id: serverKeyId.value,
  };
}

function delegationsHandler(request, domain) {
  const url = new URL(request.url);
  const alias = url.searchParams.get("alias");
  const delegate = url.searchParams.get("delegate");

  if (!alias || !delegate) {
    return new Response(
      JSON.stringify({ error: "alias and delegate query params are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const d = domain.trim().toLowerCase();
  const a = alias.trim().toLowerCase();
  const address = getAddress(d, a);

  if (!address || address.mode !== "inbox") {
    return new Response(JSON.stringify({ error: "inbox address not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const delegation = getDelegationByDelegate(d, a, delegate);
  if (!delegation) {
    return new Response(JSON.stringify({ error: "delegation not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (delegation.expires_at !== null && delegation.expires_at < now) {
    return new Response(JSON.stringify({ error: "delegation expired" }), {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    alias: a,
    domain: d,
    delegate: delegation.delegate,
    scope: delegation.scope,
    created_at: delegation.created_at,
    expires_at: delegation.expires_at,
  };

  return {
    ...payload,
    signature: signObject(payload, address.secret_key),
    key_id: address.key_id,
  };
}

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp() {
  return (
    new Elysia()
      .use(
        swagger({
          // Paths like /.smxp/* and /.well-known/* contain dots — disable the
          // static-file exclusion heuristic so they appear in the OpenAPI spec.
          excludeStaticFile: false,
          documentation: {
            info: {
              title: "SMXP API",
              version: "1.0.0",
              description:
                "Simple Message eXchange Protocol — server API and federation protocol endpoints",
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
                description: "Grant and manage send/read delegations",
              },
              { name: "Stream", description: "Real-time SSE message stream" },
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

      // ── User-facing routes ────────────────────────────────────────────────
      .use(authRoutes())
      .use(mailRoutes())
      .use(accountRoutes())
      .use(delegationsRoutes())
      .use(streamRoutes())

      // ── Admin routes ──────────────────────────────────────────────────────
      .use(adminRoutes())

      // ── Federation / protocol endpoints ───────────────────────────────────
      .post("/.smxp/receive", ({ request }) => handleReceive(request), {
        detail: {
          tags: ["Protocol"],
          summary: "Receive an inbound message envelope",
        },
      })

      .get(
        "/.well-known/smxp/keys/:domain/:alias",
        ({ params }) => keysHandler(params.domain, params.alias),
        {
          params: t.Object({ domain: t.String(), alias: t.String() }),
          detail: {
            tags: ["Protocol"],
            summary: "Fetch the public signing key for an address",
          },
        },
      )

      .get(
        "/.well-known/smxp/delegations/:domain",
        ({ request, params }) => delegationsHandler(request, params.domain),
        {
          params: t.Object({ domain: t.String() }),
          detail: {
            tags: ["Protocol"],
            summary: "Fetch a signed delegation record",
          },
        },
      )

      // ── Meta endpoints ────────────────────────────────────────────────────
      .get("/.smxp/server-key", () => serverKeyHandler(), {
        detail: {
          tags: ["Protocol"],
          summary: "Fetch this server's public key",
        },
      })

      .get(
        "/.smxp/health",
        () => ({
          status: "ok",
          domains: getAllDomains().map((d) => d.domain),
          port: config.port,
        }),
        { detail: { tags: ["Protocol"], summary: "Health check" } },
      )
  );
}

export function startServer() {
  const app = createApp().listen({ hostname: config.host, port: config.port });

  const domains = getAllDomains().map((d) => d.domain);
  const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;

  console.log(
    `[SMXP] Listening on ${config.host}:${config.port} — domains: ${domains.join(", ") || "(none)"}`,
  );
  console.log(
    `[SMXP] Swagger UI → http://${displayHost}:${config.port}/swagger`,
  );

  return app;
}
