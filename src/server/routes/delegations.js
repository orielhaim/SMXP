import { Elysia, t } from "elysia";
import { parseAddress } from "../../shared/address.js";
import {
  createDelegation,
  deleteDelegation,
  getDelegations,
  getDelegationsGrantedTo,
} from "../../store/delegations.js";
import { maybeRefreshToken, withAuth } from "../auth.js";

export function delegationsRoutes() {
  return new Elysia({ prefix: "/.smxp/delegations" })
    .use(withAuth())

    .post(
      "/",
      ({ authInfo, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        try {
          parseAddress(body.delegate);
        } catch {
          set.status = 400;
          return { error: "invalid delegate address format" };
        }

        const delegation = createDelegation({
          domain: authInfo.domain,
          alias: authInfo.alias,
          delegate: body.delegate,
          scope: body.scope ?? "send",
          expiresAt: body.expires_at ?? null,
        });

        set.status = 201;
        maybeRefreshToken(set.headers, authInfo);
        return { delegation };
      },
      {
        body: t.Object({
          delegate: t.String({
            minLength: 1,
            description: "Full address of the delegate, e.g. bot@example.com",
          }),
          scope: t.Optional(
            t.Union([
              t.Literal("send"),
              t.Literal("read"),
              t.Literal("manage"),
            ]),
          ),
          expires_at: t.Optional(
            t.Nullable(t.Number({ description: "Unix timestamp" })),
          ),
        }),
        detail: {
          tags: ["Delegations"],
          summary: "Grant a delegation to another address",
        },
      },
    )

    .get(
      "/",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        maybeRefreshToken(set.headers, authInfo);
        return { delegations: getDelegations(authInfo.domain, authInfo.alias) };
      },
      {
        detail: {
          tags: ["Delegations"],
          summary: "List delegations granted by the authenticated address",
        },
      },
    )

    .get(
      "/granted",
      ({ authInfo, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const myAddress = `${authInfo.alias}@${authInfo.domain}`;
        maybeRefreshToken(set.headers, authInfo);
        return { delegations: getDelegationsGrantedTo(myAddress) };
      },
      {
        detail: {
          tags: ["Delegations"],
          summary: "List delegations granted TO the authenticated address",
        },
      },
    )

    .delete(
      "/:id",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        if (!deleteDelegation(authInfo.domain, authInfo.alias, params.id)) {
          set.status = 404;
          return { error: "delegation not found" };
        }
        maybeRefreshToken(set.headers, authInfo);
        return { status: "deleted", id: params.id };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Delegations"], summary: "Revoke a delegation by ID" },
      },
    );
}
