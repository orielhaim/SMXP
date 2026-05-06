import { formatAddress, parseAddress } from "../shared/address.js";
import { getDb } from "./db.js";
import { createDomain } from "./domains.js";

export function createInboxAddress(
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
    throw new Error("wildcard addresses can only be forwards");
  }
  if (!passwordHash) {
    throw new Error("address password hash is required");
  }

  createDomain(normalizedDomain);
  db.run("BEGIN TRANSACTION");
  try {
    db.run(
      `INSERT OR REPLACE INTO addresses (
        domain,
        alias,
        mode,
        forward_to,
        password_hash
      ) VALUES (?, ?, 'inbox', NULL, ?)`,
      [normalizedDomain, normalizedAlias, passwordHash],
    );

    db.run(
      `INSERT OR REPLACE INTO signing_keys (
        key_id,
        domain,
        alias,
        algorithm,
        public_key,
        secret_key
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        keyId,
        normalizedDomain,
        normalizedAlias,
        algorithm,
        publicKey,
        secretKey,
      ],
    );
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

export function createForwardAddress(domain, alias, forwardToList) {
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

    const targetAddress = getAddress(target.domain, target.localPart);
    if (!targetAddress || targetAddress.mode !== "inbox") {
      throw new Error(
        `forward target "${target.address}" must be an inbox address`,
      );
    }
  }

  createDomain(normalizedDomain);

  const normalizedTargets = targets.map((addr) => parseAddress(addr).address);
  db.run(
    `INSERT OR REPLACE INTO addresses (
      domain,
      alias,
      mode,
      forward_to,
      password_hash
    ) VALUES (?, ?, 'forward', ?, NULL)`,
    [normalizedDomain, normalizedAlias, normalizedTargets.join(",")],
  );
}

export function getAddress(domain, alias) {
  const db = getDb();
  const addr = db
    .query(`SELECT * FROM addresses WHERE domain = ? AND alias = ?`)
    .get(domain.trim().toLowerCase(), alias.trim().toLowerCase());
  if (!addr) return null;

  if (addr.mode === "inbox") {
    const key = db
      .query(
        `SELECT * FROM signing_keys WHERE domain = ? AND alias = ? LIMIT 1`,
      )
      .get(addr.domain, addr.alias);
    if (key) {
      addr.public_key = key.public_key;
      addr.secret_key = key.secret_key;
      addr.key_id = key.key_id;
      addr.algorithm = key.algorithm;
    }
  }
  return addr;
}

export function getAllAddresses() {
  const db = getDb();
  const addresses = db
    .query(
      `SELECT a.domain, a.alias, a.mode, a.forward_to, a.created_at, k.public_key, k.key_id, k.algorithm
       FROM addresses a
       LEFT JOIN signing_keys k ON a.domain = k.domain AND a.alias = k.alias
       ORDER BY a.domain, a.alias`,
    )
    .all();
  return addresses;
}

export function getAddressesForDomain(domain) {
  const db = getDb();
  const addresses = db
    .query(
      `SELECT a.domain, a.alias, a.mode, a.forward_to, a.created_at, k.public_key, k.key_id, k.algorithm
       FROM addresses a
       LEFT JOIN signing_keys k ON a.domain = k.domain AND a.alias = k.alias
       WHERE a.domain = ?
       ORDER BY a.alias`,
    )
    .all(domain.trim().toLowerCase());
  return addresses;
}

export function deleteAddress(domain, alias) {
  const db = getDb();
  const result = db
    .query(
      `DELETE FROM addresses WHERE domain = ? AND alias = ? RETURNING alias`,
    )
    .get(domain.trim().toLowerCase(), alias.trim().toLowerCase());
  return !!result;
}

export function getInboxAddressByAddress(address) {
  const { domain, localPart } = parseAddress(address);
  const addr = getAddress(domain, localPart);

  if (!addr || addr.mode !== "inbox") {
    return null;
  }

  return addr;
}

/**
 * Parses forward_to field
 */
function parseForwardTo(forwardTo) {
  if (!forwardTo) return [];
  return forwardTo
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolves a delivery address through forward chains (including multi-target).
 * Returns an array of delivery results, or null if the address doesn't exist.
 * Each result: { address, originalAddress, deliveredTo }
 */
export function resolveDeliveryAddress(address) {
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
    const exactAddress = getAddress(parsed.domain, parsed.localPart);
    const addr =
      exactAddress ?? (isRoot ? getAddress(parsed.domain, "*") : null);

    if (!addr) {
      if (isRoot) return null;
      continue;
    }

    if (addr.mode === "inbox") {
      results.push({
        address: addr,
        originalAddress,
        deliveredTo: formatAddress(addr.alias, addr.domain),
      });
    } else {
      const targets = parseForwardTo(addr.forward_to);
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

export const createAddress = createInboxAddress;
