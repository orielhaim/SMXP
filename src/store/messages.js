import { getDb } from "./db.js";

function serializeReferences(references) {
  if (references == null) {
    return null;
  }

  return JSON.stringify(references);
}

function parseReferences(referencesJson) {
  if (!referencesJson) {
    return null;
  }

  try {
    return JSON.parse(referencesJson);
  } catch {
    return referencesJson;
  }
}

function mapMessageRow(row) {
  return {
    ...row,
    expires: row.expires_at,
    references: parseReferences(row.references_json),
  };
}

export function storeMessage(
  envelope,
  direction,
  verified = 0,
  deliveredTo = envelope.to,
) {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO messages (
      id,
      direction,
      type,
      name,
      "from",
      "to",
      delivered_to,
      subject,
      body,
      expires_at,
      references_json,
      signature,
      key_id,
      verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      envelope.id,
      direction,
      envelope.type ?? "message",
      envelope.name ?? null,
      envelope.from,
      envelope.to,
      deliveredTo,
      envelope.subject,
      envelope.body,
      envelope.expires ?? null,
      serializeReferences(envelope.references),
      envelope.signature,
      envelope.key_id,
      verified,
    ],
  );
}

export function getMessages(direction, alias) {
  const db = getDb();
  if (direction === "in") {
    return db
      .query(
        `SELECT * FROM messages WHERE direction = 'in' AND delivered_to = ? ORDER BY created_at DESC`,
      )
      .all(alias)
      .map(mapMessageRow);
  }
  return db
    .query(
      `SELECT * FROM messages WHERE direction = 'out' AND "from" = ? ORDER BY created_at DESC`,
    )
    .all(alias)
    .map(mapMessageRow);
}

export function messageExists(id, direction = "in") {
  const db = getDb();
  const row = db
    .query(`SELECT id FROM messages WHERE id = ? AND direction = ?`)
    .get(id, direction);
  return !!row;
}
