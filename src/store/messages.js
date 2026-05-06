import { getDb } from "./db.js";

function mapMessageRow(row) {
  return {
    ...row,
    expires: row.expires_at,
  };
}

export function storeMessage(
  envelope,
  direction,
  verified = 0,
  deliveredTo = envelope.recipient,
) {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO messages (
      id,
      conversation_id,
      in_reply_to,
      direction,
      type,
      sender,
      on_behalf_of,
      recipient,
      delivered_to,
      subject,
      body,
      content_type,
      expires_at,
      signature,
      key_id,
      verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      envelope.id,
      envelope.conversation_id,
      envelope.in_reply_to ?? null,
      direction,
      envelope.type ?? "message",
      envelope.sender,
      envelope.on_behalf_of ?? null,
      envelope.recipient,
      deliveredTo,
      envelope.subject ?? null,
      envelope.body ?? null,
      envelope.content_type ?? "text",
      envelope.expires ?? null,
      envelope.signature,
      envelope.key_id,
      verified,
    ],
  );
}

export function getMessages(direction, address) {
  const db = getDb();
  if (direction === "in") {
    return db
      .query(
        `SELECT * FROM messages WHERE direction = 'in' AND delivered_to = ? ORDER BY created_at DESC`,
      )
      .all(address)
      .map(mapMessageRow);
  }
  return db
    .query(
      `SELECT * FROM messages WHERE direction = 'out' AND sender = ? ORDER BY created_at DESC`,
    )
    .all(address)
    .map(mapMessageRow);
}

export function messageExists(id, direction = "in") {
  const db = getDb();
  const row = db
    .query(`SELECT id FROM messages WHERE id = ? AND direction = ?`)
    .get(id, direction);
  return !!row;
}
