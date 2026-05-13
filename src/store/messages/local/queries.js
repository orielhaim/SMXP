import {
  buildPaginatedResponse,
  clampLimit,
  decodeCursor,
} from "../../../shared/cursor.js";

function mapRow(row, attachments) {
  return {
    ...row,
    expires: row.expires_at,
    read_status: row.read_status,
    attachments: attachments || [],
  };
}

function mapAttachment(row) {
  return {
    blob_id: row.blob_id,
    host: row.host,
    port: row.port ?? undefined,
    download_token: row.download_token ?? undefined,
    name: row.name ?? undefined,
    size: row.size,
    content_type: row.content_type ?? undefined,
    sha256: row.sha256,
    disposition: row.disposition,
    encryption: row.encryption_json
      ? JSON.parse(row.encryption_json)
      : undefined,
    thumbnail: row.thumbnail_json ? JSON.parse(row.thumbnail_json) : undefined,
  };
}

function normalizeDirection(dir) {
  return dir === "in" || dir === "out" ? dir : null;
}

function addressWhere(address, direction) {
  const dir = normalizeDirection(direction);
  if (dir === "in") return { sql: "delivered_to = ?", params: [address] };
  if (dir === "out") return { sql: "sender = ?", params: [address] };
  return {
    sql: "(delivered_to = ? OR sender = ?)",
    params: [address, address],
  };
}

function directionClause(direction) {
  const dir = normalizeDirection(direction);
  return dir
    ? { sql: " AND direction = ?", params: [dir] }
    : { sql: "", params: [] };
}

function attachmentsFor(db, ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT * FROM message_attachments
       WHERE message_id IN (${placeholders})
       ORDER BY message_id, idx ASC`,
    )
    .all(...ids);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push(mapAttachment(r));
  }
  return map;
}

function hydrate(db, rows) {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.id))];
  const atts = attachmentsFor(db, ids);
  return rows.map((r) => mapRow(r, atts.get(r.id)));
}

function emptyResult() {
  return { messages: [], cursors: { next: null, prev: null, has_more: false } };
}

function withCursors(messages, limit) {
  return { messages, ...buildPaginatedResponse(messages, limit) };
}

export function queryById(db, address, params) {
  const where = addressWhere(address, params.direction);
  const dir = directionClause(params.direction);
  const row = db
    .query(
      `SELECT * FROM messages
       WHERE id = ? AND ${where.sql}${dir.sql}
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(params.id, ...where.params, ...dir.params);

  if (!row) return emptyResult();
  return {
    messages: hydrate(db, [row]),
    cursors: { next: null, prev: null, has_more: false },
  };
}

export function queryThread(db, address, params) {
  const where = addressWhere(address, params.direction);
  const dir = directionClause(params.direction);

  const convo = db
    .query(
      `SELECT conversation_id FROM messages
       WHERE id = ? AND ${where.sql}${dir.sql} LIMIT 1`,
    )
    .get(params.thread, ...where.params, ...dir.params)?.conversation_id;

  if (!convo) return emptyResult();

  const limit = clampLimit(params.limit);
  const rows = db
    .query(
      `SELECT * FROM messages
       WHERE ${where.sql} AND conversation_id = ?${dir.sql}
       ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(...where.params, convo, ...dir.params, limit);

  return withCursors(hydrate(db, rows), limit);
}

export function querySince(db, address, params) {
  const where = addressWhere(address, params.direction);
  const dir = directionClause(params.direction);

  const anchor = db
    .query(
      `SELECT created_at, id FROM messages
       WHERE id = ? AND ${where.sql}${dir.sql} LIMIT 1`,
    )
    .get(params.since_id, ...where.params, ...dir.params);

  if (!anchor) return emptyResult();

  const limit = clampLimit(params.limit);
  const rows = db
    .query(
      `SELECT * FROM messages
       WHERE ${where.sql}${dir.sql}
         AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(
      ...where.params,
      ...dir.params,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
      limit,
    );

  return withCursors(hydrate(db, rows), limit);
}

export function queryList(db, address, params) {
  const where = addressWhere(address, params.direction);
  const dir = directionClause(params.direction);
  const limit = clampLimit(params.limit);

  let sql;
  let args;

  if (params.after) {
    const c = decodeCursor(params.after);
    sql = `SELECT * FROM messages
           WHERE ${where.sql}${dir.sql}
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    args = [
      ...where.params,
      ...dir.params,
      c.timestamp,
      c.timestamp,
      c.id,
      limit,
    ];
  } else if (params.before) {
    const c = decodeCursor(params.before);
    sql = `SELECT * FROM messages
           WHERE ${where.sql}${dir.sql}
             AND (created_at > ? OR (created_at = ? AND id > ?))
           ORDER BY created_at ASC, id ASC LIMIT ?`;
    args = [
      ...where.params,
      ...dir.params,
      c.timestamp,
      c.timestamp,
      c.id,
      limit,
    ];
  } else {
    sql = `SELECT * FROM messages
           WHERE ${where.sql}${dir.sql}
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    args = [...where.params, ...dir.params, limit];
  }

  const rows = db.query(sql).all(...args);
  if (params.before) rows.reverse();

  return withCursors(hydrate(db, rows), limit);
}
