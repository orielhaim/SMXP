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
  const columns = new Set(
    db
      .query(`PRAGMA table_info(messages)`)
      .all()
      .map((column) => column.name),
  );
  const legacyColumns = columns.has("signature") && columns.has("key_id");
  const insertColumns = [
    "id",
    "conversation_id",
    "in_reply_to",
    "direction",
    "type",
    "sender",
    "recipient",
    "delivered_to",
    "subject",
    "body",
    "content_type",
    "expires_at",
    "server_signature",
    "server_key_id",
  ];
  const values = [
    envelope.id,
    envelope.conversation_id,
    envelope.in_reply_to ?? null,
    direction,
    envelope.type ?? "message",
    envelope.sender,
    envelope.recipient,
    deliveredTo,
    envelope.subject ?? null,
    envelope.body ?? null,
    envelope.content_type ?? "text",
    envelope.expires ?? null,
    envelope.server_signature,
    envelope.server_key_id,
  ];

  if (legacyColumns) {
    insertColumns.push("signature", "key_id");
    values.push(envelope.server_signature, envelope.server_key_id);
  }

  insertColumns.push("verified");
  values.push(verified);

  const placeholders = insertColumns.map(() => "?").join(", ");
  db.run(
    `INSERT OR IGNORE INTO messages (${insertColumns.join(", ")})
     VALUES (${placeholders})`,
    values,
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
