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
    references: parseReferences(row.references_json),
  };
}

export function storeMessage(dbPath, envelope, direction, verified = 0) {
  const db = getDb(dbPath);
  db.run(
    `INSERT OR IGNORE INTO messages (
      id,
      direction,
      type,
      name,
      "from",
      "to",
      subject,
      body,
      references_json,
      signature,
      key_id,
      verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      envelope.id,
      direction,
      envelope.type ?? "message",
      envelope.name ?? null,
      envelope.from,
      envelope.to,
      envelope.subject,
      envelope.body,
      serializeReferences(envelope.references),
      envelope.signature,
      envelope.key_id,
      verified,
    ],
  );
}

export function getMessages(dbPath, direction, alias) {
  const db = getDb(dbPath);
  if (direction === "in") {
    return db
      .query(
        `SELECT * FROM messages WHERE direction = 'in' AND "to" = ? ORDER BY created_at DESC`,
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

export function messageExists(dbPath, id) {
  const db = getDb(dbPath);
  const row = db.query(`SELECT id FROM messages WHERE id = ?`).get(id);
  return !!row;
}
