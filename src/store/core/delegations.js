import { randomBytes } from "node:crypto";
import { toBase64Url } from "../../shared/encoding.js";

export function delegationsApi(db) {
  return {
    create({ domain, alias, delegate, scope = "send", expiresAt = null }) {
      const id = `dlg_${toBase64Url(randomBytes(8))}`;
      db.run(
        `INSERT INTO delegations (id, domain, alias, delegate, scope, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, domain, alias, delegate, scope, expiresAt],
      );
      return { id, domain, alias, delegate, scope, expires_at: expiresAt };
    },

    byOwner(domain, alias) {
      return db
        .query(
          `SELECT id, domain, alias, delegate, scope, created_at, expires_at
           FROM delegations WHERE domain = ? AND alias = ? ORDER BY created_at DESC`,
        )
        .all(domain, alias);
    },

    forDelegate(domain, alias, delegate) {
      return db
        .query(
          `SELECT id, domain, alias, delegate, scope, created_at, expires_at
           FROM delegations WHERE domain = ? AND alias = ? AND delegate = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(domain, alias, delegate);
    },

    grantedTo(delegate) {
      return db
        .query(
          `SELECT id, domain, alias, delegate, scope, created_at, expires_at
           FROM delegations WHERE delegate = ? ORDER BY created_at DESC`,
        )
        .all(delegate);
    },

    delete(domain, alias, id) {
      const r = db
        .query(
          `DELETE FROM delegations WHERE domain = ? AND alias = ? AND id = ? RETURNING id`,
        )
        .get(domain, alias, id);
      return !!r;
    },

    deleteExpired() {
      db.run(
        `DELETE FROM delegations WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [Math.floor(Date.now() / 1000)],
      );
    },
  };
}
