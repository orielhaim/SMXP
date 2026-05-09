import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import config from "../config.js";
import {
  buildPaginatedResponse,
  clampLimit,
  decodeCursor,
} from "../shared/cursor.js";

let db = null;

function getMessagesDb() {
  if (db) return db;

  const dbPath = config.messagesDbPath;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  initMessagesSchema(db);

  return db;
}

function initMessagesSchema(messagesDb) {
  messagesDb.run(`
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

  messagesDb.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)
  `);

  messagesDb.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to)
  `);

  messagesDb.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_delivered_to ON messages(delivered_to)
  `);

  messagesDb.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient)
  `);
}

function mapMessageRow(row) {
  return {
    ...row,
    expires: row.expires_at,
  };
}

function addressClause(direction) {
  const safeDirection =
    direction === "in" || direction === "out" ? direction : null;
  if (safeDirection === "in") return { sql: "delivered_to = ?", params: 1 };
  if (safeDirection === "out") return { sql: "sender = ?", params: 1 };
  return { sql: "(delivered_to = ? OR sender = ?)", params: 2 };
}

function normalizeDirection(direction) {
  return direction === "in" || direction === "out" ? direction : null;
}

function buildAddressWhere(address, direction) {
  const clause = addressClause(direction);
  return {
    sql: clause.sql,
    params: Array(clause.params).fill(address),
  };
}

function emptyResponse() {
  return {
    messages: [],
    cursors: { next: null, prev: null, has_more: false },
  };
}

function responseWith(messages, limit) {
  return {
    messages,
    ...buildPaginatedResponse(messages, limit),
  };
}

function getConversationId(messagesDb, address, params) {
  const direction = normalizeDirection(params.direction);
  const addressWhere = buildAddressWhere(address, direction);
  const directionSql = direction ? " AND direction = ?" : "";
  const directionParams = direction ? [direction] : [];

  return messagesDb
    .query(
      `SELECT conversation_id FROM messages
       WHERE id = ? AND ${addressWhere.sql}${directionSql}
       LIMIT 1`,
    )
    .get(params.thread, ...addressWhere.params, ...directionParams)
    ?.conversation_id;
}

function queryById(messagesDb, address, params) {
  const direction = normalizeDirection(params.direction);
  const addressWhere = buildAddressWhere(address, direction);
  const directionSql = direction ? " AND direction = ?" : "";
  const directionParams = direction ? [direction] : [];
  const row = messagesDb
    .query(
      `SELECT * FROM messages
       WHERE id = ? AND ${addressWhere.sql}${directionSql}
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(params.id, ...addressWhere.params, ...directionParams);

  return {
    messages: row ? [mapMessageRow(row)] : [],
    cursors: { next: null, prev: null, has_more: false },
  };
}

function queryThread(messagesDb, address, params) {
  const conversationId = getConversationId(messagesDb, address, params);
  if (!conversationId) return emptyResponse();

  const direction = normalizeDirection(params.direction);
  const addressWhere = buildAddressWhere(address, direction);
  const directionSql = direction ? " AND direction = ?" : "";
  const directionParams = direction ? [direction] : [];
  const safeLimit = clampLimit(params.limit);
  const rows = messagesDb
    .query(
      `SELECT * FROM messages
       WHERE ${addressWhere.sql} AND conversation_id = ?${directionSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(...addressWhere.params, conversationId, ...directionParams, safeLimit)
    .map(mapMessageRow);

  return responseWith(rows, safeLimit);
}

function querySince(messagesDb, address, params) {
  const direction = normalizeDirection(params.direction);
  const addressWhere = buildAddressWhere(address, direction);
  const directionSql = direction ? " AND direction = ?" : "";
  const directionParams = direction ? [direction] : [];
  const anchor = messagesDb
    .query(
      `SELECT created_at, id FROM messages
       WHERE id = ? AND ${addressWhere.sql}${directionSql}
       LIMIT 1`,
    )
    .get(params.since_id, ...addressWhere.params, ...directionParams);

  if (!anchor) return emptyResponse();

  const safeLimit = clampLimit(params.limit);
  const rows = messagesDb
    .query(
      `SELECT * FROM messages
       WHERE ${addressWhere.sql}${directionSql}
         AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(
      ...addressWhere.params,
      ...directionParams,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
      safeLimit,
    )
    .map(mapMessageRow);

  return responseWith(rows, safeLimit);
}

function queryList(messagesDb, address, params) {
  const direction = normalizeDirection(params.direction);
  const addressWhere = buildAddressWhere(address, direction);
  const directionSql = direction ? " AND direction = ?" : "";
  const directionParams = direction ? [direction] : [];
  const safeLimit = clampLimit(params.limit);

  let sql;
  let sqlParams;

  if (params.after) {
    const cursor = decodeCursor(params.after);
    sql = `SELECT * FROM messages
           WHERE ${addressWhere.sql}${directionSql}
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    sqlParams = [
      ...addressWhere.params,
      ...directionParams,
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      safeLimit,
    ];
  } else if (params.before) {
    const cursor = decodeCursor(params.before);
    sql = `SELECT * FROM messages
           WHERE ${addressWhere.sql}${directionSql}
             AND (created_at > ? OR (created_at = ? AND id > ?))
           ORDER BY created_at ASC, id ASC LIMIT ?`;
    sqlParams = [
      ...addressWhere.params,
      ...directionParams,
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      safeLimit,
    ];
  } else {
    sql = `SELECT * FROM messages
           WHERE ${addressWhere.sql}${directionSql}
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    sqlParams = [...addressWhere.params, ...directionParams, safeLimit];
  }

  const rows = messagesDb
    .query(sql)
    .all(...sqlParams)
    .map(mapMessageRow);
  if (params.before) rows.reverse();

  return responseWith(rows, safeLimit);
}

export function createBuiltinMessageStore() {
  return {
    store(envelope, direction, deliveredTo = envelope.recipient) {
      const messagesDb = getMessagesDb();
      messagesDb.run(
        `INSERT OR IGNORE INTO messages (
          id,
          conversation_id,
          in_reply_to,
          timestamp,
          direction,
          type,
          sender,
          recipient,
          delivered_to,
          subject,
          body,
          content_type,
          expires_at,
          server_signature,
          server_key_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          envelope.id,
          envelope.conversation_id,
          envelope.in_reply_to ?? null,
          envelope.timestamp ?? null,
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
        ],
      );
    },

    exists(id, direction = "in") {
      const row = getMessagesDb()
        .query(`SELECT id FROM messages WHERE id = ? AND direction = ?`)
        .get(id, direction);
      return !!row;
    },

    query(address, params = {}) {
      const messagesDb = getMessagesDb();
      if (params.id) return queryById(messagesDb, address, params);
      if (params.thread) return queryThread(messagesDb, address, params);
      if (params.since_id) return querySince(messagesDb, address, params);
      return queryList(messagesDb, address, params);
    },
  };
}

export function closeMessagesDb() {
  if (db) {
    db.close();
    db = null;
  }
}
