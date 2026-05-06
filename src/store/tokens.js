import { createHash, randomBytes } from "node:crypto";
import { toBase64Url } from "../shared/encoding.js";
import { getDb } from "./db.js";

const SESSION_LIFETIME = 7 * 24 * 3600; // 7 days in seconds

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(type) {
  const prefix = type === "session" ? "smxp_ses_" : "smxp_key_";
  const raw = toBase64Url(randomBytes(32));
  return prefix + raw;
}

export function generateTokenId(prefix = "") {
  return prefix + toBase64Url(randomBytes(8));
}

export function createToken({
  alias,
  domain,
  type,
  name = null,
  expiresAt = null,
}) {
  const db = getDb();
  const token = generateToken(type);
  const id =
    type === "apikey"
      ? `ak_${toBase64Url(randomBytes(6))}`
      : toBase64Url(randomBytes(8));
  const now = Math.floor(Date.now() / 1000);

  db.run(
    `INSERT INTO tokens (id, hash, alias, domain, type, name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hashToken(token),
      alias,
      domain,
      type,
      name,
      expiresAt ?? (type === "session" ? now + SESSION_LIFETIME : null),
    ],
  );

  return { token, id };
}

export function findTokenByHash(hash) {
  const db = getDb();
  return db.query(`SELECT * FROM tokens WHERE hash = ?`).get(hash);
}

export function deleteToken(id) {
  const db = getDb();
  const result = db
    .query(`DELETE FROM tokens WHERE id = ? RETURNING id`)
    .get(id);
  return !!result;
}

export function deleteExpiredTokens() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.run(`DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?`, [
    now,
  ]);
}

export function updateLastUsed(id) {
  const db = getDb();
  db.run(`UPDATE tokens SET last_used = ? WHERE id = ?`, [
    Math.floor(Date.now() / 1000),
    id,
  ]);
}

export function getTokensByAlias(alias, domain, type = null) {
  const db = getDb();
  if (type) {
    return db
      .query(
        `SELECT id, type, name, expires_at, created_at, last_used
         FROM tokens WHERE alias = ? AND domain = ? AND type = ?
         ORDER BY created_at DESC`,
      )
      .all(alias, domain, type);
  }
  return db
    .query(
      `SELECT id, type, name, expires_at, created_at, last_used
       FROM tokens WHERE alias = ? AND domain = ?
       ORDER BY created_at DESC`,
    )
    .all(alias, domain);
}

export function deleteTokensByAlias(alias, domain, type = null) {
  const db = getDb();
  if (type) {
    db.run(`DELETE FROM tokens WHERE alias = ? AND domain = ? AND type = ?`, [
      alias,
      domain,
      type,
    ]);
  } else {
    db.run(`DELETE FROM tokens WHERE alias = ? AND domain = ?`, [
      alias,
      domain,
    ]);
  }
}

export { SESSION_LIFETIME };
