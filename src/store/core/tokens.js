import { createHash, randomBytes } from "node:crypto";
import { toBase64Url } from "../../shared/encoding.js";

export const SESSION_LIFETIME = 7 * 24 * 3600;

export function tokensApi(db) {
  return {
    hash(token) {
      return createHash("sha256").update(token).digest("hex");
    },

    create({ alias, domain, type, name = null, expiresAt = null }) {
      const token = generateToken(type);
      const id =
        type === "apikey"
          ? `ak_${toBase64Url(randomBytes(6))}`
          : toBase64Url(randomBytes(8));
      const now = Math.floor(Date.now() / 1000);
      const exp =
        expiresAt ?? (type === "session" ? now + SESSION_LIFETIME : null);

      db.run(
        `INSERT INTO tokens (id, hash, alias, domain, type, name, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, this.hash(token), alias, domain, type, name, exp],
      );

      return { token, id, expiresAt: exp };
    },

    findByHash(hash) {
      return db.query(`SELECT * FROM tokens WHERE hash = ?`).get(hash);
    },

    touch(id) {
      db.run(`UPDATE tokens SET last_used = ? WHERE id = ?`, [
        Math.floor(Date.now() / 1000),
        id,
      ]);
    },

    delete(id) {
      const r = db
        .query(`DELETE FROM tokens WHERE id = ? RETURNING id`)
        .get(id);
      return !!r;
    },

    byAlias(alias, domain, type = null) {
      const sql = type
        ? `SELECT id, type, name, expires_at, created_at, last_used FROM tokens
           WHERE alias = ? AND domain = ? AND type = ? ORDER BY created_at DESC`
        : `SELECT id, type, name, expires_at, created_at, last_used FROM tokens
           WHERE alias = ? AND domain = ? ORDER BY created_at DESC`;
      const q = db.query(sql);
      return type ? q.all(alias, domain, type) : q.all(alias, domain);
    },

    deleteByAlias(alias, domain, type = null) {
      if (type) {
        db.run(
          `DELETE FROM tokens WHERE alias = ? AND domain = ? AND type = ?`,
          [alias, domain, type],
        );
      } else {
        db.run(`DELETE FROM tokens WHERE alias = ? AND domain = ?`, [
          alias,
          domain,
        ]);
      }
    },

    deleteExpired() {
      db.run(
        `DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [Math.floor(Date.now() / 1000)],
      );
    },
  };
}

function generateToken(type) {
  const prefix = type === "session" ? "smxp_ses_" : "smxp_key_";
  return prefix + toBase64Url(randomBytes(32));
}
