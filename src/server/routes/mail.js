import { Elysia, t } from "elysia";
import { getDb } from "../../store/db.js";
import {
  buildPaginatedResponse,
  clampLimit,
  decodeCursor,
} from "../../shared/cursor.js";
import { authenticate, maybeRefreshToken } from "../auth.js";

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function authedResponse(body, authInfo, status = 200) {
  const headers = { "Content-Type": "application/json" };
  maybeRefreshToken(headers, authInfo);
  return new Response(JSON.stringify(body), { status, headers });
}

function parseReferences(referencesJson) {
  if (!referencesJson) return null;
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

function getAddress(authInfo) {
  return `${authInfo.alias}@${authInfo.domain}`;
}

// ── Paginated message queries ──

function queryMessages(
  direction,
  addressField,
  address,
  { limit, after, before },
) {
  const db = getDb();
  const safeLimit = clampLimit(limit);
  let query;
  let params;

  if (after) {
    const cursor = decodeCursor(after);
    query = `
      SELECT * FROM messages
      WHERE direction = ? AND ${addressField} = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    params = [
      direction,
      address,
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      safeLimit,
    ];
  } else if (before) {
    const cursor = decodeCursor(before);
    query = `
      SELECT * FROM messages
      WHERE direction = ? AND ${addressField} = ?
        AND (created_at > ? OR (created_at = ? AND id > ?))
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `;
    params = [
      direction,
      address,
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      safeLimit,
    ];
  } else {
    query = `
      SELECT * FROM messages
      WHERE direction = ? AND ${addressField} = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    params = [direction, address, safeLimit];
  }

  const rows = db.query(query).all(...params);

  // If queried with 'before', reverse back to DESC order
  if (before) rows.reverse();

  return { rows, limit: safeLimit };
}

export function mailRoutes() {
  return (
    new Elysia({ prefix: "/.smxp/mail" })

      // ── Inbox ──
      .get("/inbox", ({ request, query }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const address = getAddress(authInfo);
        const { rows, limit } = queryMessages(
          "in",
          "delivered_to",
          address,
          query,
        );
        const messages = rows.map(mapMessageRow);
        const pagination = buildPaginatedResponse(messages, limit);

        return authedResponse(
          { messages, cursors: pagination.cursors },
          authInfo,
        );
      })

      // ── Sent ──
      .get("/sent", ({ request, query }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const address = getAddress(authInfo);
        const { rows, limit } = queryMessages("out", '"from"', address, query);
        const messages = rows.map(mapMessageRow);
        const pagination = buildPaginatedResponse(messages, limit);

        return authedResponse(
          { messages, cursors: pagination.cursors },
          authInfo,
        );
      })

      // ── Single message ──
      .get("/message/:id", ({ request, params }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const db = getDb();
        const address = getAddress(authInfo);
        const row = db
          .query(
            `SELECT * FROM messages
           WHERE id = ? AND (delivered_to = ? OR "from" = ?)`,
          )
          .get(params.id, address, address);

        if (!row) return jsonResponse({ error: "message not found" }, 404);

        return authedResponse({ message: mapMessageRow(row) }, authInfo);
      })

      // ── Thread ──
      .get("/thread/:id", ({ request, params }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const db = getDb();
        const address = getAddress(authInfo);

        // Get the root message first
        const root = db
          .query(
            `SELECT * FROM messages
           WHERE id = ? AND (delivered_to = ? OR "from" = ?)`,
          )
          .get(params.id, address, address);

        if (!root) return jsonResponse({ error: "thread not found" }, 404);

        // Find all messages that reference this thread ID, or are referenced by it
        const thread = db
          .query(
            `SELECT * FROM messages
           WHERE (delivered_to = ? OR "from" = ?)
             AND (id = ? OR references_json LIKE ?)
           ORDER BY created_at ASC`,
          )
          .all(address, address, params.id, `%${params.id}%`);

        return authedResponse(
          { messages: thread.map(mapMessageRow) },
          authInfo,
        );
      })

      // ── Send message ──
      .post(
        "/send",
        async ({ request, body }) => {
          const authInfo = authenticate(request);
          if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

          // Dynamically import send logic to avoid circular deps
          const { sendMessage } = await import("../../client/send.js");
          const address = getAddress(authInfo);

          try {
            const result = await sendMessage({
              from: address,
              to: body.to,
              subject: body.subject || "",
              body: body.body,
              type: body.type || "message",
              references: body.references || null,
            });

            return authedResponse(
              { status: "sent", id: result?.id || null },
              authInfo,
              201,
            );
          } catch (err) {
            return jsonResponse({ error: err.message }, 500);
          }
        },
        {
          body: t.Object({
            to: t.String({ minLength: 1 }),
            body: t.String({ minLength: 1 }),
            subject: t.Optional(t.String()),
            type: t.Optional(
              t.Union([
                t.Literal("message"),
                t.Literal("edit"),
                t.Literal("receipt"),
              ]),
            ),
            references: t.Optional(t.Nullable(t.Array(t.String()))),
          }),
        },
      )

      // ── Mark as read ──
      .post("/read/:id", ({ request, params }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const db = getDb();
        const address = getAddress(authInfo);

        const row = db
          .query(`SELECT id FROM messages WHERE id = ? AND delivered_to = ?`)
          .get(params.id, address);

        if (!row) return jsonResponse({ error: "message not found" }, 404);

        // Mark as read by setting verified to a "read" state (2 = read)
        db.run(
          `UPDATE messages SET verified = 2 WHERE id = ? AND delivered_to = ?`,
          [params.id, address],
        );

        return authedResponse({ status: "read", id: params.id }, authInfo);
      })

      // ── Edit message ──
      .post(
        "/edit/:id",
        async ({ request, params, body }) => {
          const authInfo = authenticate(request);
          if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

          const db = getDb();
          const address = getAddress(authInfo);

          // Only allow editing own outbound messages
          const row = db
            .query(
              `SELECT id FROM messages WHERE id = ? AND "from" = ? AND direction = 'out'`,
            )
            .get(params.id, address);

          if (!row) return jsonResponse({ error: "message not found" }, 404);

          // Send an edit-type message referencing the original
          const { sendMessage } = await import("../../client/send.js");

          try {
            const result = await sendMessage({
              from: address,
              to: body.to,
              subject: body.subject || "",
              body: body.body,
              type: "edit",
              references: [params.id],
            });

            return authedResponse(
              {
                status: "edited",
                id: result?.id || null,
                original_id: params.id,
              },
              authInfo,
            );
          } catch (err) {
            return jsonResponse({ error: err.message }, 500);
          }
        },
        {
          body: t.Object({
            to: t.String({ minLength: 1 }),
            body: t.String({ minLength: 1 }),
            subject: t.Optional(t.String()),
          }),
        },
      )
  );
}
