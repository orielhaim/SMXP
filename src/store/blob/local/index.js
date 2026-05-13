import { openBlobsDb } from "./db.js";
import { tokensApi } from "./tokens.js";
import {
  appendBytes,
  blobPath,
  computeSha256,
  fileSize,
  newBlobId,
  openReadStream,
  removeFile,
} from "./files.js";

const DEFAULT_CHUNK = 64 * 1024;
const MAX_BLOB_SIZE = 500 * 1024 * 1024; // 500MB

function rowToMeta(row) {
  if (!row) return null;
  return {
    blob_id: row.id,
    owner: row.owner,
    size: row.size,
    received: row.received,
    sha256: row.sha256,
    content_type: row.content_type ?? undefined,
    name: row.name ?? undefined,
    status: row.status,
    created_at: row.created_at,
    finalized_at: row.finalized_at ?? undefined,
  };
}

export function createLocalBlobsStore({
  dbPath,
  dataRoot,
  maxSize = MAX_BLOB_SIZE,
}) {
  const db = openBlobsDb(dbPath);
  const tokens = tokensApi(db);

  function getRow(blobId) {
    return db.query(`SELECT * FROM blobs WHERE id = ?`).get(blobId);
  }

  return {
    create({ owner, size, sha256, contentType = null, name = null }) {
      if (!owner) throw new Error("owner required");
      if (!Number.isInteger(size) || size <= 0) throw new Error("invalid size");
      if (size > maxSize) throw new Error(`blob too large (max ${maxSize})`);
      if (!sha256 || typeof sha256 !== "string")
        throw new Error("sha256 required");

      const id = newBlobId();
      db.run(
        `INSERT INTO blobs (id, owner, size, sha256, content_type, name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, owner, size, sha256, contentType, name],
      );

      return { blobId: id, chunkSize: DEFAULT_CHUNK };
    },

    async appendChunk(blobId, offset, bytes) {
      const row = getRow(blobId);
      if (!row) throw new Error("blob not found");
      if (row.status !== "pending")
        throw new Error("blob not accepting chunks");
      if (!Number.isInteger(offset) || offset < 0)
        throw new Error("invalid offset");
      if (offset !== row.received) {
        throw new Error(
          `offset mismatch: expected ${row.received}, got ${offset}`,
        );
      }
      if (row.received + bytes.length > row.size) {
        throw new Error("chunk exceeds declared size");
      }

      const path = blobPath(dataRoot, blobId);
      const newReceived = await appendBytes(path, offset, bytes);

      db.run(`UPDATE blobs SET received = ? WHERE id = ?`, [
        newReceived,
        blobId,
      ]);
      return { received: newReceived };
    },

    async finalize(blobId) {
      const row = getRow(blobId);
      if (!row) throw new Error("blob not found");
      if (row.status === "ready") return rowToMeta(row);
      if (row.status !== "pending") throw new Error("blob not finalizable");
      if (row.received !== row.size) {
        throw new Error(
          `size mismatch: declared ${row.size}, received ${row.received}`,
        );
      }

      const path = blobPath(dataRoot, blobId);
      const actualSize = fileSize(path);
      if (actualSize !== row.size) {
        throw new Error(
          `file size mismatch: declared ${row.size}, actual ${actualSize}`,
        );
      }

      const computed = await computeSha256(path);
      if (computed !== row.sha256) {
        removeFile(path);
        db.run(`DELETE FROM blobs WHERE id = ?`, [blobId]);
        throw new Error("sha256 mismatch");
      }

      const now = Math.floor(Date.now() / 1000);
      db.run(
        `UPDATE blobs SET status = 'ready', computed_sha256 = ?, finalized_at = ? WHERE id = ?`,
        [computed, now, blobId],
      );

      return rowToMeta(getRow(blobId));
    },

    delete(blobId, owner) {
      const row = getRow(blobId);
      if (!row) return false;
      if (owner && row.owner !== owner) return false;

      removeFile(blobPath(dataRoot, blobId));
      db.run(`DELETE FROM blobs WHERE id = ?`, [blobId]);
      return true;
    },

    open(blobId, { range } = {}) {
      const row = getRow(blobId);
      if (!row || row.status !== "ready") return null;

      const path = blobPath(dataRoot, blobId);
      const total = row.size;

      let start = 0;
      let end = total - 1;

      if (range) {
        start = Math.max(0, range.start ?? 0);
        end = Math.min(total - 1, range.end ?? total - 1);
        if (start > end) return null;
      }

      return {
        stream: openReadStream(path, { start, end }),
        size: total,
        start,
        end,
        contentType: row.content_type ?? "application/octet-stream",
        sha256: row.sha256,
      };
    },

    head(blobId) {
      const row = getRow(blobId);
      if (!row || row.status !== "ready") return null;
      return rowToMeta(row);
    },

    listByOwner(owner) {
      const rows = db
        .query(`SELECT * FROM blobs WHERE owner = ? ORDER BY created_at DESC`)
        .all(owner);
      return rows.map(rowToMeta);
    },

    getMeta(blobId) {
      return rowToMeta(getRow(blobId));
    },

    issueToken(blobId, opts = {}) {
      const row = getRow(blobId);
      if (!row || row.status !== "ready") throw new Error("blob not ready");
      return tokens.issue(blobId, opts);
    },

    verifyToken(blobId, token) {
      return tokens.verify(blobId, token);
    },

    listTokens(blobId) {
      return tokens.list(blobId);
    },

    revokeToken(blobId, tokenId) {
      return tokens.revoke(blobId, tokenId);
    },

    revokeAllTokens(blobId) {
      tokens.revokeAll(blobId);
    },

    close() {
      db.close();
    },
  };
}
