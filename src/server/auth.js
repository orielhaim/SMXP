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

export async function authenticate(req) {
  const auth = req.headers.get("authorization");

  let urlStr = req.url;
  // Fallback for mock req objects
  if (!urlStr && req.headers) {
    urlStr = "http://localhost/";
  }
  const url = new URL(urlStr);

  const token = auth?.startsWith("Bearer ")
    ? auth.slice(7)
    : url.searchParams.get("token");

  if (token) {
    const hash = hashToken(token);
    const row = findTokenByHash(hash);

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

  const sigHeader = auth?.startsWith("Signature ") ? auth.slice(10) : null;
  let payloadStr = url.searchParams.get("payload");
  let signatureStr = url.searchParams.get("signature");

  if (sigHeader) {
    const matchPayload = sigHeader.match(/payload="([^"]+)"/);
    const matchSig = sigHeader.match(/signature="([^"]+)"/);
    if (matchPayload && matchSig) {
      payloadStr = matchPayload[1];
      signatureStr = matchSig[1];
    }
  }

  if (payloadStr && signatureStr) {
    try {
      const decodedPayload = Buffer.from(payloadStr, "base64url").toString(
        "utf8",
      );
      const payload = JSON.parse(decodedPayload);

      const { delegate, on_behalf_of, timestamp } = payload;

      if (!delegate || !on_behalf_of || !timestamp) return null;

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) {
        // 5 minutes tolerance
        return null; // Expired or future signature
      }

      const delegateAddr = parseAddress(delegate);
      const onBehalfOfAddr = parseAddress(on_behalf_of);

      await verifyDelegation(
        delegateAddr.address,
        onBehalfOfAddr.address,
        "read",
      );

      const aliasKeyResponse = await fetchAliasPublicKey(
        delegateAddr.domain,
        delegateAddr.localPart,
      );
      const isValid = verifyObjectSignature(
        payload,
        signatureStr,
        aliasKeyResponse.public_key,
      );

      if (isValid) {
        return {
          alias: onBehalfOfAddr.localPart,
          domain: onBehalfOfAddr.domain,
          type: "delegation",
          delegate: delegateAddr.address,
        };
      }
    } catch (e) {
      console.error("Signature auth error:", e);
      return null;
    }
  }

  return null;
}

export function maybeRefreshToken(headers, authInfo) {
  if (!authInfo || authInfo.type !== "session" || !authInfo.expiresAt) return;

  const now = Math.floor(Date.now() / 1000);
  const remaining = authInfo.expiresAt - now;

  if (remaining < SESSION_LIFETIME * 0.25) {
    const { token: newToken } = createToken({
      alias: authInfo.alias,
      domain: authInfo.domain,
      type: "session",
    });

    headers["X-SMXP-Token-Refresh"] = newToken;
  }
}
