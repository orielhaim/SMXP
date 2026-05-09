import {
  fingerprintPublicKey,
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../crypto/keys.js";
import { getDb } from "./db.js";

export function createDomain(domain) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const existing = getDomainKeys(normalizedDomain);

  if (existing) {
    return existing;
  }

  const keys = generateKeyPair();
  const domainKeys = {
    public_key: serializePublicKey(keys.publicKey),
    secret_key: serializeSecretKey(keys.secretKey),
    key_id: keys.keyId,
    algorithm: keys.algorithm,
  };

  db.run(
    `INSERT INTO domains (
      domain,
      public_key,
      secret_key,
      key_id,
      algorithm
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      public_key = COALESCE(domains.public_key, excluded.public_key),
      secret_key = COALESCE(domains.secret_key, excluded.secret_key),
      key_id = COALESCE(domains.key_id, excluded.key_id),
      algorithm = COALESCE(domains.algorithm, excluded.algorithm)`,
    [
      normalizedDomain,
      domainKeys.public_key,
      domainKeys.secret_key,
      domainKeys.key_id,
      domainKeys.algorithm,
    ],
  );

  return getDomainKeys(normalizedDomain);
}

export function domainExists(domain) {
  const db = getDb();
  const row = db
    .query(`SELECT domain FROM domains WHERE domain = ?`)
    .get(domain.trim().toLowerCase());
  return !!row;
}

export function getAllDomains() {
  const db = getDb();
  return db
    .query(
      `SELECT domain, key_id, algorithm, created_at FROM domains ORDER BY domain`,
    )
    .all();
}

export function getDomainKeys(domain) {
  const db = getDb();
  const row = db
    .query(
      `SELECT domain, public_key, secret_key, key_id, algorithm
       FROM domains
       WHERE domain = ?`,
    )
    .get(domain.trim().toLowerCase());

  if (!row?.public_key || !row.secret_key || !row.key_id) {
    return null;
  }

  return row;
}

export function getDomainDnsRecord(domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const domainKeys =
    getDomainKeys(normalizedDomain) ?? createDomain(normalizedDomain);
  const fingerprint = fingerprintPublicKey(domainKeys.public_key);

  return {
    name: `_smxpkey.${normalizedDomain}`,
    type: "TXT",
    value: `v=SMXP1; k=${domainKeys.algorithm}; kid=${domainKeys.key_id}; fp=sha256:${fingerprint}`,
    fingerprint,
  };
}

export function deleteDomain(domain) {
  const db = getDb();
  const result = db
    .query(`DELETE FROM domains WHERE domain = ? RETURNING domain`)
    .get(domain.trim().toLowerCase());
  return !!result;
}
