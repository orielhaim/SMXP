import { Elysia, t } from "elysia";
import { blobsStore } from "../../store/index.js";
import { maybeRefreshToken, withAuth } from "../auth.js";

function ownerOf(authInfo) {
  return `${authInfo.alias}@${authInfo.domain}`;
}

async function readRequestBytes(request) {
  const buf = await request.arrayBuffer();
  return new Uint8Array(buf);
}

function parseRange(header, total) {
  if (!header || !header.startsWith("bytes=")) return null;
  const [s, e] = header.slice(6).split("-");
  const start = s === "" ? null : parseInt(s, 10);
  const end = e === "" ? null : parseInt(e, 10);

  if (start === null && end === null) return null;
  if (start === null)
    return { start: Math.max(0, total - end), end: total - 1 };
  if (end === null) return { start, end: total - 1 };
  return { start, end };
}

export function blobsRoutes() {
  return (
    new Elysia({ prefix: "/.smxp/blobs" })
      .use(withAuth())

      // Initiate upload
      .post(
        "/",
        ({ authInfo, body, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          try {
            const { blobId, chunkSize } = blobsStore.create({
              owner: ownerOf(authInfo),
              size: body.size,
              sha256: body.sha256,
              contentType: body.content_type ?? null,
              name: body.name ?? null,
            });
            set.status = 201;
            maybeRefreshToken(set.headers, authInfo);
            return { blob_id: blobId, chunk_size: chunkSize };
          } catch (err) {
            set.status = 400;
            return { error: err.message };
          }
        },
        {
          body: t.Object({
            size: t.Number({ minimum: 1 }),
            sha256: t.String({ minLength: 64, maxLength: 64 }),
            content_type: t.Optional(t.String()),
            name: t.Optional(t.String()),
          }),
          detail: { tags: ["Blobs"], summary: "Initiate a blob upload" },
        },
      )

      // Upload chunk
      .put(
        "/:id/chunk",
        async ({ authInfo, params, query, request, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const meta = blobsStore.getMeta(params.id);
          if (!meta) {
            set.status = 404;
            return { error: "blob not found" };
          }
          if (meta.owner !== ownerOf(authInfo)) {
            set.status = 403;
            return { error: "not owner" };
          }

          try {
            const offset = parseInt(query.offset ?? "0", 10);
            const bytes = await readRequestBytes(request);
            const result = await blobsStore.appendChunk(
              params.id,
              offset,
              bytes,
            );
            maybeRefreshToken(set.headers, authInfo);
            return { received: result.received };
          } catch (err) {
            set.status = 400;
            return { error: err.message };
          }
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({ offset: t.Optional(t.String()) }),
          detail: {
            tags: ["Blobs"],
            summary: "Upload a chunk to a pending blob",
          },
        },
      )

      // Finalize
      .post(
        "/:id/finalize",
        async ({ authInfo, params, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const meta = blobsStore.getMeta(params.id);
          if (!meta) {
            set.status = 404;
            return { error: "blob not found" };
          }
          if (meta.owner !== ownerOf(authInfo)) {
            set.status = 403;
            return { error: "not owner" };
          }

          try {
            const result = await blobsStore.finalize(params.id);
            maybeRefreshToken(set.headers, authInfo);
            return result;
          } catch (err) {
            set.status = 400;
            return { error: err.message };
          }
        },
        {
          params: t.Object({ id: t.String() }),
          detail: { tags: ["Blobs"], summary: "Finalize an upload" },
        },
      )

      // Download — public, gated by token
      .get(
        "/:id",
        ({ params, query, headers, set }) => {
          const { ok } = blobsStore.verifyToken(params.id, query.token);
          if (!ok) {
            set.status = 401;
            return { error: "invalid token" };
          }

          const meta = blobsStore.head(params.id);
          if (!meta) {
            set.status = 404;
            return { error: "blob not found" };
          }

          const range = parseRange(headers.range, meta.size);
          const opened = blobsStore.open(params.id, { range });
          if (!opened) {
            set.status = 416;
            return { error: "invalid range" };
          }

          const respHeaders = {
            "Content-Type": opened.contentType,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
          };

          if (range) {
            respHeaders["Content-Range"] =
              `bytes ${opened.start}-${opened.end}/${meta.size}`;
            respHeaders["Content-Length"] = String(
              opened.end - opened.start + 1,
            );
            set.status = 206;
          } else {
            respHeaders["Content-Length"] = String(meta.size);
          }

          return new Response(opened.stream, {
            status: set.status ?? 200,
            headers: respHeaders,
          });
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({ token: t.String() }),
          detail: { tags: ["Blobs"], summary: "Download a blob (token-gated)" },
        },
      )

      // HEAD
      .head(
        "/:id",
        ({ params, query, set }) => {
          const { ok } = blobsStore.verifyToken(params.id, query.token);
          if (!ok) {
            set.status = 401;
            return new Response(null, { status: 401 });
          }
          const meta = blobsStore.head(params.id);
          if (!meta) return new Response(null, { status: 404 });

          return new Response(null, {
            status: 200,
            headers: {
              "Content-Type": meta.content_type ?? "application/octet-stream",
              "Content-Length": String(meta.size),
              "Accept-Ranges": "bytes",
            },
          });
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({ token: t.String() }),
          detail: { tags: ["Blobs"], summary: "Blob metadata" },
        },
      )

      // List owned blobs
      .get(
        "/",
        ({ authInfo, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          maybeRefreshToken(set.headers, authInfo);
          return { blobs: blobsStore.listByOwner(ownerOf(authInfo)) };
        },
        { detail: { tags: ["Blobs"], summary: "List blobs owned by caller" } },
      )

      // Delete
      .delete(
        "/:id",
        ({ authInfo, params, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const ok = blobsStore.delete(params.id, ownerOf(authInfo));
          if (!ok) {
            set.status = 404;
            return { error: "blob not found" };
          }
          maybeRefreshToken(set.headers, authInfo);
          return { status: "deleted", id: params.id };
        },
        {
          params: t.Object({ id: t.String() }),
          detail: {
            tags: ["Blobs"],
            summary: "Delete a blob and revoke all tokens",
          },
        },
      )

      // Issue extra token
      .post(
        "/:id/tokens",
        ({ authInfo, params, body, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const meta = blobsStore.getMeta(params.id);
          if (!meta) {
            set.status = 404;
            return { error: "blob not found" };
          }
          if (meta.owner !== ownerOf(authInfo)) {
            set.status = 403;
            return { error: "not owner" };
          }
          try {
            const result = blobsStore.issueToken(params.id, {
              recipient: body.recipient ?? null,
              expiresAt: body.expires_at ?? null,
            });
            set.status = 201;
            maybeRefreshToken(set.headers, authInfo);
            return result;
          } catch (err) {
            set.status = 400;
            return { error: err.message };
          }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            recipient: t.Optional(t.String()),
            expires_at: t.Optional(t.Nullable(t.Number())),
          }),
          detail: {
            tags: ["Blobs"],
            summary: "Issue an additional download token",
          },
        },
      )

      // List tokens
      .get(
        "/:id/tokens",
        ({ authInfo, params, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const meta = blobsStore.getMeta(params.id);
          if (!meta) {
            set.status = 404;
            return { error: "blob not found" };
          }
          if (meta.owner !== ownerOf(authInfo)) {
            set.status = 403;
            return { error: "not owner" };
          }
          maybeRefreshToken(set.headers, authInfo);
          return { tokens: blobsStore.listTokens(params.id) };
        },
        {
          params: t.Object({ id: t.String() }),
          detail: { tags: ["Blobs"], summary: "List tokens for a blob" },
        },
      )

      // Revoke token
      .delete(
        "/:id/tokens/:tokenId",
        ({ authInfo, params, set }) => {
          if (!authInfo) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const meta = blobsStore.getMeta(params.id);
          if (!meta || meta.owner !== ownerOf(authInfo)) {
            set.status = 404;
            return { error: "blob not found" };
          }
          const ok = blobsStore.revokeToken(params.id, params.tokenId);
          if (!ok) {
            set.status = 404;
            return { error: "token not found" };
          }
          maybeRefreshToken(set.headers, authInfo);
          return { status: "revoked", id: params.tokenId };
        },
        {
          params: t.Object({ id: t.String(), tokenId: t.String() }),
          detail: { tags: ["Blobs"], summary: "Revoke a download token" },
        },
      )
  );
}
