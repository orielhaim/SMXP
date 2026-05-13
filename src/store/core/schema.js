export function applySchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      domain TEXT PRIMARY KEY,
      public_key TEXT,
      secret_key TEXT,
      key_id TEXT,
      algorithm TEXT NOT NULL DEFAULT 'ML-DSA-65',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS addresses (
      domain TEXT NOT NULL REFERENCES domains(domain) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      password_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (domain, alias)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL,
      alias TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('session', 'apikey')),
      name TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used INTEGER,
      FOREIGN KEY (domain, alias) REFERENCES addresses(domain, alias) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(hash)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL REFERENCES domains(domain) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      target_address TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_routes_dom_en_pri ON routes(domain, enabled, priority)`,
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      alias TEXT NOT NULL,
      delegate TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'send' CHECK (scope IN ('send', 'read', 'manage')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER,
      FOREIGN KEY (domain, alias) REFERENCES addresses(domain, alias) ON DELETE CASCADE
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON delegations(delegate)`,
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS key_cache (
      domain TEXT PRIMARY KEY,
      key_id TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      public_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'wellknown' CHECK (source IN ('wellknown', 'header', 'manual')),
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
      ttl INTEGER NOT NULL DEFAULT 3600
    )
  `);
}
