import { Elysia, t } from "elysia";
import { parseAddress } from "../../shared/address.js";
import {
  createDelegation,
  deleteDelegation,
  getDelegations,
  getDelegationsGrantedTo,
} from "../../store/delegations.js";
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

export function delegationsRoutes() {
  return new Elysia({ prefix: "/.smxp/delegations" })
    .post(
      "/",
      ({ request, body }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        try {
          parseAddress(body.delegate);
        } catch (err) {
          return jsonResponse(
            { error: "invalid delegate address format" },
            400,
          );
        }

        const delegation = createDelegation({
          domain: authInfo.domain,
          alias: authInfo.alias,
          delegate: body.delegate,
          scope: body.scope || "send",
          expiresAt: body.expires_at || null,
        });

        return authedResponse({ delegation }, authInfo, 201);
      },
      {
        body: t.Object({
          delegate: t.String({ minLength: 1 }),
          scope: t.Optional(
            t.Union([
              t.Literal("send"),
              t.Literal("read"),
              t.Literal("manage"),
            ]),
          ),
          expires_at: t.Optional(t.Nullable(t.Number())),
        }),
      },
    )

    .get("/", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const delegations = getDelegations(authInfo.domain, authInfo.alias);
      return authedResponse({ delegations }, authInfo);
    })

    .get("/granted", ({ request }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const myAddress = `${authInfo.alias}@${authInfo.domain}`;
      const delegations = getDelegationsGrantedTo(myAddress);

      return authedResponse({ delegations }, authInfo);
    })

    .delete("/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const deleted = deleteDelegation(
        authInfo.domain,
        authInfo.alias,
        params.id,
      );
      if (!deleted) {
        return jsonResponse({ error: "delegation not found" }, 404);
      }

      return authedResponse({ status: "deleted", id: params.id }, authInfo);
    });
}
