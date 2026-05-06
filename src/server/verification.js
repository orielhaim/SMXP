import { buildBaseUrl, resolveTarget } from "../client/resolve.js";
import { fingerprintPublicKey } from "../crypto/keys.js";
import { verifyObjectSignature, verifySignature } from "../crypto/verify.js";
import { discoverSmxp } from "../dns/discover.js";
import { dohQuery } from "../dns/doh.js";
import { parseAddress } from "../shared/address.js";
import { getSignableBytes } from "../shared/envelope.js";
import { getDb } from "../store/db.js";
import { getDelegationByDelegate } from "../store/delegations.js";
import { domainExists } from "../store/domains.js";

function shouldVerifyDnsFingerprint(domain) {
  return domain !== "localhost" && !resolveTarget(domain);
}

export async function fetchDnsFingerprint(domain) {
  const name = `_smxpkey.${domain}`;
  const response = await dohQuery(name, "TXT");

  if (
    response.Status !== 0 ||
    !response.Answer ||
    response.Answer.length === 0
  ) {
    throw new Error(`No SMXP key record for ${domain}`);
  }

  const txt = response.Answer[0].data.replace(/"/g, "");
  const parts = txt.split(";").map((s) => s.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key.trim() === "fp") {
      const val = rest.join("=").trim();
      if (val.startsWith("sha256:")) {
        return val.slice(7);
      }
    }
  }

  throw new Error(`No fingerprint found in DNS for ${domain}`);
}

export async function fetchServerPublicKey(domain) {
  const resolved = resolveTarget(domain);
  const target = resolved || (await discoverSmxp(domain));
  const url = `${buildBaseUrl(target.host, target.port)}/.smxp/server-key`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch server key from ${domain}`);
  }

  const serverKeyInfo = await res.json();

  if (shouldVerifyDnsFingerprint(domain)) {
    const dnsFingerprint = await fetchDnsFingerprint(domain);
    const actualFingerprint = fingerprintPublicKey(serverKeyInfo.public_key);

    if (dnsFingerprint !== actualFingerprint) {
      throw new Error(
        `Server key fingerprint mismatch! DNS: ${dnsFingerprint}, actual: ${actualFingerprint}`,
      );
    }
  }

  return serverKeyInfo;
}

export async function fetchAliasPublicKey(domain, alias) {
  const resolved = resolveTarget(domain);
  const target = resolved || (await discoverSmxp(domain));
  const baseUrl = buildBaseUrl(target.host, target.port);
  const url = `${baseUrl}/.well-known/smxp/keys/${encodeURIComponent(domain)}/${encodeURIComponent(alias)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch alias key: ${res.status}`);
  }

  return await res.json();
}

export async function fetchAliasDelegation(domain, alias, delegate) {
  const resolved = resolveTarget(domain);
  const target = resolved || (await discoverSmxp(domain));
  const baseUrl = buildBaseUrl(target.host, target.port);
  const url = `${baseUrl}/.well-known/smxp/delegations/${encodeURIComponent(domain)}?alias=${encodeURIComponent(alias)}&delegate=${encodeURIComponent(delegate)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch alias delegation: ${res.status}`);
  }

  return await res.json();
}

export async function verifyDelegation(
  delegate,
  onBehalfOf,
  requiredScope = "send",
) {
  const onBehalfOfParsed = parseAddress(onBehalfOf);

  if (domainExists(onBehalfOfParsed.domain)) {
    const delegation = getDelegationByDelegate(
      onBehalfOfParsed.domain,
      onBehalfOfParsed.localPart,
      delegate,
    );

    if (!delegation) {
      throw new Error(`No delegation found for ${delegate} on ${onBehalfOf}`);
    }

    if (delegation.scope !== requiredScope) {
      throw new Error(
        `Delegation found but scope is ${delegation.scope}, requires ${requiredScope}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (delegation.expires_at !== null && delegation.expires_at < now) {
      throw new Error("Delegation is expired");
    }

    return true;
  }

  const aliasKeyResponse = await fetchAliasPublicKey(
    onBehalfOfParsed.domain,
    onBehalfOfParsed.localPart,
  );
  const delegationResponse = await fetchAliasDelegation(
    onBehalfOfParsed.domain,
    onBehalfOfParsed.localPart,
    delegate,
  );

  const { signature, key_id, ...delegationPayload } = delegationResponse;

  const isValid = verifyObjectSignature(
    delegationPayload,
    signature,
    aliasKeyResponse.public_key,
  );

  if (!isValid) {
    throw new Error("Delegation signature verification failed");
  }

  if (delegationPayload.scope !== requiredScope) {
    throw new Error(
      `Delegation found but scope is ${delegationPayload.scope}, requires ${requiredScope}`,
    );
  }

  return true;
}

export async function verifyRemoteSender(envelope, senderDomain, senderAlias) {
  const serverKeyInfo = await fetchServerPublicKey(senderDomain);
  const aliasKeyResponse = await fetchAliasPublicKey(senderDomain, senderAlias);
  const { server_signature, server_key_id, ...aliasPayload } = aliasKeyResponse;
  const serverSigValid = verifyObjectSignature(
    aliasPayload,
    server_signature,
    serverKeyInfo.public_key,
  );

  if (!serverSigValid) {
    throw new Error("server signature verification failed");
  }

  const msgSigValid = verifySignature(
    getSignableBytes(envelope),
    envelope.signature,
    aliasKeyResponse.public_key,
  );

  if (!msgSigValid) {
    throw new Error("message signature verification failed");
  }
}

export async function verifyLocalSender(envelope, senderAlias) {
  const db = getDb();
  const publicKey = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_public_key");

  if (!publicKey) {
    throw new Error("server not configured");
  }

  if (shouldVerifyDnsFingerprint(senderAlias.domain)) {
    const dnsFingerprint = await fetchDnsFingerprint(senderAlias.domain);
    const actualFingerprint = fingerprintPublicKey(publicKey.value);

    if (dnsFingerprint !== actualFingerprint) {
      throw new Error(
        `Server key fingerprint mismatch! DNS: ${dnsFingerprint}, actual: ${actualFingerprint}`,
      );
    }
  }

  const msgSigValid = verifySignature(
    getSignableBytes(envelope),
    envelope.signature,
    senderAlias.public_key,
  );

  if (!msgSigValid) {
    throw new Error("message signature verification failed");
  }
}
