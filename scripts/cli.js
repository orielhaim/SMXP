import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import config from "../src/config.js";
import {
  fingerprintPublicKey,
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../src/crypto/keys.js";
import { hashPassword } from "../src/crypto/password.js";
import {
  createForwardAddress,
  createInboxAddress,
} from "../src/store/addresses.js";
import { getDb } from "../src/store/db.js";
import { createDomain } from "../src/store/domains.js";
import { initSchema } from "../src/store/schema.js";

function init(domain, dbPath) {
  config.dbPath = dbPath;
  initSchema();
  createDomain(domain);
}

async function resolveDomain(args) {
  return (
    args.domain ||
    (await consola.prompt("Domain name:", {
      type: "text",
      default: "localhost",
    }))
  );
}

async function resolveDb(args) {
  return (
    args.db ||
    (await consola.prompt("Database path:", {
      type: "text",
      default: "./data/smxp.db",
    }))
  );
}

const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Generate server keys and initialize domain",
  },
  args: {
    domain: { type: "string", description: "Domain name", alias: ["d"] },
    db: { type: "string", description: "Database path", valueHint: "path" },
  },
  async run({ args }) {
    const domain = await resolveDomain(args);
    const dbPath = await resolveDb(args);
    init(domain, dbPath);

    const db = getDb();
    const existing = db
      .query(`SELECT value FROM server_config WHERE key = 'server_public_key'`)
      .get();

    if (existing) {
      consola.info("Server keys already exist. Skipping.");
      return;
    }

    consola.start("Generating server keys...");
    const keys = generateKeyPair();

    for (const [k, v] of Object.entries({
      server_public_key: serializePublicKey(keys.publicKey),
      server_secret_key: serializeSecretKey(keys.secretKey),
      server_key_id: keys.keyId,
      server_algorithm: keys.algorithm,
    })) {
      db.run(
        `INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)`,
        [k, v],
      );
    }

    const fp = fingerprintPublicKey(keys.publicKey);
    consola.success(`Key ID: ${keys.keyId}`);
    consola.success(`Fingerprint: ${fp}`);
    consola.box(
      `DNS TXT record for _smxpkey.${domain}:\n\nv=SMXP1; k=${keys.algorithm}; kid=${keys.keyId}; fp=sha256:${fp}`,
    );
  },
});

const inbox = defineCommand({
  meta: { name: "inbox", description: "Create an inbox alias" },
  args: {
    domain: { type: "string", description: "Domain name", alias: ["d"] },
    db: { type: "string", description: "Database path", valueHint: "path" },
    name: {
      type: "string",
      description: "Alias name (e.g. alice)",
      alias: ["n"],
    },
    password: { type: "string", description: "Alias password", alias: ["p"] },
  },
  async run({ args }) {
    const domain = await resolveDomain(args);
    const dbPath = await resolveDb(args);
    const name =
      args.name ||
      (await consola.prompt("Alias name (e.g. alice):", { type: "text" }));
    const password =
      args.password ??
      (await consola.prompt("Password:", { type: "text", default: "" }));

    if (!name) {
      consola.error("Alias name cannot be empty.");
      process.exit(1);
    }

    init(domain, dbPath);

    const keys = generateKeyPair();
    const hashed = await hashPassword(password);

    createInboxAddress(
      domain,
      name,
      hashed,
      serializePublicKey(keys.publicKey),
      serializeSecretKey(keys.secretKey),
      keys.keyId,
      keys.algorithm,
    );

    consola.success(`Inbox "${name}@${domain}" created.`);
    consola.info(`Alias key ID: ${keys.keyId}`);
  },
});

const forward = defineCommand({
  meta: { name: "forward", description: "Create a forward alias" },
  args: {
    domain: { type: "string", description: "Domain name", alias: ["d"] },
    db: { type: "string", description: "Database path", valueHint: "path" },
    name: {
      type: "string",
      description: 'Alias name (e.g. sales or "*")',
      alias: ["n"],
    },
    target: {
      type: "string",
      description: "Forward target (e.g. alice@localhost)",
      alias: ["t"],
    },
  },
  async run({ args }) {
    const domain = await resolveDomain(args);
    const dbPath = await resolveDb(args);
    const name =
      args.name ||
      (await consola.prompt('Alias name (e.g. sales or "*"):', {
        type: "text",
      }));
    const target =
      args.target ||
      (await consola.prompt(`Forward target (e.g. alice@${domain}):`, {
        type: "text",
      }));

    if (!name || !target) {
      consola.error("Alias name and forward target are required.");
      process.exit(1);
    }

    init(domain, dbPath);
    createForwardAddress(domain, name, target);
    consola.success(`Forward "${name}@${domain}" → ${target} created.`);
  },
});

const main = defineCommand({
  meta: {
    name: "smxp",
    version: "1.0.0",
    description: "SMXP server management CLI",
  },
  subCommands: { setup, inbox, forward },
});

runMain(main);
