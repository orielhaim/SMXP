import { randomBytes } from "node:crypto";
import { toBase64Url } from "../shared/encoding.js";
import { getDb } from "./db.js";

export function generateDelegationId() {
  return `dlg_${toBase64Url(randomBytes(8))}`;
}

export function createDelegation({
  domain,
  alias,
  delegate,
  scope = "send",
  expiresAt = null,
}) {
  const db = getDb();
  const id = generateDelegationId();

  db.run(
    `INSERT INTO delegations (id, domain, alias, delegate, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, domain, alias, delegate, scope, expiresAt],
  );

  return { id, domain, alias, delegate, scope, expires_at: expiresAt };
}

export function getDelegations(domain, alias) {
  const db = getDb();
  return db
    .query(
      `SELECT id, domain, alias, delegate, scope, created_at, expires_at
       FROM delegations
       WHERE domain = ? AND alias = ?
       ORDER BY created_at DESC`,
    )
    .all(domain, alias);
}

export function getDelegationByDelegate(domain, alias, delegate) {
  const db = getDb();
  return db
    .query(
      `SELECT id, domain, alias, delegate, scope, created_at, expires_at
       FROM delegations
       WHERE domain = ? AND alias = ? AND delegate = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(domain, alias, delegate);
}

export function deleteDelegation(domain, alias, id) {
  const db = getDb();
  const result = db
    .query(
      `DELETE FROM delegations WHERE domain = ? AND alias = ? AND id = ? RETURNING id`,
    )
    .get(domain, alias, id);
  return !!result;
}

export function getDelegationsGrantedTo(delegate) {
  const db = getDb();
  return db
    .query(
      `SELECT id, domain, alias, delegate, scope, created_at, expires_at
       FROM delegations
       WHERE delegate = ?
       ORDER BY created_at DESC`,
    )
    .all(delegate);
}

export function deleteExpiredDelegations() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.run(
    `DELETE FROM delegations WHERE expires_at IS NOT NULL AND expires_at < ?`,
    [now],
  );
}
