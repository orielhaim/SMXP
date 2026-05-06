import {
  fingerprintPublicKey,
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../crypto/keys.js";
import { getDb } from "./db.js";

export function ensureServerKeys() {
  const db = getDb();
  const publicKey = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_public_key");
  const secretKey = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_secret_key");
  const keyId = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_key_id");
  const algorithm = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_algorithm");

  if (publicKey && secretKey && keyId) {
    return {
      public_key: publicKey.value,
      secret_key: secretKey.value,
      key_id: keyId.value,
      algorithm: algorithm?.value || "ML-DSA-65",
    };
  }

  const keys = generateKeyPair();
  const serializedPublicKey = serializePublicKey(keys.publicKey);
  const serializedSecretKey = serializeSecretKey(keys.secretKey);

  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_public_key",
    serializedPublicKey,
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_secret_key",
    serializedSecretKey,
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_key_id",
    keys.keyId,
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_algorithm",
    keys.algorithm,
  ]);

  return {
    public_key: serializedPublicKey,
    secret_key: serializedSecretKey,
    key_id: keys.keyId,
    algorithm: keys.algorithm,
  };
}

export function getServerDnsRecord(domain) {
  const serverKeys = ensureServerKeys();
  const fingerprint = fingerprintPublicKey(serverKeys.public_key);

  return {
    name: `_smxpkey.${domain}`,
    type: "TXT",
    value: `v=SMXP1; k=${serverKeys.algorithm}; kid=${serverKeys.key_id}; fp=sha256:${fingerprint}`,
    fingerprint,
  };
}
