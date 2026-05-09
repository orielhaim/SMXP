import { randomBytes } from "node:crypto";
import { parseAddress } from "../shared/address.js";
import { toBase64Url } from "../shared/encoding.js";
import { getDb } from "./db.js";

function routeId() {
  return `route_${toBase64Url(randomBytes(8))}`;
}

function normalizePattern(pattern) {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized || normalized.includes("@") || normalized.includes("/")) {
    throw new Error(`invalid route pattern "${pattern}"`);
  }
  return normalized;
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

export function createRoute({
  domain,
  pattern,
  targetAddress,
  priority = 0,
  enabled = 1,
}) {
  const db = getDb();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedPattern = normalizePattern(pattern);
  const target = parseAddress(targetAddress).address;
  const id = routeId();

  db.run(
    `INSERT INTO routes (
      id,
      domain,
      pattern,
      target_address,
      enabled,
      priority
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      normalizedDomain,
      normalizedPattern,
      target,
      enabled ? 1 : 0,
      priority,
    ],
  );

  return getRoute(id);
}

export function getRoute(id) {
  const db = getDb();
  return db.query(`SELECT * FROM routes WHERE id = ?`).get(id);
}

export function getRoutes(domain) {
  const db = getDb();
  return db
    .query(
      `SELECT *
       FROM routes
       WHERE domain = ?
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(domain.trim().toLowerCase());
}

export function updateRoute(id, updates) {
  const current = getRoute(id);
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
      updates.enabled === undefined ? current.enabled : updates.enabled ? 1 : 0,
    priority:
      updates.priority === undefined ? current.priority : updates.priority,
  };

  const db = getDb();
  db.run(
    `UPDATE routes
     SET pattern = ?,
         target_address = ?,
         enabled = ?,
         priority = ?
     WHERE id = ?`,
    [next.pattern, next.target_address, next.enabled, next.priority, id],
  );

  return getRoute(id);
}

export function deleteRoute(id) {
  const db = getDb();
  const result = db
    .query(`DELETE FROM routes WHERE id = ? RETURNING id`)
    .get(id);
  return !!result;
}

export function matchRoutes(domain, alias) {
  const routes = getRoutes(domain).filter((route) => route.enabled);
  const normalizedAlias = alias.trim().toLowerCase();
  return routes.filter((route) =>
    patternToRegExp(route.pattern).test(normalizedAlias),
  );
}
