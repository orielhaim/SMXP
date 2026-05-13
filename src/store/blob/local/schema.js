export function applyBlobsSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      size INTEGER NOT NULL,
      received INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      computed_sha256 TEXT,
      content_type TEXT,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'deleted')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      finalized_at INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_blob_owner ON blobs(owner)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS blob_tokens (
      id TEXT PRIMARY KEY,
      blob_id TEXT NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
      hash TEXT NOT NULL UNIQUE,
      recipient TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER,
      last_used INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_blob ON blob_tokens(blob_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_hash ON blob_tokens(hash)`);
}
