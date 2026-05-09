import { parseAddress } from "../shared/address.js";
import { getDb } from "./db.js";
import { createDomain } from "./domains.js";

function hasLegacyAddressColumns(db) {
  const columns = new Set(
    db
      .query(`PRAGMA table_info(addresses)`)
      .all()
      .map((column) => column.name),
  );
  return columns.has("mode") && columns.has("forward_to");
}

export function createInboxAddress(domain, alias, passwordHash) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedAlias = alias.trim().toLowerCase();

  if (normalizedAlias.includes("*")) {
    throw new Error("wildcards belong in routing rules, not inbox addresses");
  }
  if (!passwordHash) {
    throw new Error("address password hash is required");
  }

  createDomain(normalizedDomain);

  if (hasLegacyAddressColumns(db)) {
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
    return;
  }

  db.run(
    `INSERT OR REPLACE INTO addresses (
      domain,
      alias,
      password_hash
    ) VALUES (?, ?, ?)`,
    [normalizedDomain, normalizedAlias, passwordHash],
  );
}

export function getAddress(domain, alias) {
  const db = getDb();
  const row = db
    .query(
      `SELECT domain, alias, password_hash, created_at
       FROM addresses
       WHERE domain = ? AND alias = ?`,
    )
    .get(domain.trim().toLowerCase(), alias.trim().toLowerCase());

  return row ? { ...row, mode: "inbox" } : null;
}

export function getAllAddresses() {
  const db = getDb();
  return db
    .query(
      `SELECT domain, alias, created_at
       FROM addresses
       ORDER BY domain, alias`,
    )
    .all()
    .map((row) => ({ ...row, mode: "inbox" }));
}

export function getAddressesForDomain(domain) {
  const db = getDb();
  return db
    .query(
      `SELECT domain, alias, created_at
       FROM addresses
       WHERE domain = ?
       ORDER BY alias`,
    )
    .all(domain.trim().toLowerCase())
    .map((row) => ({ ...row, mode: "inbox" }));
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
  return getAddress(domain, localPart);
}

export const createAddress = createInboxAddress;
