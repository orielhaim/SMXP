import { Elysia, t } from "elysia";
import { hashPassword, verifyPassword } from "../../crypto/password.js";
import { coreStore } from "../../store/index.js";
import { maybeRefreshToken, withAuth } from "../auth.js";

function unauthorized() {
  return { error: "unauthorized" };
}

export function accountRoutes() {
  return new Elysia({ prefix: "/.smxp/account" })
    .use(withAuth())

    .get(
      "/info",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return unauthorized();
        }

        const address = coreStore.addresses.get(
          authInfo.domain,
          authInfo.alias,
        );
        if (!address) {
          set.status = 404;
          return { error: "address not found" };
        }

        maybeRefreshToken(set.headers, authInfo);
        return {
          alias: address.alias,
          domain: address.domain,
          address: `${address.alias}@${address.domain}`,
          mode: address.mode,
          created_at: address.created_at,
        };
      },
      {
        detail: {
          tags: ["Account"],
          summary: "Get account info for the authenticated address",
        },
      },
    )

    .put(
      "/password",
      async ({ authInfo, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return unauthorized();
        }

        const address = coreStore.addresses.get(
          authInfo.domain,
          authInfo.alias,
        );
        if (!address) {
          set.status = 404;
          return { error: "address not found" };
        }

        const valid = await verifyPassword(
          body.current_password,
          address.password_hash,
        );
        if (!valid) {
          set.status = 403;
          return { error: "current password is incorrect" };
        }

        coreStore.addresses.updatePassword(
          authInfo.domain,
          authInfo.alias,
          await hashPassword(body.new_password),
        );

        maybeRefreshToken(set.headers, authInfo);
        return { status: "password_changed" };
      },
      {
        body: t.Object({
          current_password: t.String({ minLength: 1 }),
          new_password: t.String({
            minLength: 8,
            description: "At least 8 characters",
          }),
        }),
        detail: { tags: ["Account"], summary: "Change account password" },
      },
    )

    .get(
      "/sessions",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return unauthorized();
        }

        const sessions = coreStore.tokens
          .byAlias(authInfo.alias, authInfo.domain, "session")
          .map((s) => ({
            ...s,
            current: s.id === authInfo.tokenId,
          }));

        maybeRefreshToken(set.headers, authInfo);
        return { sessions };
      },
      { detail: { tags: ["Account"], summary: "List all active sessions" } },
    )

    .delete(
      "/sessions/:id",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return unauthorized();
        }

        if (params.id === authInfo.tokenId) {
          set.status = 400;
          return { error: "cannot revoke current session, use /auth/logout" };
        }

        const row = coreStore.tokens
          .byAlias(authInfo.alias, authInfo.domain, "session")
          .find((session) => session.id === params.id);

        if (!row) {
          set.status = 404;
          return { error: "session not found" };
        }

        coreStore.tokens.delete(params.id);
        maybeRefreshToken(set.headers, authInfo);
        return { status: "revoked", id: params.id };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Account"], summary: "Revoke a session by ID" },
      },
    );
}
