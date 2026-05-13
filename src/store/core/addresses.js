import { parseAddress } from "../../shared/address.js";

export function addressesApi(db, domains) {
  return {
    createInbox(domain, alias, passwordHash) {
      const d = norm(domain);
      const a = norm(alias);
      if (a.includes("*"))
        throw new Error("wildcards belong in routes, not addresses");
      if (!passwordHash) throw new Error("password hash required");

      domains.create(d);
      db.run(
        `INSERT OR REPLACE INTO addresses (domain, alias, password_hash) VALUES (?, ?, ?)`,
        [d, a, passwordHash],
      );
    },

    get(domain, alias) {
      const row = db
        .query(
          `SELECT domain, alias, password_hash, created_at FROM addresses WHERE domain = ? AND alias = ?`,
        )
        .get(norm(domain), norm(alias));
      return row ? { ...row, mode: "inbox" } : null;
    },

    getByAddress(address) {
      const { domain, localPart } = parseAddress(address);
      return this.get(domain, localPart);
    },

    all() {
      return db
        .query(
          `SELECT domain, alias, created_at FROM addresses ORDER BY domain, alias`,
        )
        .all()
        .map((r) => ({ ...r, mode: "inbox" }));
    },

    byDomain(domain) {
      return db
        .query(
          `SELECT domain, alias, created_at FROM addresses WHERE domain = ? ORDER BY alias`,
        )
        .all(norm(domain))
        .map((r) => ({ ...r, mode: "inbox" }));
    },

    updatePassword(domain, alias, passwordHash) {
      db.run(
        `UPDATE addresses SET password_hash = ? WHERE domain = ? AND alias = ?`,
        [passwordHash, norm(domain), norm(alias)],
      );
    },

    delete(domain, alias) {
      const r = db
        .query(
          `DELETE FROM addresses WHERE domain = ? AND alias = ? RETURNING alias`,
        )
        .get(norm(domain), norm(alias));
      return !!r;
    },
  };
}

function norm(v) {
  return String(v).trim().toLowerCase();
}
