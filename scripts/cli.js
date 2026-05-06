import config from "../src/config.js";
import {
  fingerprintPublicKey,
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../src/crypto/keys.js";
import { hashPassword } from "../src/crypto/password.js";
import { createForwardAlias, createInboxAlias } from "../src/store/aliases.js";
import { getDb } from "../src/store/db.js";
import { createDomain } from "../src/store/domains.js";
import { initSchema } from "../src/store/schema.js";

console.log("=== SMXP CLI ===\n");

const domain = (prompt("Domain name (default: localhost):") || "localhost")
  .trim()
  .toLowerCase();
const dbPath =
  prompt("Database path (default: ./data/smxp.db):") || "./data/smxp.db";

config.dbPath = dbPath;

const modeInput = prompt(
  "What to generate?\n  1) Server keys + domain\n  2) Inbox alias\n  3) Forward alias\nChoose (1/2/3):",
);

console.log(`\n[KEYGEN] Initializing database at ${config.dbPath}...`);
initSchema();
createDomain(domain);
const db = getDb();

const existingServerKey = db
  .query(`SELECT value FROM server_config WHERE key = 'server_public_key'`)
  .get();

if (!existingServerKey) {
  console.log(`[KEYGEN] Generating server keys...`);
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
  console.log(
    `  v=SMXP1; k=${serverKeys.algorithm}; kid=${serverKeys.keyId}; fp=sha256:${fp}`,
  );
} else {
  console.log(`[KEYGEN] Server keys already exist. Skipping.`);
}

if (modeInput === "2") {
  const aliasName = prompt("Inbox alias name (e.g. alice):")
    ?.trim()
    .toLowerCase();
  if (!aliasName) {
    console.error("[ERROR] Alias name cannot be empty.");
    process.exit(1);
  }

  const aliasKeys = generateKeyPair();
  const password = prompt("Alias password:") || "";
  createInboxAlias(
    domain,
    aliasName,
    await hashPassword(password),
    serializePublicKey(aliasKeys.publicKey),
    serializeSecretKey(aliasKeys.secretKey),
    aliasKeys.keyId,
    aliasKeys.algorithm,
  );

  console.log(`[KEYGEN] Inbox alias "${aliasName}@${domain}" created.`);
  console.log(`[KEYGEN] Alias key ID: ${aliasKeys.keyId}`);
}

if (modeInput === "3") {
  const aliasName = prompt('Forward alias name (e.g. sales or "*"):')
    ?.trim()
    .toLowerCase();
  const forwardTo = prompt(
    `Forward target in ${domain} (e.g. alice@${domain}):`,
  )
    ?.trim()
    .toLowerCase();

  if (!aliasName || !forwardTo) {
    console.error("[ERROR] Alias name and forward target are required.");
    process.exit(1);
  }

  createForwardAlias(domain, aliasName, forwardTo);
  console.log(
    `[KEYGEN] Forward alias "${aliasName}@${domain}" -> ${forwardTo} created.`,
  );
}

console.log("\n[KEYGEN] Done.");
