export function applyMessagesSchema(db) {
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
      content_type TEXT NOT NULL DEFAULT 'text'
        CHECK (content_type IN ('text', 'markdown', 'html', 'forward')),
      expires_at INTEGER,
      server_signature TEXT NOT NULL,
      server_key_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (id, direction, delivered_to)
    )
  `);

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id)`,
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_reply ON messages(in_reply_to)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(delivered_to)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      delivered_to TEXT NOT NULL,
      idx INTEGER NOT NULL,
      blob_id TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER,
      download_token TEXT,
      name TEXT,
      size INTEGER NOT NULL,
      content_type TEXT,
      sha256 TEXT NOT NULL,
      disposition TEXT NOT NULL DEFAULT 'attachment'
        CHECK (disposition IN ('attachment', 'inline', 'embedded')),
      encryption_json TEXT,
      thumbnail_json TEXT,
      PRIMARY KEY (message_id, direction, delivered_to, idx)
    )
  `);

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_att_msg ON message_attachments(message_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_att_blob ON message_attachments(blob_id)`,
  );
}
