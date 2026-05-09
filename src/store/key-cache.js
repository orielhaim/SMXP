import { getDb } from "./db.js";

export function getCachedDomainKey(domain) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .query(
      `SELECT domain, public_key, key_id, algorithm, fetched_at, ttl
       FROM key_cache
       WHERE domain = ?`,
    )
    .get(domain.trim().toLowerCase());

  if (!row) {
    return null;
  }

  if (row.fetched_at + row.ttl < now) {
    return null;
  }

  return row;
}

export function cacheDomainKey(
  domain,
  publicKey,
  keyId,
  algorithm,
  ttl = 3600,
) {
  const db = getDb();
  db.run(
    `INSERT OR REPLACE INTO key_cache (
      domain,
      key_id,
      algorithm,
      public_key,
      fetched_at,
      ttl
    ) VALUES (?, ?, ?, ?, unixepoch(), ?)`,
    [domain.trim().toLowerCase(), keyId, algorithm, publicKey, ttl],
  );
}
