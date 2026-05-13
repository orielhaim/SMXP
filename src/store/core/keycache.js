export function keyCacheApi(db) {
  return {
    get(domain) {
      const now = Math.floor(Date.now() / 1000);
      const row = db
        .query(
          `SELECT domain, public_key, key_id, algorithm, fetched_at, ttl
           FROM key_cache WHERE domain = ?`,
        )
        .get(norm(domain));
      if (!row) return null;
      if (row.fetched_at + row.ttl < now) return null;
      return row;
    },

    put(domain, publicKey, keyId, algorithm, ttl = 3600) {
      db.run(
        `INSERT OR REPLACE INTO key_cache
         (domain, key_id, algorithm, public_key, fetched_at, ttl)
         VALUES (?, ?, ?, ?, unixepoch(), ?)`,
        [norm(domain), keyId, algorithm, publicKey, ttl],
      );
    },

    clear(domain) {
      db.run(`DELETE FROM key_cache WHERE domain = ?`, [norm(domain)]);
    },
  };
}

function norm(v) {
  return String(v).trim().toLowerCase();
}
