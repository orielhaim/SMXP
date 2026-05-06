import { Elysia } from "elysia";
import config from "../config.js";
import { getDb } from "../store/db.js";
import { handleReceive } from "./receive.js";
import { handleKeysRequest } from "./keys-endpoint.js";

export function handleServerKeyRequest() {
  const db = getDb(config.dbPath);
  const publicKey = db.query(`SELECT value FROM server_config WHERE key = ?`).get("server_public_key");
  const keyId = db.query(`SELECT value FROM server_config WHERE key = ?`).get("server_key_id");
  const algorithm = db.query(`SELECT value FROM server_config WHERE key = ?`).get("server_algorithm");

  if (!publicKey || !keyId) {
    return new Response(JSON.stringify({ error: "server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      public_key: publicKey.value,
      key_id: keyId.value,
      algorithm: algorithm?.value || "ML-DSA-65",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function createServerApp() {
  return new Elysia()
    .post("/.smxp/receive", ({ request }) => handleReceive(request))
    .get("/.well-known/smxp/keys/:alias", ({ params }) => handleKeysRequest(params.alias))
    .get("/.smxp/server-key", () => handleServerKeyRequest())
    .get("/.smxp/health", () => ({
      status: "ok",
      domain: config.domain,
      port: config.port,
    }));
}

export function startServer() {
  const app = createServerApp().listen({
    hostname: config.host,
    port: config.port,
  });

  console.log(`[SMXP] Server listening on ${config.host}:${config.port} for domain ${config.domain}`);
  return app;
}
