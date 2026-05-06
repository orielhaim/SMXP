import { getDb } from "./db.js";

export function createDomain(dbPath, domain) {
  const db = getDb(dbPath);
  db.run(`INSERT OR IGNORE INTO domains (domain) VALUES (?)`, [
    domain.trim().toLowerCase(),
  ]);
}

export function domainExists(dbPath, domain) {
  const db = getDb(dbPath);
  const row = db
    .query(`SELECT domain FROM domains WHERE domain = ?`)
    .get(domain.trim().toLowerCase());
  return !!row;
}

export function getAllDomains(dbPath) {
  const db = getDb(dbPath);
  return db
    .query(`SELECT domain, created_at FROM domains ORDER BY domain`)
    .all();
}
