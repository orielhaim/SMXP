import { fromBase64Url, toBase64Url } from "./encoding.js";

export function encodeCursor(row) {
  return toBase64Url(Buffer.from(`${row.created_at}:${row.id}`));
}

export function decodeCursor(cursor) {
  const str = Buffer.from(fromBase64Url(cursor)).toString();
  const [ts, ...idParts] = str.split(":");
  return { timestamp: parseInt(ts, 10), id: idParts.join(":") };
}

export function buildPaginatedResponse(rows, limit) {
  const hasMore = rows.length >= limit;

  return {
    cursors: {
      next: rows.length > 0 ? encodeCursor(rows[rows.length - 1]) : null,
      prev: rows.length > 0 ? encodeCursor(rows[0]) : null,
      has_more: hasMore,
    },
  };
}

export function clampLimit(limit) {
  const n = parseInt(limit, 10) || 20;
  return Math.max(1, Math.min(100, n));
}
