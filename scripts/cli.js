import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import config from "../src/config.js";
import { hashPassword } from "../src/crypto/password.js";
import { coreStore } from "../src/store/index.js";

function init(dbPath, domain) {
  config.core.path = dbPath;
  const core = coreStore();
  core.domains.create(domain);
  return core;
}

async function ask(args, key, label, def) {
  return (
    args[key] ||
    (await consola.prompt(`${label} (${def}):`, { type: "text", default: def }))
  );
}

const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Generate server keys and initialize domain",
  },
  args: {
    db: { type: "string", description: "Database path" },
    domain: { type: "string", description: "Domain name", alias: ["d"] },
  },
  async run({ args }) {
    const dbPath = await ask(
      args,
      "db",
      "Core DB path",
      process.env.CORE_DB || "./data/core.db",
    );
    const domain = await ask(
      args,
      "domain",
      "Domain name",
      process.env.DOMAIN || "localhost",
    );
    const core = init(dbPath, domain);
    const keys = core.domains.keys(domain);
    const rec = core.domains.dnsRecord(domain);
    consola.success(`Key ID: ${keys.key_id}`);
    consola.success(`Fingerprint: ${rec.fingerprint}`);
    consola.box(`DNS TXT for ${rec.name}:\n\n${rec.value}`);
  },
});

const inbox = defineCommand({
  meta: { name: "inbox", description: "Create an inbox alias" },
  args: {
    db: { type: "string" },
    domain: { type: "string", alias: ["d"] },
    name: { type: "string", alias: ["n"] },
    password: { type: "string", alias: ["p"] },
  },
  async run({ args }) {
    const dbPath = await ask(
      args,
      "db",
      "Core DB path",
      process.env.CORE_DB || "./data/core.db",
    );
    const domain = await ask(
      args,
      "domain",
      "Domain name",
      process.env.DOMAIN || "localhost",
    );
    const name =
      args.name ||
      (await consola.prompt("Alias (e.g. alice):", { type: "text" }));
    const password =
      args.password ??
      (await consola.prompt("Password:", { type: "text", default: "" }));
    if (!name) {
      consola.error("Alias required");
      process.exit(1);
    }

    const core = init(dbPath, domain);
    core.addresses.createInbox(domain, name, await hashPassword(password));
    consola.success(`Inbox "${name}@${domain}" created.`);
  },
});

const forward = defineCommand({
  meta: { name: "forward", description: "Create a forward route" },
  args: {
    db: { type: "string" },
    domain: { type: "string", alias: ["d"] },
    name: { type: "string", alias: ["n"] },
    target: { type: "string", alias: ["t"] },
  },
  async run({ args }) {
    const dbPath = await ask(
      args,
      "db",
      "Core DB path",
      process.env.CORE_DB || "./data/core.db",
    );
    const domain = await ask(
      args,
      "domain",
      "Domain name",
      process.env.DOMAIN || "localhost",
    );
    const name =
      args.name ||
      (await consola.prompt('Pattern (e.g. sales or "*"):', { type: "text" }));
    const target =
      args.target ||
      (await consola.prompt(`Target (e.g. alice@${domain}):`, {
        type: "text",
      }));
    if (!name || !target) {
      consola.error("Pattern and target required");
      process.exit(1);
    }

    const core = init(dbPath, domain);
    core.routes.create({ domain, pattern: name, targetAddress: target });
    consola.success(`Forward "${name}@${domain}" → ${target} created.`);
  },
});

runMain(
  defineCommand({
    meta: { name: "smxp", version: "1.0.0", description: "SMXP server CLI" },
    subCommands: { setup, inbox, forward },
  }),
);
