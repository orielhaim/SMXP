import { formatAddress, parseAddress } from "../shared/address.js";
import { getDb } from "./db.js";
import { createDomain } from "./domains.js";

export function createInboxAlias(
  domain,
  alias,
  passwordHash,
  publicKey,
  secretKey,
  keyId,
  algorithm = "ML-DSA-65",
) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedAlias = alias.trim().toLowerCase();

  if (normalizedAlias === "*") {
    throw new Error("wildcard aliases can only be forwards");
  }
  if (!passwordHash) {
    throw new Error("alias password hash is required");
  }

  createDomain(normalizedDomain);
  db.run(
    `INSERT OR REPLACE INTO aliases (
      domain,
      alias,
      mode,
      forward_to,
      password_hash,
      public_key,
      secret_key,
      key_id,
      algorithm
    ) VALUES (?, ?, 'inbox', NULL, ?, ?, ?, ?, ?)`,
    [
      normalizedDomain,
      normalizedAlias,
      passwordHash,
      publicKey,
      secretKey,
      keyId,
      algorithm,
    ],
  );
}

export function createForwardAlias(domain, alias, forwardTo) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedAlias = alias.trim().toLowerCase();
  const target = parseAddress(forwardTo);

  if (target.domain !== normalizedDomain) {
    throw new Error("forward targets must belong to the same domain");
  }

  createDomain(normalizedDomain);
  const targetAlias = getAlias(target.domain, target.localPart);
  if (!targetAlias || targetAlias.mode !== "inbox") {
    throw new Error(
      `forward target "${target.address}" must be an inbox alias`,
    );
  }

  db.run(
    `INSERT OR REPLACE INTO aliases (
      domain,
      alias,
      mode,
      forward_to,
      public_key,
      secret_key,
      key_id,
      algorithm
    ) VALUES (?, ?, 'forward', ?, NULL, NULL, NULL, 'ML-DSA-65')`,
    [normalizedDomain, normalizedAlias, target.address],
  );
}

export function getAlias(domain, alias) {
  const db = getDb();
  return db
    .query(`SELECT * FROM aliases WHERE domain = ? AND alias = ?`)
    .get(domain.trim().toLowerCase(), alias.trim().toLowerCase());
}

export function getAllAliases() {
  const db = getDb();
  return db
    .query(
      `SELECT domain, alias, mode, forward_to, public_key, key_id, algorithm, created_at
       FROM aliases
       ORDER BY domain, alias`,
    )
    .all();
}

export function getAliasesForDomain(domain) {
  const db = getDb();
  return db
    .query(
      `SELECT domain, alias, mode, forward_to, public_key, key_id, algorithm, created_at
       FROM aliases
       WHERE domain = ?
       ORDER BY alias`,
    )
    .all(domain.trim().toLowerCase());
}

export function deleteAlias(domain, alias) {
  const db = getDb();
  const result = db
    .query(`DELETE FROM aliases WHERE domain = ? AND alias = ? RETURNING alias`)
    .get(domain.trim().toLowerCase(), alias.trim().toLowerCase());
  return !!result;
}

export function getInboxAliasByAddress(address) {
  const { domain, localPart } = parseAddress(address);
  const alias = getAlias(domain, localPart);

  if (!alias || alias.mode !== "inbox") {
    return null;
  }

  return alias;
}

export function resolveDeliveryAlias(address) {
  const parsed = parseAddress(address);
  let currentLocalPart = parsed.localPart;
  const visited = new Set();

  for (let depth = 0; depth < 100; depth++) {
    const currentAddress = formatAddress(currentLocalPart, parsed.domain);
    if (visited.has(currentAddress)) {
      throw new Error(`forward loop detected at ${currentAddress}`);
    }
    visited.add(currentAddress);

    const exactAlias = getAlias(parsed.domain, currentLocalPart);
    const alias =
      exactAlias ?? (depth === 0 ? getAlias(parsed.domain, "*") : null);

    if (!alias) {
      return null;
    }

    if (alias.mode === "inbox") {
      return {
        alias,
        originalAddress: parsed.address,
        deliveredTo: formatAddress(alias.alias, alias.domain),
      };
    }

    const target = parseAddress(alias.forward_to);
    if (target.domain !== parsed.domain) {
      throw new Error("forward targets must belong to the same domain");
    }
    currentLocalPart = target.localPart;
  }

  throw new Error("forward chain is too deep");
}

export const createAlias = createInboxAlias;
