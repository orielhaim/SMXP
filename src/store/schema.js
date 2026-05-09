import { getDb } from "./db.js";

export function initSchema() {
  const db = getDb();

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

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_routes_domain_enabled_priority
    ON routes(domain, enabled, priority)
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
      FOREIGN KEY (domain, alias) REFERENCES addresses (domain, alias) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(hash)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS delegations ( 
      id TEXT PRIMARY KEY, 
      domain TEXT NOT NULL, 
      alias TEXT NOT NULL, 
      delegate TEXT NOT NULL, 
      scope TEXT NOT NULL DEFAULT 'send' CHECK (scope IN ('send', 'read', 'manage')), 
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), 
      expires_at INTEGER, 
      FOREIGN KEY (domain, alias) REFERENCES addresses (domain, alias) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON delegations(delegate)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages ( 
      id TEXT NOT NULL, 
      conversation_id TEXT NOT NULL, 
      in_reply_to TEXT, 
      timestamp INTEGER,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')), 
      type TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message', 'edit', 'delete', 'receipt')), 
      sender TEXT NOT NULL, 
      recipient TEXT NOT NULL, 
      delivered_to TEXT NOT NULL, 
      subject TEXT, 
      body TEXT, 
      content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'markdown', 'html', 'forward')), 
      expires_at INTEGER, 
      server_signature TEXT NOT NULL, 
      server_key_id TEXT NOT NULL, 
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), 
      UNIQUE (id, direction, delivered_to)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_delivered_to ON messages(delivered_to)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS key_cache ( 
      domain TEXT NOT NULL, 
      key_id TEXT NOT NULL, 
      algorithm TEXT NOT NULL, 
      public_key TEXT NOT NULL, 
      source TEXT NOT NULL DEFAULT 'wellknown' CHECK (source IN ('wellknown', 'header', 'manual')), 
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch()), 
      ttl INTEGER NOT NULL DEFAULT 3600, 
      PRIMARY KEY (domain)
    )
  `);

  return db;
}
