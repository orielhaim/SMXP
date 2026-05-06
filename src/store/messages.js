import { getDb } from "./db.js";

export function storeMessage(dbPath, envelope, direction, verified = 0) {
  const db = getDb(dbPath);
  db.run(
    `INSERT OR IGNORE INTO messages (id, direction, "from", "to", subject, body, signature, key_id, verified) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      envelope.id,
      direction,
      envelope.from,
      envelope.to,
      envelope.subject,
      envelope.body,
      envelope.signature,
      envelope.key_id,
      verified,
    ],
  );
}

export function getMessages(dbPath, direction, alias) {
  const db = getDb(dbPath);
  if (direction === "in") {
    return db.query(`SELECT * FROM messages WHERE direction = 'in' AND "to" = ? ORDER BY created_at DESC`).all(alias);
  }
  return db.query(`SELECT * FROM messages WHERE direction = 'out' AND "from" = ? ORDER BY created_at DESC`).all(alias);
}

export function messageExists(dbPath, id) {
  const db = getDb(dbPath);
  const row = db.query(`SELECT id FROM messages WHERE id = ?`).get(id);
  return !!row;
}
