import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import config from "../src/config.js";
import { hashPassword } from "../src/crypto/password.js";
import { init, closeStores, coreStore } from "../src/store/index.js";

function initStore(dbPath, domain) {
  config.core.path = dbPath;
  init(config);
  coreStore.domains.create(domain);
}

async function prompt(args, key, label, fallback) {
  if (args[key]) return args[key];
  return consola.prompt(`${label} (${fallback}):`, {
    type: "text",
    default: fallback,
  });
}

async function resolveCommon(args) {
  const dbPath = await prompt(
    args,
    "db",
    "Core DB path",
    process.env.CORE_DB || "./data/core.db",
  );
  const domain = await prompt(
    args,
    "domain",
    "Domain name",
    process.env.DOMAIN || "localhost",
  );
  initStore(dbPath, domain);
  return { dbPath, domain };
}

const commonArgs = {
  db: { type: "string", description: "Database path" },
  domain: { type: "string", description: "Domain name", alias: ["d"] },
};

const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Generate server keys and initialize domain",
  },
  args: { ...commonArgs },
  async run({ args }) {
    const { domain } = await resolveCommon(args);
    try {
      const keys = coreStore.domains.keys(domain);
      const rec = coreStore.domains.dnsRecord(domain);
      consola.success(`Key ID: ${keys.key_id}`);
      consola.success(`Fingerprint: ${rec.fingerprint}`);
      consola.box(`DNS TXT for ${rec.name}:\n\n${rec.value}`);
    } finally {
      closeStores();
    }
  },
});

const inbox = defineCommand({
  meta: { name: "inbox", description: "Create an inbox alias" },
  args: {
    ...commonArgs,
    name: { type: "string", alias: ["n"], description: "Alias (e.g. alice)" },
    password: { type: "string", alias: ["p"], description: "Password" },
  },
  async run({ args }) {
    const { domain } = await resolveCommon(args);
    try {
      const name =
        args.name ||
        (await consola.prompt("Alias (e.g. alice):", { type: "text" }));
      if (!name) {
        consola.error("Alias required");
        process.exit(1);
      }
      const password =
        args.password ??
        (await consola.prompt("Password:", { type: "text", default: "" }));

      coreStore.addresses.createInbox(
        domain,
        name,
        await hashPassword(password),
      );
      consola.success(`Inbox "${name}@${domain}" created.`);
    } finally {
      closeStores();
    }
  },
});

const forward = defineCommand({
  meta: { name: "forward", description: "Create a forward route" },
  args: {
    ...commonArgs,
    name: {
      type: "string",
      alias: ["n"],
      description: 'Pattern (e.g. sales or "*")',
    },
    target: {
      type: "string",
      alias: ["t"],
      description: "Target address (e.g. alice@example.com)",
    },
  },
  async run({ args }) {
    const { domain } = await resolveCommon(args);
    try {
      const name =
        args.name ||
        (await consola.prompt('Pattern (e.g. sales or "*"):', {
          type: "text",
        }));
      const target =
        args.target ||
        (await consola.prompt(`Target (e.g. alice@${domain}):`, {
          type: "text",
        }));
      if (!name || !target) {
        consola.error("Pattern and target required");
        process.exit(1);
      }

      coreStore.routes.create({ domain, pattern: name, targetAddress: target });
      consola.success(`Forward "${name}@${domain}" → ${target} created.`);
    } finally {
      closeStores();
    }
  },
});

runMain(
  defineCommand({
    meta: { name: "smxp", version: "1.0.0", description: "SMXP server CLI" },
    subCommands: { setup, inbox, forward },
  }),
);
