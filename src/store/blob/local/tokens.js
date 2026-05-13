import { createHash, randomBytes } from "node:crypto";
import { toBase64Url } from "../../../shared/encoding.js";

export function tokensApi(db) {
  return {
    issue(blobId, { recipient = null, expiresAt = null } = {}) {
      const id = `bltid_${toBase64Url(randomBytes(8))}`;
      const token = `blt_${toBase64Url(randomBytes(32))}`;
      const hash = hashToken(token);

      db.run(
        `INSERT INTO blob_tokens (id, blob_id, hash, recipient, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, blobId, hash, recipient, expiresAt],
      );

      return { token, id };
    },

    verify(blobId, token) {
      if (!token) return { ok: false };
      const row = db
        .query(
          `SELECT id, blob_id, recipient, expires_at FROM blob_tokens WHERE hash = ?`,
        )
        .get(hashToken(token));

      if (!row) return { ok: false };
      if (row.blob_id !== blobId) return { ok: false };
      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at && row.expires_at < now) return { ok: false };

      db.run(`UPDATE blob_tokens SET last_used = ? WHERE id = ?`, [
        now,
        row.id,
      ]);
      return { ok: true, recipient: row.recipient, tokenId: row.id };
    },

    list(blobId) {
      return db
        .query(
          `SELECT id, recipient, created_at, expires_at, last_used
           FROM blob_tokens WHERE blob_id = ? ORDER BY created_at DESC`,
        )
        .all(blobId);
    },

    revoke(blobId, tokenId) {
      const r = db
        .query(
          `DELETE FROM blob_tokens WHERE blob_id = ? AND id = ? RETURNING id`,
        )
        .get(blobId, tokenId);
      return !!r;
    },

    revokeAll(blobId) {
      db.run(`DELETE FROM blob_tokens WHERE blob_id = ?`, [blobId]);
    },
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
