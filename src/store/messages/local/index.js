import { openMessagesDb } from "./db.js";
import { queryById, queryThread, querySince, queryList } from "./queries.js";

export function createLocalMessagesStore({ path }) {
  const db = openMessagesDb(path);

  function insertMessage(envelope, direction, deliveredTo) {
    db.run(
      `INSERT OR IGNORE INTO messages (
        id, conversation_id, in_reply_to, timestamp, direction, type,
        sender, recipient, delivered_to, subject, body, content_type,
        expires_at, server_signature, server_key_id
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
  }

  function insertAttachments(envelope, direction, deliveredTo) {
    const list = Array.isArray(envelope.attachments)
      ? envelope.attachments
      : [];
    if (list.length === 0) return;

    const stmt = db.query(
      `INSERT OR IGNORE INTO message_attachments (
        message_id, direction, delivered_to, idx,
        blob_id, host, port, download_token, name, size,
        content_type, sha256, disposition, encryption_json, thumbnail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      stmt.run(
        envelope.id,
        direction,
        deliveredTo,
        i,
        a.blob_id,
        a.host,
        a.port ?? null,
        a.download_token ?? null,
        a.name ?? null,
        a.size,
        a.content_type ?? null,
        a.sha256,
        a.disposition ?? "attachment",
        a.encryption ? JSON.stringify(a.encryption) : null,
        a.thumbnail ? JSON.stringify(a.thumbnail) : null,
      );
    }
  }

  return {
    async store(envelope, direction, deliveredTo = envelope.recipient) {
      const tx = db.transaction(() => {
        insertMessage(envelope, direction, deliveredTo);
        insertAttachments(envelope, direction, deliveredTo);
      });
      tx();
    },

    async exists(id, direction = "in") {
      return !!db
        .query(`SELECT 1 FROM messages WHERE id = ? AND direction = ?`)
        .get(id, direction);
    },

    async query(address, params = {}) {
      if (params.id) return queryById(db, address, params);
      if (params.thread) return queryThread(db, address, params);
      if (params.since_id) return querySince(db, address, params);
      return queryList(db, address, params);
    },

    markConversationRead(address, conversationId, readStatus) {
      const normalizedStatus = readStatus === 2 ? 2 : 1;
      const rows = db
        .query(
          `UPDATE messages
           SET read_status = ?
           WHERE delivered_to = ?
             AND conversation_id = ?
             AND direction = 'in'
             AND read_status < ?
           RETURNING id`,
        )
        .all(
          normalizedStatus,
          address,
          conversationId,
          normalizedStatus === 2 ? 2 : 1,
        );
      return rows.length;
    },

    applyReceipt(address, readerAddress, conversationId, upToTimestamp) {
      const rows = db
        .query(
          `UPDATE messages
           SET read_status = 1
           WHERE conversation_id = ?
             AND direction = 'out'
             AND sender = ?
             AND recipient = ?
             AND timestamp <= ?
             AND read_status = 0
           RETURNING id`,
        )
        .all(conversationId, address, readerAddress, upToTimestamp);
      return rows.length;
    },

    getConversationMeta(address, conversationId) {
      return db
        .query(
          `SELECT conversation_id, timestamp, sender, recipient, delivered_to, direction, read_status
           FROM messages
           WHERE conversation_id = ?
             AND (delivered_to = ? OR sender = ?)
           ORDER BY timestamp DESC, created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(conversationId, address, address);
    },

    unreadCount(address, grouped = false) {
      if (grouped) {
        return db
          .query(
            `SELECT conversation_id, COUNT(*) AS count
             FROM messages
             WHERE delivered_to = ?
               AND direction = 'in'
               AND read_status = 0
             GROUP BY conversation_id
             ORDER BY MAX(created_at) DESC`,
          )
          .all(address);
      }

      const row = db
        .query(
          `SELECT COUNT(*) AS count
           FROM messages
           WHERE delivered_to = ?
             AND direction = 'in'
             AND read_status = 0`,
        )
        .get(address);
      return row?.count ?? 0;
    },

    close() {
      db.close();
    },
  };
}
