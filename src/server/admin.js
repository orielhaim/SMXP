import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import config from "../config.js";
import {
  generateKeyPair,
  serializePublicKey,
  serializeSecretKey,
} from "../crypto/keys.js";
import { hashPassword } from "../crypto/password.js";
import { discoverSmxp } from "../dns/discover.js";
import { parseAddress } from "../shared/address.js";
import {
  createForwardAddress,
  createInboxAddress,
  deleteAddress,
  getAddress,
  getAddressesForDomain,
  getAllAddresses,
} from "../store/addresses.js";
import {
  createDomain,
  deleteDomain,
  domainExists,
  getAllDomains,
} from "../store/domains.js";
import { getServerDnsRecord } from "../store/server-config.js";
import { fetchDnsFingerprint } from "./verification.js";

function normalizeDomain(domain) {
  const v = domain.trim().toLowerCase();
  if (
    !v ||
    v.includes("@") ||
    v.startsWith(".") ||
    v.endsWith(".") ||
    !/^[a-z0-9.-]+$/.test(v)
  )
    throw new Error(`invalid domain "${domain}"`);
  return v;
}

function normalizeAlias(alias) {
  const v = alias.trim().toLowerCase();
  if (
    !v ||
    v.includes("@") ||
    v.includes("/") ||
    (v !== "*" && !/^[a-z0-9._+-]+$/.test(v))
  )
    throw new Error(`invalid alias "${alias}"`);
  return v;
}

function isAuthorized(headers) {
  if (!config.adminSecret) return false;
  const auth = headers.authorization ?? headers.authorization ?? "";
  const key = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : (headers["x-admin-api-key"] ?? "");
  if (!key) return false;
  const provided = Buffer.from(key);
  const expected = Buffer.from(config.adminSecret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function serviceDnsRecord(domain) {
  return {
    name: `_smxp.${domain}`,
    type: "SVCB",
    value: `1 ${config.host} alpn=h2 port=${config.port}`,
  };
}

function domainPayload(domain) {
  return {
    domain,
    dns: {
      key: getServerDnsRecord(domain),
      service: serviceDnsRecord(domain),
    },
  };
}

export function adminRoutes() {
  return new Elysia({ prefix: "/.smxp/admin" })

    .onBeforeHandle(({ headers, set }) => {
      if (!config.adminSecret) {
        set.status = 503;
        return { error: "admin API key is not configured" };
      }
      if (!isAuthorized(headers)) {
        set.status = 401;
        return { error: "unauthorized" };
      }
    })

    .get(
      "/domains",
      () => ({
        domains: getAllDomains().map((d) => ({
          ...d,
          ...domainPayload(d.domain),
        })),
      }),
      { detail: { tags: ["Admin"], summary: "List all domains" } },
    )

    .post(
      "/domains",
      ({ body, set }) => {
        try {
          const domain = normalizeDomain(body.domain);
          createDomain(domain);
          set.status = 201;
          return domainPayload(domain);
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        body: t.Object({ domain: t.String({ minLength: 1 }) }),
        detail: { tags: ["Admin"], summary: "Add a domain" },
      },
    )

    .get(
      "/domains/:domain",
      ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          const existing = getAllDomains().find((r) => r.domain === domain);
          if (!existing) {
            set.status = 404;
            return { error: "domain not found" };
          }
          return { ...existing, ...domainPayload(domain) };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String() }),
        detail: { tags: ["Admin"], summary: "Get a domain by name" },
      },
    )

    .post(
      "/domains/:domain/verify",
      async ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          if (!domainExists(domain)) {
            set.status = 404;
            return { error: "domain not found" };
          }

          const expected = getServerDnsRecord(domain);
          const actual = await fetchDnsFingerprint(domain).catch(() => null);
          const verified = actual === expected.fingerprint;
          const service = await discoverSmxp(domain).catch((err) => ({
            error: err.message,
          }));

          set.status = verified ? 200 : 409;
          return {
            domain,
            verified,
            expected_fingerprint: expected.fingerprint,
            actual_fingerprint: actual,
            service,
          };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String() }),
        detail: { tags: ["Admin"], summary: "Verify a domain's DNS records" },
      },
    )

    .delete(
      "/domains/:domain",
      ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          if (!deleteDomain(domain)) {
            set.status = 404;
            return { error: "domain not found" };
          }
          return { status: "deleted", domain };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String() }),
        detail: {
          tags: ["Admin"],
          summary: "Delete a domain and all its addresses",
        },
      },
    )

    .get(
      "/addresses",
      ({ query, set }) => {
        try {
          const addresses = query.domain
            ? getAddressesForDomain(normalizeDomain(query.domain))
            : getAllAddresses();
          return { addresses };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        query: t.Object({ domain: t.Optional(t.String()) }),
        detail: {
          tags: ["Admin"],
          summary: "List addresses, optionally filtered by domain",
        },
      },
    )

    .post(
      "/addresses",
      async ({ body, set }) => {
        try {
          const domain = normalizeDomain(body.domain);
          const alias = normalizeAlias(body.alias);
          const mode = body.mode ?? "inbox";

          if (!domainExists(domain)) {
            set.status = 404;
            return { error: "domain does not exist" };
          }
          if (getAddress(domain, alias)) {
            set.status = 409;
            return { error: "address already exists" };
          }

          if (mode === "inbox") {
            if (alias === "*") {
              set.status = 400;
              return { error: "wildcard addresses can only be forwards" };
            }
            const keys = generateKeyPair();
            const publicKey = serializePublicKey(keys.publicKey);
            createInboxAddress(
              domain,
              alias,
              await hashPassword(body.password ?? ""),
              publicKey,
              serializeSecretKey(keys.secretKey),
              keys.keyId,
              keys.algorithm,
            );
            set.status = 201;
            return {
              address: `${alias}@${domain}`,
              domain,
              alias,
              mode,
              public_key: publicKey,
              key_id: keys.keyId,
              algorithm: keys.algorithm,
            };
          }

          // forward
          if (!body.forward_to) {
            set.status = 400;
            return { error: "forward_to is required for forward addresses" };
          }
          const targets = Array.isArray(body.forward_to)
            ? body.forward_to
            : [body.forward_to];
          if (targets.length === 0) {
            set.status = 400;
            return { error: "at least one forward target is required" };
          }

          const normalized = [];
          for (const addr of targets) {
            let parsed;
            try {
              parsed = parseAddress(addr);
            } catch {
              set.status = 400;
              return { error: `invalid forward target "${addr}"` };
            }
            if (parsed.domain !== domain) {
              set.status = 400;
              return {
                error: `forward target "${parsed.address}" must belong to the same domain`,
              };
            }
            const target = getAddress(parsed.domain, parsed.localPart);
            if (!target || target.mode !== "inbox") {
              set.status = target ? 400 : 404;
              return {
                error: `forward target "${parsed.address}" must be an inbox address`,
              };
            }
            normalized.push(parsed.address);
          }

          createForwardAddress(domain, alias, normalized);
          set.status = 201;
          return {
            address: `${alias}@${domain}`,
            domain,
            alias,
            mode,
            forward_to: normalized,
          };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        body: t.Object({
          domain: t.String({ minLength: 1 }),
          alias: t.String({ minLength: 1 }),
          mode: t.Optional(t.Union([t.Literal("inbox"), t.Literal("forward")])),
          password: t.Optional(
            t.String({ description: "Required for inbox addresses" }),
          ),
          forward_to: t.Optional(t.Union([t.String(), t.Array(t.String())]), {
            description: "Required for forward addresses",
          }),
        }),
        detail: {
          tags: ["Admin"],
          summary: "Create an inbox or forward address",
        },
      },
    )

    .get(
      "/addresses/:domain/:alias",
      ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          const alias = normalizeAlias(params.alias);
          const row = getAddress(domain, alias);
          if (!row) {
            set.status = 404;
            return { error: "address not found" };
          }
          const { password_hash, secret_key, ...safe } = row;
          return { address: safe };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String(), alias: t.String() }),
        detail: {
          tags: ["Admin"],
          summary: "Get an address by domain and alias",
        },
      },
    )

    .delete(
      "/addresses/:domain/:alias",
      ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          const alias = normalizeAlias(params.alias);
          if (!deleteAddress(domain, alias)) {
            set.status = 404;
            return { error: "address not found" };
          }
          return { status: "deleted", domain, alias };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String(), alias: t.String() }),
        detail: { tags: ["Admin"], summary: "Delete an address" },
      },
    );
}
