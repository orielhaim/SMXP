import { getDb } from "./db.js";

export function initSchema() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS server_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      domain TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS addresses ( 
      domain TEXT NOT NULL REFERENCES domains(domain) ON DELETE CASCADE, 
      alias TEXT NOT NULL, 
      mode TEXT NOT NULL CHECK (mode IN ('inbox', 'forward')), 
      forward_to TEXT, 
      password_hash TEXT, 
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), 
      PRIMARY KEY (domain, alias), 
      CHECK ( 
        (mode = 'inbox' AND forward_to IS NULL AND password_hash IS NOT NULL) 
        OR 
        (mode = 'forward' AND forward_to IS NOT NULL AND password_hash IS NULL) 
      ), 
      CHECK (alias != '*' OR mode = 'forward')
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS signing_keys ( 
      key_id TEXT PRIMARY KEY, 
      domain TEXT NOT NULL, 
      alias TEXT NOT NULL, 
      algorithm TEXT NOT NULL DEFAULT 'ML-DSA-65', 
      public_key TEXT NOT NULL, 
      secret_key TEXT NOT NULL, 
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), 
      FOREIGN KEY (domain, alias) REFERENCES addresses (domain, alias) ON DELETE CASCADE
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
      permissions TEXT NOT NULL DEFAULT 'full' CHECK (permissions IN ('full', 'readonly')), 
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
    CREATE TABLE IF NOT EXISTS messages ( 
      id TEXT NOT NULL, 
      conversation_id TEXT NOT NULL, 
      in_reply_to TEXT, 
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')), 
      type TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message', 'edit', 'delete', 'receipt')), 
      sender TEXT NOT NULL, 
      recipient TEXT NOT NULL, 
      delivered_to TEXT NOT NULL, 
      subject TEXT, 
      body TEXT, 
      content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'markdown', 'html')), 
      expires_at INTEGER, 
      signature TEXT NOT NULL, 
      key_id TEXT NOT NULL, 
      verified INTEGER NOT NULL DEFAULT 0, 
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
      PRIMARY KEY (domain, key_id)
    )
  `);

  return db;
}
