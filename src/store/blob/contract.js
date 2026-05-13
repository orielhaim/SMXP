/**
 * BlobsStore contract.
 *
 * Lifecycle:
 *   create({ owner, size, sha256, contentType, name }) -> { blobId, chunkSize }
 *   appendChunk(blobId, offset, bytes) -> { received }
 *   finalize(blobId) -> { blobId, size, sha256 }
 *   delete(blobId, owner) -> boolean
 *
 * Reading:
 *   open(blobId, { range }) -> { stream, size, contentType, sha256, end? }
 *   head(blobId) -> { size, contentType, sha256 } | null
 *
 * Ownership / listing:
 *   listByOwner(owner) -> Array<BlobMeta>
 *   getMeta(blobId) -> BlobMeta | null
 *
 * Tokens:
 *   issueToken(blobId, { recipient, expiresAt }) -> { token }
 *   verifyToken(blobId, token) -> { ok, recipient? }
 *   listTokens(blobId) -> Array<TokenMeta>
 *   revokeToken(blobId, tokenId) -> boolean
 *   revokeAllTokens(blobId) -> void
 *
 *   close?()
 */
export const REQUIRED = Object.freeze([
  "create",
  "appendChunk",
  "finalize",
  "delete",
  "open",
  "head",
  "listByOwner",
  "getMeta",
  "issueToken",
  "verifyToken",
  "listTokens",
  "revokeToken",
  "revokeAllTokens",
]);

export function assertContract(store) {
  for (const m of REQUIRED) {
    if (typeof store?.[m] !== "function") {
      throw new TypeError(`BlobsStore missing method: ${m}()`);
    }
  }
  return store;
}
