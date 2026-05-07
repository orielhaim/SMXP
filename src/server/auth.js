import { Elysia } from "elysia";
import { verifyObjectSignature } from "../crypto/verify.js";
import { parseAddress } from "../shared/address.js";
import {
  createToken,
  findTokenByHash,
  hashToken,
  SESSION_LIFETIME,
  updateLastUsed,
} from "../store/tokens.js";
import { fetchAliasPublicKey, verifyDelegation } from "./verification.js";

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

  let payloadStr = null;
  let signatureStr = null;

  if (auth.startsWith("Signature ")) {
    const sig = auth.slice(10);
    const mPayload = sig.match(/payload="([^"]+)"/);
    const mSig = sig.match(/signature="([^"]+)"/);
    if (mPayload && mSig) {
      payloadStr = mPayload[1];
      signatureStr = mSig[1];
    }
  } else {
    payloadStr = url.searchParams.get("payload");
    signatureStr = url.searchParams.get("signature");
  }

  if (payloadStr && signatureStr) {
    try {
      const payload = JSON.parse(
        Buffer.from(payloadStr, "base64url").toString("utf8"),
      );
      const { delegate, on_behalf_of, timestamp } = payload;

      if (!delegate || !on_behalf_of || !timestamp) return null;

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) return null;

      const delegateAddr = parseAddress(delegate);
      const onBehalfOfAddr = parseAddress(on_behalf_of);

      await verifyDelegation(
        delegateAddr.address,
        onBehalfOfAddr.address,
        "read",
      );

      const aliasKey = await fetchAliasPublicKey(
        delegateAddr.domain,
        delegateAddr.localPart,
      );
      if (!verifyObjectSignature(payload, signatureStr, aliasKey.public_key))
        return null;

      return {
        alias: onBehalfOfAddr.localPart,
        domain: onBehalfOfAddr.domain,
        type: "delegation",
        delegate: delegateAddr.address,
      };
    } catch {
      return null;
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
