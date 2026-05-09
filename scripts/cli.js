import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import config from "../src/config.js";
import { hashPassword } from "../src/crypto/password.js";
import { createInboxAddress } from "../src/store/addresses.js";
import { createDomain, getDomainDnsRecord } from "../src/store/domains.js";
import { createRoute } from "../src/store/routes.js";
import { initSchema } from "../src/store/schema.js";

function init(dbPath, domain) {
  config.dbPath = dbPath;
  initSchema();
  createDomain(domain);
}

async function resolveDb(args) {
  const defaultValue = process.env.DB || "./data/smxp.db";
  return (
    args.db ||
    (await consola.prompt(`Database path (${defaultValue}):`, {
      type: "text",
      default: defaultValue,
    }))
  );
}

async function resolveDomain(args) {
  const defaultValue = process.env.DOMAIN || "localhost";
  return (
    args.domain ||
    (await consola.prompt(`Domain name (${defaultValue}):`, {
      type: "text",
      default: defaultValue,
    }))
  );
}

const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Generate server keys and initialize domain",
  },
  args: {
    db: { type: "string", description: "Database path", valueHint: "path" },
    domain: { type: "string", description: "Domain name", alias: ["d"] },
  },
  async run({ args }) {
    const dbPath = await resolveDb(args);
    const domain = await resolveDomain(args);
    init(dbPath, domain);

    const domainKeys = createDomain(domain);
    const dnsRecord = getDomainDnsRecord(domain);
    consola.success(`Key ID: ${domainKeys.key_id}`);
    consola.success(`Fingerprint: ${dnsRecord.fingerprint}`);
    consola.box(`DNS TXT record for ${dnsRecord.name}:\n\n${dnsRecord.value}`);
  },
});

const inbox = defineCommand({
  meta: { name: "inbox", description: "Create an inbox alias" },
  args: {
    db: { type: "string", description: "Database path", valueHint: "path" },
    domain: { type: "string", description: "Domain name", alias: ["d"] },
    name: {
      type: "string",
      description: "Alias name (e.g. alice)",
      alias: ["n"],
    },
    password: { type: "string", description: "Alias password", alias: ["p"] },
  },
  async run({ args }) {
    const dbPath = await resolveDb(args);
    const domain = await resolveDomain(args);
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

    init(dbPath, domain);

    const hashed = await hashPassword(password);
    createInboxAddress(domain, name, hashed);

    consola.success(`Inbox "${name}@${domain}" created.`);
  },
});

const forward = defineCommand({
  meta: { name: "forward", description: "Create a forward alias" },
  args: {
    db: { type: "string", description: "Database path", valueHint: "path" },
    domain: { type: "string", description: "Domain name", alias: ["d"] },
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
    const dbPath = await resolveDb(args);
    const domain = await resolveDomain(args);
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

    init(dbPath, domain);
    createRoute({
      domain,
      pattern: name,
      targetAddress: target,
    });
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
