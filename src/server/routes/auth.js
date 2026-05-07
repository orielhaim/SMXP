import { Elysia, t } from "elysia";
import { verifyPassword } from "../../crypto/password.js";
import { getAddress } from "../../store/addresses.js";
import {
  createToken,
  deleteToken,
  getTokensByAlias,
} from "../../store/tokens.js";
import { withAuth } from "../auth.js";

export function authRoutes() {
  return new Elysia({ prefix: "/.smxp/auth" })
    .use(withAuth())

    .post(
      "/login",
      async ({ body, set }) => {
        const row = getAddress(body.domain, body.alias);
        if (!row?.password_hash) {
          set.status = 401;
          return { error: "invalid credentials" };
        }

        const valid = await verifyPassword(body.password, row.password_hash);
        if (!valid) {
          set.status = 401;
          return { error: "invalid credentials" };
        }

        const { token, id } = createToken({
          alias: body.alias,
          domain: body.domain,
          type: "session",
        });
        return {
          token,
          token_id: id,
          expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        };
      },
      {
        body: t.Object({
          alias: t.String({ minLength: 1 }),
          domain: t.String({ minLength: 1 }),
          password: t.String({ minLength: 1 }),
        }),
        detail: { tags: ["Auth"], summary: "Login and obtain a session token" },
      },
    )

    .post(
      "/logout",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        deleteToken(authInfo.tokenId);
        return { status: "logged_out" };
      },
      { detail: { tags: ["Auth"], summary: "Revoke current session token" } },
    )

    .post(
      "/apikeys",
      ({ authInfo, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const { token, id } = createToken({
          alias: authInfo.alias,
          domain: authInfo.domain,
          type: "apikey",
          name: body.name ?? null,
          expiresAt: body.expires_at ?? null,
        });

        set.status = 201;
        return {
          token,
          id,
          name: body.name ?? null,
          expires_at: body.expires_at ?? null,
        };
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          expires_at: t.Optional(t.Nullable(t.Number())),
        }),
        detail: { tags: ["Auth"], summary: "Create a new API key" },
      },
    )

    .get(
      "/apikeys",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        return {
          apikeys: getTokensByAlias(authInfo.alias, authInfo.domain, "apikey"),
        };
      },
      { detail: { tags: ["Auth"], summary: "List API keys for the authenticated address" } },
    )

    .delete(
      "/apikeys/:id",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        if (!deleteToken(params.id)) {
          set.status = 404;
          return { error: "api key not found" };
        }
        return { status: "deleted", id: params.id };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Auth"], summary: "Delete an API key by ID" },
      },
    );
}
