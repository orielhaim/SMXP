import { getDb } from "./db.js";

export function initSchema(dbPath) {
  const db = getDb(dbPath);

  db.run(`
    CREATE TABLE IF NOT EXISTS server_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aliases (
      alias       TEXT PRIMARY KEY,
      public_key  TEXT NOT NULL,
      secret_key  TEXT NOT NULL,
      key_id      TEXT NOT NULL UNIQUE,
      algorithm   TEXT NOT NULL DEFAULT 'ML-DSA-65',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      direction   TEXT NOT NULL CHECK(direction IN ('in','out')),
      type        TEXT NOT NULL DEFAULT 'message' CHECK(type IN ('message','edit','receipt')),
      name        TEXT,
      "from"      TEXT NOT NULL,
      "to"        TEXT NOT NULL,
      subject     TEXT,
      body        TEXT NOT NULL,
      expires_at  INTEGER,
      references_json TEXT,
      signature   TEXT NOT NULL,
      key_id      TEXT NOT NULL,
      verified    INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS known_keys (
      domain      TEXT NOT NULL,
      key_id      TEXT NOT NULL,
      public_key  TEXT NOT NULL,
      algorithm   TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'server',
      fetched_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      ttl         INTEGER NOT NULL DEFAULT 3600,
      PRIMARY KEY (domain, key_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages("to")
  `);

  return db;
}
