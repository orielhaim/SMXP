import { randomBytes } from "node:crypto";
import { parseAddress } from "../../shared/address.js";
import { toBase64Url } from "../../shared/encoding.js";

export function routesApi(db) {
  return {
    create({ domain, pattern, targetAddress, priority = 0, enabled = 1 }) {
      const id = `route_${toBase64Url(randomBytes(8))}`;
      db.run(
        `INSERT INTO routes (id, domain, pattern, target_address, enabled, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          norm(domain),
          normalizePattern(pattern),
          parseAddress(targetAddress).address,
          enabled ? 1 : 0,
          priority,
        ],
      );
      return this.get(id);
    },

    get(id) {
      return db.query(`SELECT * FROM routes WHERE id = ?`).get(id);
    },

    byDomain(domain) {
      return db
        .query(
          `SELECT * FROM routes WHERE domain = ? ORDER BY priority DESC, created_at ASC`,
        )
        .all(norm(domain));
    },

    update(id, updates) {
      const current = this.get(id);
      if (!current) return null;

      const next = {
        pattern:
          updates.pattern === undefined
            ? current.pattern
            : normalizePattern(updates.pattern),
        target_address:
          updates.targetAddress === undefined
            ? current.target_address
            : parseAddress(updates.targetAddress).address,
        enabled:
          updates.enabled === undefined
            ? current.enabled
            : updates.enabled
              ? 1
              : 0,
        priority:
          updates.priority === undefined ? current.priority : updates.priority,
      };

      db.run(
        `UPDATE routes SET pattern = ?, target_address = ?, enabled = ?, priority = ? WHERE id = ?`,
        [next.pattern, next.target_address, next.enabled, next.priority, id],
      );
      return this.get(id);
    },

    delete(id) {
      const r = db
        .query(`DELETE FROM routes WHERE id = ? RETURNING id`)
        .get(id);
      return !!r;
    },

    match(domain, alias) {
      const rows = this.byDomain(domain).filter((r) => r.enabled);
      const target = norm(alias);
      return rows.filter((r) => patternToRegExp(r.pattern).test(target));
    },
  };
}

function norm(v) {
  return String(v).trim().toLowerCase();
}

function normalizePattern(pattern) {
  const v = norm(pattern);
  if (!v || v.includes("@") || v.includes("/")) {
    throw new Error(`invalid route pattern "${pattern}"`);
  }
  return v;
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}
