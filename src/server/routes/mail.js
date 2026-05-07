import { Elysia, t } from "elysia";
import { v4 as uuidv4 } from "uuid";
import {
  buildPaginatedResponse,
  clampLimit,
  decodeCursor,
} from "../../shared/cursor.js";
import { getDb } from "../../store/db.js";
import { maybeRefreshToken, withAuth } from "../auth.js";

const PaginationQuery = t.Object({
  limit: t.Optional(
    t.String({ description: "Max results (1-100, default 20)" }),
  ),
  after: t.Optional(t.String({ description: "Cursor for next page" })),
  before: t.Optional(t.String({ description: "Cursor for previous page" })),
});

const MessageType = t.Union([
  t.Literal("message"),
  t.Literal("edit"),
  t.Literal("delete"),
  t.Literal("receipt"),
]);

const ContentType = t.Union([
  t.Literal("text"),
  t.Literal("markdown"),
  t.Literal("html"),
]);

function queryMessages(
  direction,
  addressField,
  address,
  { limit, after, before },
) {
  const db = getDb();
  const safeLimit = clampLimit(limit);

  let sql;
  let params;

  if (after) {
    const c = decodeCursor(after);
    sql = `SELECT * FROM messages
           WHERE direction = ? AND ${addressField} = ?
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    params = [direction, address, c.timestamp, c.timestamp, c.id, safeLimit];
  } else if (before) {
    const c = decodeCursor(before);
    sql = `SELECT * FROM messages
           WHERE direction = ? AND ${addressField} = ?
             AND (created_at > ? OR (created_at = ? AND id > ?))
           ORDER BY created_at ASC, id ASC LIMIT ?`;
    params = [direction, address, c.timestamp, c.timestamp, c.id, safeLimit];
  } else {
    sql = `SELECT * FROM messages
           WHERE direction = ? AND ${addressField} = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    params = [direction, address, safeLimit];
  }

  const rows = db.query(sql).all(...params);
  if (before) rows.reverse();
  return { rows, limit: safeLimit };
}

export function mailRoutes() {
  return new Elysia({ prefix: "/.smxp/mail" })
    .use(withAuth())

    .get(
      "/inbox",
      ({ authInfo, query, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const { rows, limit } = queryMessages(
          "in",
          "delivered_to",
          address,
          query,
        );
        const { cursors } = buildPaginatedResponse(rows, limit);
        maybeRefreshToken(set.headers, authInfo);
        return { messages: rows, cursors };
      },
      {
        query: PaginationQuery,
        detail: { tags: ["Mail"], summary: "List inbox messages" },
      },
    )

    .get(
      "/sent",
      ({ authInfo, query, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const { rows, limit } = queryMessages("out", "sender", address, query);
        const { cursors } = buildPaginatedResponse(rows, limit);
        maybeRefreshToken(set.headers, authInfo);
        return { messages: rows, cursors };
      },
      {
        query: PaginationQuery,
        detail: { tags: ["Mail"], summary: "List sent messages" },
      },
    )

    .get(
      "/messages/:id",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const row = getDb()
          .query(
            `SELECT * FROM messages WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
          )
          .get(params.id, address, address);

        if (!row) {
          set.status = 404;
          return { error: "message not found" };
        }
        maybeRefreshToken(set.headers, authInfo);
        return { message: row };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Mail"], summary: "Get a single message by ID" },
      },
    )

    .get(
      "/threads/:id",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const db = getDb();

        const root = db
          .query(
            `SELECT conversation_id FROM messages
             WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
          )
          .get(params.id, address, address);

        if (!root) {
          set.status = 404;
          return { error: "thread not found" };
        }

        const messages = db
          .query(
            `SELECT * FROM messages
             WHERE (delivered_to = ? OR sender = ?) AND conversation_id = ?
             ORDER BY created_at ASC`,
          )
          .all(address, address, root.conversation_id);

        maybeRefreshToken(set.headers, authInfo);
        return { messages };
      },
      {
        params: t.Object({
          id: t.String({ description: "Any message ID within the thread" }),
        }),
        detail: {
          tags: ["Mail"],
          summary: "Get all messages in a thread by any message ID",
        },
      },
    )

    .post(
      "/send",
      async ({ authInfo, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const { sendMessage } = await import("../../client/send.js");
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const recipients = Array.isArray(body.to) ? body.to : [body.to];

        try {
          const results = [];
          for (const to of recipients) {
            const conversation_id = body.conversation_id ?? uuidv4();
            const result = await sendMessage({
              from: address,
              to,
              subject: body.subject ?? "",
              body: body.body ?? "",
              type: body.type ?? "message",
              conversation_id,
              in_reply_to: body.in_reply_to ?? null,
              content_type: body.content_type ?? "text",
              on_behalf_of: body.on_behalf_of ?? null,
            });
            results.push({
              status: "sent",
              to,
              id: result?.envelope?.id ?? null,
              conversation_id,
            });
          }
          set.status = 201;
          maybeRefreshToken(set.headers, authInfo);
          return { status: "sent", results };
        } catch (err) {
          set.status = 500;
          return { error: err.message };
        }
      },
      {
        body: t.Object({
          to: t.Union([
            t.String({ minLength: 1 }),
            t.Array(t.String({ minLength: 1 })),
          ]),
          subject: t.Optional(t.String()),
          body: t.Optional(t.String()),
          type: t.Optional(MessageType),
          conversation_id: t.Optional(t.String()),
          in_reply_to: t.Optional(t.String()),
          content_type: t.Optional(ContentType),
          on_behalf_of: t.Optional(t.String()),
        }),
        detail: {
          tags: ["Mail"],
          summary: "Send a message to one or more recipients",
        },
      },
    )

    .post(
      "/messages/:id/read",
      ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const db = getDb();
        const row = db
          .query(`SELECT id FROM messages WHERE id = ? AND delivered_to = ?`)
          .get(params.id, address);

        if (!row) {
          set.status = 404;
          return { error: "message not found" };
        }
        db.run(
          `UPDATE messages SET verified = 2 WHERE id = ? AND delivered_to = ?`,
          [params.id, address],
        );
        maybeRefreshToken(set.headers, authInfo);
        return { status: "read", id: params.id };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ["Mail"], summary: "Mark a message as read" },
      },
    )

    .post(
      "/messages/:id/edit",
      async ({ authInfo, params, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const db = getDb();
        const row = db
          .query(
            `SELECT id, conversation_id FROM messages
             WHERE id = ? AND sender = ? AND direction = 'out'`,
          )
          .get(params.id, address);

        if (!row) {
          set.status = 404;
          return { error: "message not found" };
        }

        const { sendMessage } = await import("../../client/send.js");
        const recipients = Array.isArray(body.to) ? body.to : [body.to];

        try {
          const results = [];
          for (const to of recipients) {
            const result = await sendMessage({
              from: address,
              to,
              subject: body.subject ?? "",
              body: body.body ?? "",
              type: "edit",
              conversation_id: row.conversation_id,
              in_reply_to: params.id,
              content_type: body.content_type ?? "text",
              on_behalf_of: body.on_behalf_of ?? null,
            });
            results.push({
              status: "edited",
              to,
              id: result?.envelope?.id ?? null,
              original_id: params.id,
            });
          }
          maybeRefreshToken(set.headers, authInfo);
          return { status: "edited", results };
        } catch (err) {
          set.status = 500;
          return { error: err.message };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          to: t.Union([
            t.String({ minLength: 1 }),
            t.Array(t.String({ minLength: 1 })),
          ]),
          subject: t.Optional(t.String()),
          body: t.Optional(t.String()),
          content_type: t.Optional(ContentType),
          on_behalf_of: t.Optional(t.String()),
        }),
        detail: { tags: ["Mail"], summary: "Edit a sent message" },
      },
    );
}
