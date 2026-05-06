import { timingSafeEqual } from "node:crypto";
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
  createForwardAlias,
  createInboxAlias,
  deleteAlias,
  getAlias,
  getAliasesForDomain,
  getAllAliases,
} from "../store/aliases.js";
import {
  createDomain,
  deleteDomain,
  domainExists,
  getAllDomains,
} from "../store/domains.js";
import { getServerDnsRecord } from "../store/server-config.js";
import { fetchDnsFingerprint } from "./verification.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeDomain(domain) {
  if (typeof domain !== "string") {
    throw new Error("domain is required");
  }

  const normalized = domain.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("@") ||
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    !/^[a-z0-9.-]+$/.test(normalized)
  ) {
    throw new Error(`invalid domain "${domain}"`);
  }

  return normalized;
}

function normalizeAlias(alias) {
  if (typeof alias !== "string") {
    throw new Error("alias is required");
  }

  const normalized = alias.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("@") ||
    normalized.includes("/") ||
    (normalized !== "*" && !/^[a-z0-9._+-]+$/.test(normalized))
  ) {
    throw new Error(`invalid alias "${alias}"`);
  }

  return normalized;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("invalid JSON");
  }
}

function getAdminKeyFromRequest(request) {
  const bearer = request.headers.get("authorization") || "";
  if (bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }

  return request.headers.get("x-admin-api-key") || "";
}

function isAuthorized(request) {
  if (!config.adminSecret) {
    return false;
  }

  const provided = Buffer.from(getAdminKeyFromRequest(request));
  const expected = Buffer.from(config.adminSecret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function requireAdmin(request) {
  if (!config.adminSecret) {
    return jsonResponse({ error: "admin API key is not configured" }, 503);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  return null;
}

function serviceDnsRecord(domain) {
  return {
    name: `_smxp.${domain}`,
    type: "SVCB",
    value: `1 ${config.host} alpn=h2 port=${config.port}`,
  };
}

function domainResponse(domain) {
  return {
    domain,
    dns: {
      key: getServerDnsRecord(domain),
      service: serviceDnsRecord(domain),
    },
  };
}

export async function adminListDomains(request) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  return jsonResponse({
    domains: getAllDomains().map((domain) => ({
      ...domain,
      dns: {
        key: getServerDnsRecord(domain.domain),
        service: serviceDnsRecord(domain.domain),
      },
    })),
  });
}

export async function adminCreateDomain(request) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const body = await parseJsonBody(request);
    const domain = normalizeDomain(body.domain);
    createDomain(domain);
    return jsonResponse(domainResponse(domain), 201);
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminGetDomain(request, domainName) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const domain = normalizeDomain(domainName);
    const existing = getAllDomains().find((row) => row.domain === domain);
    if (!existing) {
      return jsonResponse({ error: "domain not found" }, 404);
    }

    return jsonResponse({ ...existing, ...domainResponse(domain) });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminVerifyDomain(request, domainName) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const domain = normalizeDomain(domainName);
    if (!domainExists(domain)) {
      return jsonResponse({ error: "domain not found" }, 404);
    }

    const expected = getServerDnsRecord(domain);
    const actualFingerprint = await fetchDnsFingerprint(domain);
    const verified = actualFingerprint === expected.fingerprint;
    let service = null;

    try {
      service = await discoverSmxp(domain);
    } catch (err) {
      service = { error: err.message };
    }

    return jsonResponse(
      {
        domain,
        verified,
        expected_fingerprint: expected.fingerprint,
        actual_fingerprint: actualFingerprint,
        service,
      },
      verified ? 200 : 409,
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminDeleteDomain(request, domainName) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const domain = normalizeDomain(domainName);
    if (!deleteDomain(domain)) {
      return jsonResponse({ error: "domain not found" }, 404);
    }

    return jsonResponse({ status: "deleted", domain });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminListAliases(request) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");
    const aliases = domain
      ? getAliasesForDomain(normalizeDomain(domain))
      : getAllAliases();

    return jsonResponse({ aliases });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminCreateAlias(request) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const body = await parseJsonBody(request);
    const domain = normalizeDomain(body.domain);
    const alias = normalizeAlias(body.alias);
    const mode = body.mode || "inbox";

    if (!["inbox", "forward"].includes(mode)) {
      return jsonResponse({ error: "mode must be inbox or forward" }, 400);
    }

    const passwordHash = hashPassword(body.password);

    if (!domainExists(domain)) {
      return jsonResponse({ error: "domain does not exist" }, 404);
    }

    if (getAlias(domain, alias)) {
      return jsonResponse({ error: "alias already exists" }, 409);
    }

    if (mode === "inbox") {
      if (alias === "*") {
        return jsonResponse(
          { error: "wildcard aliases can only be forwards" },
          400,
        );
      }

      const keys = generateKeyPair();
      const publicKey = serializePublicKey(keys.publicKey);
      createInboxAlias(
        domain,
        alias,
        passwordHash,
        publicKey,
        serializeSecretKey(keys.secretKey),
        keys.keyId,
        keys.algorithm,
      );

      return jsonResponse(
        {
          address: `${alias}@${domain}`,
          domain,
          alias,
          mode,
          public_key: publicKey,
          key_id: keys.keyId,
          algorithm: keys.algorithm,
        },
        201,
      );
    }

    if (!body.forward_to) {
      return jsonResponse(
        { error: "forward_to is required for forward aliases" },
        400,
      );
    }

    const forwardList = Array.isArray(body.forward_to)
      ? body.forward_to
      : [body.forward_to];

    if (forwardList.length === 0) {
      return jsonResponse(
        { error: "at least one forward target is required" },
        400,
      );
    }

    const normalizedTargets = [];
    for (const addr of forwardList) {
      let target;
      try {
        target = parseAddress(addr);
      } catch {
        return jsonResponse(
          { error: `invalid forward target address "${addr}"` },
          400,
        );
      }

      if (target.domain !== domain) {
        return jsonResponse(
          {
            error: `forward target "${target.address}" must belong to the same domain`,
          },
          400,
        );
      }

      const targetAlias = getAlias(target.domain, target.localPart);
      if (!targetAlias || targetAlias.mode !== "inbox") {
        return jsonResponse(
          {
            error: `forward target "${target.address}" must be an inbox alias`,
          },
          targetAlias ? 400 : 404,
        );
      }

      normalizedTargets.push(target.address);
    }

    createForwardAlias(domain, alias, normalizedTargets);

    return jsonResponse(
      {
        address: `${alias}@${domain}`,
        domain,
        alias,
        mode,
        forward_to: normalizedTargets,
      },
      201,
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminGetAlias(request, domainName, aliasName) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const domain = normalizeDomain(domainName);
    const alias = normalizeAlias(aliasName);
    const row = getAlias(domain, alias);
    if (!row) {
      return jsonResponse({ error: "alias not found" }, 404);
    }

    const safeAlias = { ...row };
    delete safeAlias.password_hash;
    delete safeAlias.secret_key;
    return jsonResponse({ alias: safeAlias });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

export async function adminDeleteAlias(request, domainName, aliasName) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  try {
    const domain = normalizeDomain(domainName);
    const alias = normalizeAlias(aliasName);
    if (!deleteAlias(domain, alias)) {
      return jsonResponse({ error: "alias not found" }, 404);
    }

    return jsonResponse({ status: "deleted", domain, alias });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}
