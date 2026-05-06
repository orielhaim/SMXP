import { Elysia, t } from "elysia";
import { v4 as uuidv4 } from "uuid";
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

function mapMessageRow(row) {
  return {
    ...row,
    expires: row.expires_at,
  };
}

function getAddress(authInfo) {
  return `${authInfo.alias}@${authInfo.domain}`;
}

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

  if (before) rows.reverse();

  return { rows, limit: safeLimit };
}

export function mailRoutes() {
  return new Elysia({ prefix: "/.smxp/mail" })

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

    .get("/sent", ({ request, query }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const address = getAddress(authInfo);
      const { rows, limit } = queryMessages("out", "sender", address, query);
      const messages = rows.map(mapMessageRow);
      const pagination = buildPaginatedResponse(messages, limit);

      return authedResponse(
        { messages, cursors: pagination.cursors },
        authInfo,
      );
    })

    .get("/message/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const db = getDb();
      const address = getAddress(authInfo);
      const row = db
        .query(
          `SELECT * FROM messages
           WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
        )
        .get(params.id, address, address);

      if (!row) return jsonResponse({ error: "message not found" }, 404);

      return authedResponse({ message: mapMessageRow(row) }, authInfo);
    })

    .get("/thread/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const db = getDb();
      const address = getAddress(authInfo);

      const root = db
        .query(
          `SELECT conversation_id FROM messages
           WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
        )
        .get(params.id, address, address);

      if (!root) return jsonResponse({ error: "thread not found" }, 404);

      const thread = db
        .query(
          `SELECT * FROM messages
           WHERE (delivered_to = ? OR sender = ?)
             AND conversation_id = ?
           ORDER BY created_at ASC`,
        )
        .all(address, address, root.conversation_id);

      return authedResponse({ messages: thread.map(mapMessageRow) }, authInfo);
    })

    .post(
      "/send",
      async ({ request, body }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const { sendMessage } = await import("../../client/send.js");
        const address = getAddress(authInfo);

        try {
          const recipients = Array.isArray(body.to) ? body.to : [body.to];
          const results = [];

          for (const to of recipients) {
            const conversation_id = body.conversation_id || uuidv4();

            const result = await sendMessage({
              from: address,
              to,
              subject: body.subject || "",
              body: body.body || "",
              type: body.type || "message",
              conversation_id,
              in_reply_to: body.in_reply_to || null,
              content_type: body.content_type || "text",
              on_behalf_of: body.on_behalf_of || null,
            });

            results.push({
              status: "sent",
              to,
              id: result?.envelope?.id || null,
              conversation_id,
            });
          }

          return authedResponse({ status: "sent", results }, authInfo, 201);
        } catch (err) {
          return jsonResponse({ error: err.message }, 500);
        }
      },
      {
        body: t.Object({
          to: t.Union([
            t.String({ minLength: 1 }),
            t.Array(t.String({ minLength: 1 })),
          ]),
          body: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          type: t.Optional(
            t.Union([
              t.Literal("message"),
              t.Literal("edit"),
              t.Literal("delete"),
              t.Literal("receipt"),
            ]),
          ),
          conversation_id: t.Optional(t.String()),
          in_reply_to: t.Optional(t.String()),
          content_type: t.Optional(t.String()),
          on_behalf_of: t.Optional(t.String()),
        }),
      },
    )

    .post("/read/:id", ({ request, params }) => {
      const authInfo = authenticate(request);
      if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

      const db = getDb();
      const address = getAddress(authInfo);

      const row = db
        .query(`SELECT id FROM messages WHERE id = ? AND delivered_to = ?`)
        .get(params.id, address);

      if (!row) return jsonResponse({ error: "message not found" }, 404);

      db.run(
        `UPDATE messages SET verified = 2 WHERE id = ? AND delivered_to = ?`,
        [params.id, address],
      );

      return authedResponse({ status: "read", id: params.id }, authInfo);
    })

    .post(
      "/edit/:id",
      async ({ request, params, body }) => {
        const authInfo = authenticate(request);
        if (!authInfo) return jsonResponse({ error: "unauthorized" }, 401);

        const db = getDb();
        const address = getAddress(authInfo);

        const row = db
          .query(
            `SELECT id, conversation_id FROM messages WHERE id = ? AND sender = ? AND direction = 'out'`,
          )
          .get(params.id, address);

        if (!row) return jsonResponse({ error: "message not found" }, 404);

        const { sendMessage } = await import("../../client/send.js");

        try {
          const recipients = Array.isArray(body.to) ? body.to : [body.to];
          const results = [];

          for (const to of recipients) {
            const result = await sendMessage({
              from: address,
              to,
              subject: body.subject || "",
              body: body.body || "",
              type: "edit",
              conversation_id: row.conversation_id,
              in_reply_to: params.id,
              content_type: body.content_type || "text",
              on_behalf_of: body.on_behalf_of || null,
            });
            results.push({
              status: "edited",
              to,
              id: result?.envelope?.id || null,
              original_id: params.id,
            });
          }

          return authedResponse({ status: "edited", results }, authInfo);
        } catch (err) {
          return jsonResponse({ error: err.message }, 500);
        }
      },
      {
        body: t.Object({
          to: t.Union([
            t.String({ minLength: 1 }),
            t.Array(t.String({ minLength: 1 })),
          ]),
          body: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          content_type: t.Optional(t.String()),
          on_behalf_of: t.Optional(t.String()),
        }),
      },
    );
}
