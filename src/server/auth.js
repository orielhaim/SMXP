import {
  SESSION_LIFETIME,
  createToken,
  findTokenByHash,
  hashToken,
  updateLastUsed,
} from "../store/tokens.js";

export function authenticate(req) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  const hash = hashToken(token);
  const row = findTokenByHash(hash);

  if (!row) return null;

  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
    return null;
  }

  updateLastUsed(row.id);

  return {
    alias: row.alias,
    domain: row.domain,
    type: row.type,
    permissions: row.permissions,
    expiresAt: row.expires_at,
    tokenId: row.id,
  };
}

export function maybeRefreshToken(headers, authInfo) {
  if (authInfo.type !== "session" || !authInfo.expiresAt) return;

  const now = Math.floor(Date.now() / 1000);
  const remaining = authInfo.expiresAt - now;

  if (remaining < SESSION_LIFETIME * 0.25) {
    const { token: newToken } = createToken({
      alias: authInfo.alias,
      domain: authInfo.domain,
      type: "session",
      permissions: authInfo.permissions,
    });

    headers["X-SMXP-Token-Refresh"] = newToken;
  }
}
