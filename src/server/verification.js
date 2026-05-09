import { buildBaseUrl, resolveTarget } from "../client/resolve.js";
import { fingerprintPublicKey } from "../crypto/keys.js";
import { verifySignature } from "../crypto/verify.js";
import { discoverSmxp } from "../dns/discover.js";
import { dohQuery } from "../dns/doh.js";
import { getSignableBytes } from "../shared/envelope.js";
import { smxpFetch } from "../shared/fetch.js";
import { getDomainKeys } from "../store/domains.js";
import { cacheDomainKey, getCachedDomainKey } from "../store/key-cache.js";

function shouldVerifyDnsFingerprint(domain) {
  return domain !== "localhost" && !resolveTarget(domain);
}

export async function fetchDnsKeyRecord(domain) {
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
  const record = {};

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    record[key.trim()] = rest.join("=").trim();
  }

  if (!record.fp?.startsWith("sha256:")) {
    throw new Error(`No fingerprint found in DNS for ${domain}`);
  }

  return {
    version: record.v,
    algorithm: record.k,
    key_id: record.kid,
    fingerprint: record.fp.slice(7),
  };
}

export async function fetchDnsFingerprint(domain) {
  return (await fetchDnsKeyRecord(domain)).fingerprint;
}

function verifyDnsKeyRecord(domain, keyInfo) {
  return fetchDnsKeyRecord(domain).then((dnsRecord) => {
    const actualFingerprint = fingerprintPublicKey(keyInfo.public_key);

    if (dnsRecord.fingerprint !== actualFingerprint) {
      throw new Error(
        `Server key fingerprint mismatch! DNS: ${dnsRecord.fingerprint}, actual: ${actualFingerprint}`,
      );
    }

    if (dnsRecord.key_id && dnsRecord.key_id !== keyInfo.key_id) {
      throw new Error(
        `Server key id mismatch! DNS: ${dnsRecord.key_id}, actual: ${keyInfo.key_id}`,
      );
    }

    if (dnsRecord.algorithm && dnsRecord.algorithm !== keyInfo.algorithm) {
      throw new Error(
        `Server key algorithm mismatch! DNS: ${dnsRecord.algorithm}, actual: ${keyInfo.algorithm}`,
      );
    }
  });
}

export async function fetchServerPublicKey(domain) {
  const resolved = resolveTarget(domain);
  const target = resolved || (await discoverSmxp(domain));
  const url = `${buildBaseUrl(target.host, target.port)}/.smxp/server-key/${encodeURIComponent(domain)}`;

  const serverKeyInfo = await smxpFetch.get(url).json();

  if (shouldVerifyDnsFingerprint(domain)) {
    await verifyDnsKeyRecord(domain, serverKeyInfo);
  }

  return serverKeyInfo;
}

export async function getRemoteDomainKey(domain, keyId) {
  const cached = getCachedDomainKey(domain);
  if (cached && (!keyId || cached.key_id === keyId)) {
    return cached;
  }

  const keyInfo = await fetchServerPublicKey(domain);
  if (keyId && keyInfo.key_id !== keyId) {
    throw new Error(
      `Server key id mismatch! envelope: ${keyId}, fetched: ${keyInfo.key_id}`,
    );
  }

  cacheDomainKey(
    domain,
    keyInfo.public_key,
    keyInfo.key_id,
    keyInfo.algorithm,
    keyInfo.ttl ?? 3600,
  );
  return keyInfo;
}

export async function verifyRemoteSender(envelope, senderDomain) {
  const serverKeyInfo = await getRemoteDomainKey(
    senderDomain,
    envelope.server_key_id,
  );
  const msgSigValid = verifySignature(
    getSignableBytes(envelope),
    envelope.server_signature,
    serverKeyInfo.public_key,
  );

  if (!msgSigValid) {
    throw new Error("message signature verification failed");
  }
}

export async function verifyLocalSender(envelope, senderAlias) {
  const domainKeys = getDomainKeys(senderAlias.domain);

  if (!domainKeys) {
    throw new Error(`domain "${senderAlias.domain}" is not configured`);
  }

  if (envelope.server_key_id !== domainKeys.key_id) {
    throw new Error(
      `Server key id mismatch! envelope: ${envelope.server_key_id}, local: ${domainKeys.key_id}`,
    );
  }

  if (shouldVerifyDnsFingerprint(senderAlias.domain)) {
    await verifyDnsKeyRecord(senderAlias.domain, domainKeys);
  }

  const msgSigValid = verifySignature(
    getSignableBytes(envelope),
    envelope.server_signature,
    domainKeys.public_key,
  );

  if (!msgSigValid) {
    throw new Error("message signature verification failed");
  }
}
