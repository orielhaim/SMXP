import {
  fingerprintPublicKey,
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../../crypto/keys.js";

export function domainsApi(db) {
  return {
    create(domain) {
      const name = normalize(domain);
      const existing = this.keys(name);
      if (existing) return existing;

      const k = generateKeyPair();
      const row = {
        public_key: serializePublicKey(k.publicKey),
        secret_key: serializeSecretKey(k.secretKey),
        key_id: k.keyId,
        algorithm: k.algorithm,
      };

      db.run(
        `INSERT INTO domains (domain, public_key, secret_key, key_id, algorithm)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
           public_key = COALESCE(domains.public_key, excluded.public_key),
           secret_key = COALESCE(domains.secret_key, excluded.secret_key),
           key_id     = COALESCE(domains.key_id, excluded.key_id),
           algorithm  = COALESCE(domains.algorithm, excluded.algorithm)`,
        [name, row.public_key, row.secret_key, row.key_id, row.algorithm],
      );

      return this.keys(name);
    },

    exists(domain) {
      return !!db
        .query(`SELECT 1 FROM domains WHERE domain = ?`)
        .get(normalize(domain));
    },

    all() {
      return db
        .query(
          `SELECT domain, key_id, algorithm, created_at FROM domains ORDER BY domain`,
        )
        .all();
    },

    keys(domain) {
      const row = db
        .query(
          `SELECT domain, public_key, secret_key, key_id, algorithm FROM domains WHERE domain = ?`,
        )
        .get(normalize(domain));
      if (!row?.public_key || !row.secret_key || !row.key_id) return null;
      return row;
    },

    dnsRecord(domain) {
      const name = normalize(domain);
      const keys = this.keys(name) ?? this.create(name);
      const fp = fingerprintPublicKey(keys.public_key);
      return {
        name: `_smxpkey.${name}`,
        type: "TXT",
        value: `v=SMXP1; k=${keys.algorithm}; kid=${keys.key_id}; fp=sha256:${fp}`,
        fingerprint: fp,
      };
    },

    delete(domain) {
      const r = db
        .query(`DELETE FROM domains WHERE domain = ? RETURNING domain`)
        .get(normalize(domain));
      return !!r;
    },
  };
}

function normalize(domain) {
  return String(domain).trim().toLowerCase();
}
