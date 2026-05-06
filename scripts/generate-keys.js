import { generateKeyPair, serializePublicKey, serializeSecretKey } from "../src/crypto/keys.js";
import { fingerprintPublicKey } from "../src/crypto/keys.js";
import { initSchema } from "../src/store/schema.js";
import { getDb } from "../src/store/db.js";
import { createAlias } from "../src/store/aliases.js";

console.log("=== SMXP Key Generator ===\n");

const domain = prompt("Domain name (default: localhost):") || "localhost";
const dbPath = prompt("Database path (default: ./data/smxp.db):") || "./data/smxp.db";

const modeInput = prompt("What to generate?\n  1) Server keys only\n  2) Server keys + alias\nChoose (1/2):");

let aliasName = null;
if (modeInput === "2") {
  aliasName = prompt("Alias name (e.g. alice):");
  if (!aliasName || aliasName.trim() === "") {
    console.error("[ERROR] Alias name cannot be empty.");
    process.exit(1);
  }
  aliasName = aliasName.trim();
}

console.log(`\n[KEYGEN] Initializing database at ${dbPath}...`);
initSchema(dbPath);
const db = getDb(dbPath);

const existingServerKey = db.query(`SELECT value FROM server_config WHERE key = 'server_public_key'`).get();

if (!existingServerKey) {
  console.log(`[KEYGEN] Generating server keys for ${domain}...`);
  const serverKeys = generateKeyPair();

  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_public_key",
    serializePublicKey(serverKeys.publicKey),
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_secret_key",
    serializeSecretKey(serverKeys.secretKey),
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_key_id",
    serverKeys.keyId,
  ]);
  db.run(`INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`, [
    "server_algorithm",
    serverKeys.algorithm,
  ]);

  const fp = fingerprintPublicKey(serverKeys.publicKey);
  console.log(`[KEYGEN] Server key ID: ${serverKeys.keyId}`);
  console.log(`[KEYGEN] Server key fingerprint: ${fp}`);
  console.log(`[KEYGEN] DNS TXT record for _smxpkey.${domain}:`);
  console.log(`  v=SMXP1; k=${serverKeys.algorithm}; kid=${serverKeys.keyId}; fp=sha256:${fp}`);
} else {
  console.log(`[KEYGEN] Server keys already exist. Skipping.`);
}

if (aliasName) {
  console.log(`[KEYGEN] Generating keys for alias "${aliasName}"...`);
  const aliasKeys = generateKeyPair();

  createAlias(
    dbPath,
    aliasName,
    serializePublicKey(aliasKeys.publicKey),
    serializeSecretKey(aliasKeys.secretKey),
    aliasKeys.keyId,
    aliasKeys.algorithm,
  );

  console.log(`[KEYGEN] Alias "${aliasName}" created with key ID: ${aliasKeys.keyId}`);
  console.log(`[KEYGEN] Full address: ${aliasName}@${domain}`);
}

console.log("\n[KEYGEN] Done.");
