import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import config from "../config.js";
import { hashPassword } from "../crypto/password.js";
import { discoverSmxp } from "../dns/discover.js";
import {
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
  getDomainDnsRecord,
} from "../store/domains.js";
import {
  createRoute,
  deleteRoute,
  getRoute,
  getRoutes,
  updateRoute,
} from "../store/routes.js";
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
      key: getDomainDnsRecord(domain),
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

          const expected = getDomainDnsRecord(domain);
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
          if (!domainExists(domain)) {
            set.status = 404;
            return { error: "domain does not exist" };
          }
          if (getAddress(domain, alias)) {
            set.status = 409;
            return { error: "address already exists" };
          }

          createInboxAddress(
            domain,
            alias,
            await hashPassword(body.password ?? ""),
          );
          set.status = 201;
          return {
            address: `${alias}@${domain}`,
            domain,
            alias,
            mode: "inbox",
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
          password: t.Optional(
            t.String({ description: "Required for inbox addresses" }),
          ),
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
          const { password_hash, ...safe } = row;
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
    )

    .get(
      "/routes/:domain",
      ({ params, set }) => {
        try {
          const domain = normalizeDomain(params.domain);
          if (!domainExists(domain)) {
            set.status = 404;
            return { error: "domain not found" };
          }
          return { routes: getRoutes(domain) };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ domain: t.String() }),
        detail: { tags: ["Admin"], summary: "List routing rules" },
      },
    )

    .post(
      "/routes",
      ({ body, set }) => {
        try {
          const domain = normalizeDomain(body.domain);
          if (!domainExists(domain)) {
            set.status = 404;
            return { error: "domain not found" };
          }
          const route = createRoute({
            domain,
            pattern: body.pattern,
            targetAddress: body.target_address,
            priority: body.priority ?? 0,
            enabled: body.enabled ?? 1,
          });
          set.status = 201;
          return { route };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        body: t.Object({
          domain: t.String({ minLength: 1 }),
          pattern: t.String({ minLength: 1 }),
          target_address: t.String({ minLength: 1 }),
          priority: t.Optional(t.Number()),
          enabled: t.Optional(t.Number()),
        }),
        detail: { tags: ["Admin"], summary: "Create a routing rule" },
      },
    )

    .put(
      "/routes/:id",
      ({ params, body, set }) => {
        try {
          if (!getRoute(params.id)) {
            set.status = 404;
            return { error: "route not found" };
          }
          return {
            route: updateRoute(params.id, {
              pattern: body.pattern,
              targetAddress: body.target_address,
              priority: body.priority,
              enabled: body.enabled,
            }),
          };
        } catch (err) {
          set.status = 400;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          pattern: t.Optional(t.String({ minLength: 1 })),
          target_address: t.Optional(t.String({ minLength: 1 })),
          priority: t.Optional(t.Number()),
          enabled: t.Optional(t.Number()),
        }),
        detail: { tags: ["Admin"], summary: "Update a routing rule" },
      },
    )

    .delete(
      "/routes/:id",
      ({ params, set }) => {
        if (!deleteRoute(params.id)) {
          set.status = 404;
          return { error: "route not found" };
        }
        return { status: "deleted", id: params.id };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Admin"], summary: "Delete a routing rule" },
      },
    );
}
