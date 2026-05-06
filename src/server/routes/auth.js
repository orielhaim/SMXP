import { Elysia, t } from "elysia";
import { verifyPassword } from "../../crypto/password.js";
import { getAddress } from "../../store/addresses.js";
import {
  createToken,
  deleteToken,
  getTokensByAlias,
} from "../../store/tokens.js";
import { authenticate } from "../auth.js";

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function authRoutes() {
  return new Elysia({ prefix: "/.smxp/auth" })

    .post(
      "/login",
      async ({ body }) => {
        const { alias, domain, password } = body;

        const row = getAddress(domain, alias);
        if (!row?.password_hash) {
          return jsonResponse({ error: "invalid credentials" }, 401);
        }

        const valid = await verifyPassword(password, row.password_hash);
        if (!valid) {
          return jsonResponse({ error: "invalid credentials" }, 401);
        }

        const { token, id } = createToken({
          alias,
          domain,
          type: "session",
        });

        return jsonResponse({
          token,
          token_id: id,
          expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        });
      },
      {
        body: t.Object({
          alias: t.String({ minLength: 1 }),
          domain: t.String({ minLength: 1 }),
          password: t.String({ minLength: 1 }),
        }),
      },
    )

    .post("/logout", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      deleteToken(authInfo.tokenId);
      return jsonResponse({ status: "logged_out" });
    })

    .post(
      "/apikeys",
      async ({ request, body }) => {
        const authInfo = authenticate(request);
        if (!authInfo) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const { name, expires_at } = body;

        const { token, id } = createToken({
          alias: authInfo.alias,
          domain: authInfo.domain,
          type: "apikey",
          name: name || null,
          expiresAt: expires_at || null,
        });

        return jsonResponse(
          {
            token,
            id,
            name: name || null,
            expires_at: expires_at || null,
          },
          201,
        );
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          expires_at: t.Optional(t.Nullable(t.Number())),
        }),
      },
    )

    .get("/apikeys", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      const keys = getTokensByAlias(authInfo.alias, authInfo.domain, "apikey");
      return jsonResponse({ apikeys: keys });
    })

    .delete("/apikeys/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      const deleted = deleteToken(params.id);
      if (!deleted) {
        return jsonResponse({ error: "api key not found" }, 404);
      }

      return jsonResponse({ status: "deleted", id: params.id });
    });
}
