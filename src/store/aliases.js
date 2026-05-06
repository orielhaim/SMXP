import { getDb } from "./db.js";

export function createAlias(dbPath, alias, publicKey, secretKey, keyId, algorithm = "ML-DSA-65") {
  const db = getDb(dbPath);
  db.run(
    `INSERT OR REPLACE INTO aliases (alias, public_key, secret_key, key_id, algorithm) VALUES (?, ?, ?, ?, ?)`,
    [alias, publicKey, secretKey, keyId, algorithm],
  );
}

export function getAlias(dbPath, alias) {
  const db = getDb(dbPath);
  return db.query(`SELECT * FROM aliases WHERE alias = ?`).get(alias);
}

export function getAllAliases(dbPath) {
  const db = getDb(dbPath);
  return db.query(`SELECT alias, public_key, key_id, algorithm, created_at FROM aliases`).all();
}
