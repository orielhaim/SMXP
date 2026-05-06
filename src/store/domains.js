import { getDb } from "./db.js";

export function createDomain(domain) {
  const db = getDb();
  db.run(`INSERT OR IGNORE INTO domains (domain) VALUES (?)`, [
    domain.trim().toLowerCase(),
  ]);
}

export function domainExists(domain) {
  const db = getDb();
  const row = db
    .query(`SELECT domain FROM domains WHERE domain = ?`)
    .get(domain.trim().toLowerCase());
  return !!row;
}

export function getAllDomains() {
  const db = getDb();
  return db
    .query(`SELECT domain, created_at FROM domains ORDER BY domain`)
    .all();
}

export function deleteDomain(domain) {
  const db = getDb();
  const result = db
    .query(`DELETE FROM domains WHERE domain = ? RETURNING domain`)
    .get(domain.trim().toLowerCase());
  return !!result;
}
