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

export function createForwardAlias(domain, alias, forwardToList) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedAlias = alias.trim().toLowerCase();

  const targets = Array.isArray(forwardToList)
    ? forwardToList
    : [forwardToList];

  if (targets.length === 0) {
    throw new Error("at least one forward target is required");
  }

  for (const addr of targets) {
    const target = parseAddress(addr);
    if (target.domain !== normalizedDomain) {
      throw new Error(
        `forward target "${target.address}" must belong to the same domain`,
      );
    }

    const targetAlias = getAlias(target.domain, target.localPart);
    if (!targetAlias || targetAlias.mode !== "inbox") {
      throw new Error(
        `forward target "${target.address}" must be an inbox alias`,
      );
    }
  }

  createDomain(normalizedDomain);

  const normalizedTargets = targets.map((addr) => parseAddress(addr).address);
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
    [normalizedDomain, normalizedAlias, JSON.stringify(normalizedTargets)],
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

/**
 * Parses forward_to field — handles both legacy single string
 * and new JSON array format.
 */
function parseForwardTo(forwardTo) {
  if (!forwardTo) return [];
  try {
    const parsed = JSON.parse(forwardTo);
    if (Array.isArray(parsed)) return parsed;
    return [forwardTo];
  } catch {
    return [forwardTo];
  }
}

/**
 * Resolves a delivery address through forward chains (including multi-target).
 * Returns an array of delivery results, or null if the address doesn't exist.
 * Each result: { alias, originalAddress, deliveredTo }
 */
export function resolveDeliveryAlias(address) {
  const originalAddress = parseAddress(address).address;
  const results = [];
  const queue = [{ address: originalAddress, depth: 0, isRoot: true }];
  const visited = new Set();

  while (queue.length > 0) {
    const { address: currentAddress, depth, isRoot } = queue.shift();

    if (depth > 100) {
      throw new Error("forward chain is too deep");
    }
    if (visited.has(currentAddress)) {
      throw new Error(`forward loop detected at ${currentAddress}`);
    }
    visited.add(currentAddress);

    const parsed = parseAddress(currentAddress);
    const exactAlias = getAlias(parsed.domain, parsed.localPart);
    const alias = exactAlias ?? (isRoot ? getAlias(parsed.domain, "*") : null);

    if (!alias) {
      if (isRoot) return null;
      continue;
    }

    if (alias.mode === "inbox") {
      results.push({
        alias,
        originalAddress,
        deliveredTo: formatAddress(alias.alias, alias.domain),
      });
    } else {
      const targets = parseForwardTo(alias.forward_to);
      for (const target of targets) {
        const targetParsed = parseAddress(target);
        if (targetParsed.domain !== parsed.domain) {
          throw new Error("forward targets must belong to the same domain");
        }
        queue.push({
          address: targetParsed.address,
          depth: depth + 1,
          isRoot: false,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

export const createAlias = createInboxAlias;
