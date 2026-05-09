import { Elysia } from "elysia";
import {
  createToken,
  findTokenByHash,
  hashToken,
  SESSION_LIFETIME,
  updateLastUsed,
} from "../store/tokens.js";

export async function authenticate(request) {
  const auth = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);

  const bearer = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : url.searchParams.get("token");
  if (bearer) {
    const row = findTokenByHash(hashToken(bearer));
    if (row) {
      if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
        return null;
      }
      updateLastUsed(row.id);
      return {
        alias: row.alias,
        domain: row.domain,
        type: row.type,
        expiresAt: row.expires_at,
        tokenId: row.id,
      };
    }
  }

  return null;
}

export function withAuth() {
  return new Elysia({ name: "with-auth" }).derive(
    { as: "scoped" },
    async ({ request }) => ({ authInfo: await authenticate(request) }),
  );
}

export function maybeRefreshToken(headers, authInfo) {
  if (!authInfo || authInfo.type !== "session" || !authInfo.expiresAt) return;

  const remaining = authInfo.expiresAt - Math.floor(Date.now() / 1000);
  if (remaining < SESSION_LIFETIME * 0.25) {
    const { token } = createToken({
      alias: authInfo.alias,
      domain: authInfo.domain,
      type: "session",
    });
    headers["X-SMXP-Token-Refresh"] = token;
  }
}
