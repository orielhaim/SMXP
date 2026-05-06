import { getDb } from "./db.js";

export function initSchema() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS server_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      domain      TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aliases (
      domain      TEXT NOT NULL,
      alias       TEXT NOT NULL,
      mode        TEXT NOT NULL CHECK(mode IN ('inbox','forward')),
      forward_to  TEXT,
      password_hash TEXT,
      public_key  TEXT,
      secret_key  TEXT,
      key_id      TEXT UNIQUE,
      algorithm   TEXT NOT NULL DEFAULT 'ML-DSA-65',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (domain, alias),
      FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE,
      CHECK (
        (mode = 'inbox' AND public_key IS NOT NULL AND secret_key IS NOT NULL AND key_id IS NOT NULL AND forward_to IS NULL)
        OR
        (mode = 'forward' AND forward_to IS NOT NULL AND public_key IS NULL AND secret_key IS NULL AND key_id IS NULL)
      ),
      CHECK (alias != '*' OR mode = 'forward')
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id          TEXT PRIMARY KEY,
      hash        TEXT NOT NULL UNIQUE,
      alias       TEXT NOT NULL,
      domain      TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('session', 'apikey')),
      name        TEXT,
      permissions TEXT NOT NULL DEFAULT 'full',
      expires_at  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used   INTEGER,
      FOREIGN KEY (alias, domain) REFERENCES aliases(alias, domain)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(hash)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_alias_domain ON tokens(alias, domain)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT NOT NULL,
      direction   TEXT NOT NULL CHECK(direction IN ('in','out')),
      type        TEXT NOT NULL DEFAULT 'message' CHECK(type IN ('message','edit','receipt')),
      name        TEXT,
      "from"      TEXT NOT NULL,
      "to"        TEXT NOT NULL,
      delivered_to TEXT NOT NULL,
      subject     TEXT,
      body        TEXT NOT NULL,
      expires_at  INTEGER,
      references_json TEXT,
      signature   TEXT NOT NULL,
      key_id      TEXT NOT NULL,
      verified    INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(id, direction, delivered_to)
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

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_delivered_to ON messages(delivered_to)
  `);

  return db;
}
