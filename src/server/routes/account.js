import { Elysia, t } from "elysia";
import { hashPassword, verifyPassword } from "../../crypto/password.js";
import { getAddress } from "../../store/addresses.js";
import { getDb } from "../../store/db.js";
import { deleteToken, getTokensByAlias } from "../../store/tokens.js";
import { authenticate, maybeRefreshToken } from "../auth.js";

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function authedResponse(body, authInfo, status = 200) {
  const headers = { "Content-Type": "application/json" };
  maybeRefreshToken(headers, authInfo);
  return new Response(JSON.stringify(body), { status, headers });
}

export function accountRoutes() {
  return new Elysia({ prefix: "/.smxp/account" })

    .get("/info", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const address = getAddress(authInfo.domain, authInfo.alias);
      if (!address) return jsonResponse({ error: "address not found" }, 404);

      return authedResponse(
        {
          alias: address.alias,
          domain: address.domain,
          address: `${address.alias}@${address.domain}`,
          mode: address.mode,
          public_key: address.public_key,
          key_id: address.key_id,
          algorithm: address.algorithm,
          created_at: address.created_at,
        },
        authInfo,
      );
    })

    .put(
      "/password",
      async ({ request, body }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const address = getAddress(authInfo.domain, authInfo.alias);
        if (!address) return jsonResponse({ error: "address not found" }, 404);

        const valid = await verifyPassword(
          body.current_password,
          address.password_hash,
        );
        if (!valid) {
          return jsonResponse({ error: "current password is incorrect" }, 403);
        }

        const newHash = await hashPassword(body.new_password);
        const db = getDb();
        db.run(
          `UPDATE addresses SET password_hash = ? WHERE alias = ? AND domain = ?`,
          [newHash, authInfo.alias, authInfo.domain],
        );

        return authedResponse({ status: "password_changed" }, authInfo);
      },
      {
        body: t.Object({
          current_password: t.String({ minLength: 1 }),
          new_password: t.String({ minLength: 1 }),
        }),
      },
    )

    .get("/sessions", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const sessions = getTokensByAlias(
        authInfo.alias,
        authInfo.domain,
        "session",
      );

      const mapped = sessions.map((s) => ({
        ...s,
        current: s.id === authInfo.tokenId,
      }));

      return authedResponse({ sessions: mapped }, authInfo);
    })

    .delete("/sessions/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      if (params.id === authInfo.tokenId) {
        return jsonResponse(
          { error: "cannot revoke current session, use logout" },
          400,
        );
      }

      const db = getDb();
      const row = db
        .query(
          `SELECT id FROM tokens
           WHERE id = ? AND alias = ? AND domain = ? AND type = 'session'`,
        )
        .get(params.id, authInfo.alias, authInfo.domain);

      if (!row) return jsonResponse({ error: "session not found" }, 404);

      deleteToken(params.id);
      return authedResponse({ status: "revoked", id: params.id }, authInfo);
    });
}
