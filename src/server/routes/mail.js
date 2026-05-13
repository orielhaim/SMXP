import { Elysia, t } from "elysia";
import { v4 as uuidv4 } from "uuid";
import { queryMessages } from "../../store/messages-provider.js";
import { maybeRefreshToken, withAuth } from "../auth.js";
import { sendMessage } from "../../client/send.js";
import { blobsStore } from "../../store/blobs-provider.js";
import { config } from "../../config.js";

const PaginationQuery = t.Object(
  {
    limit: t.Optional(
      t.String({ description: "Max results (1-100, default 20)" }),
    ),
    after: t.Optional(t.String({ description: "Cursor for next page" })),
    before: t.Optional(t.String({ description: "Cursor for previous page" })),
  },
  { additionalProperties: true },
);

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
  t.Literal("forward"),
]);

const EditContentType = t.Union([
  t.Literal("text"),
  t.Literal("markdown"),
  t.Literal("html"),
]);

const AttachmentInput = t.Object({
  blob_id: t.String(),
  name: t.Optional(t.String()),
  content_type: t.Optional(t.String()),
  disposition: t.Optional(
    t.Union([
      t.Literal("attachment"),
      t.Literal("inline"),
      t.Literal("embedded"),
    ]),
  ),
  encryption: t.Optional(
    t.Object({
      algorithm: t.String(),
      key: t.String(),
      nonce_prefix: t.String(),
      chunk_size: t.Number(),
      plaintext_size: t.Number(),
      plaintext_sha256: t.Optional(t.String()),
    }),
  ),
  thumbnail: t.Optional(
    t.Object({
      data: t.String(),
      content_type: t.String(),
      width: t.Optional(t.Number()),
      height: t.Optional(t.Number()),
    }),
  ),
});

function getOriginalEnvelope(row) {
  if (row.content_type === "forward") {
    return JSON.parse(row.body);
  }

  return {
    version: "SMXP/1.0",
    id: row.id,
    from: row.sender,
    to: row.recipient,
    timestamp: row.timestamp ?? row.created_at,
    type: row.type,
    conversation_id: row.conversation_id,
    content_type: row.content_type,
    subject: row.subject ?? undefined,
    body: row.body ?? undefined,
    in_reply_to: row.in_reply_to ?? undefined,
    server_signature: row.server_signature ?? row.signature,
    server_key_id: row.server_key_id ?? row.key_id,
  };
}

export function mailRoutes() {
  return new Elysia({ prefix: "/.smxp/mail" })
    .use(withAuth())

    .get(
      "/inbox",
      async ({ authInfo, query, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const result = await queryMessages(address, {
          ...query,
          direction: "in",
        });
        maybeRefreshToken(set.headers, authInfo);
        return result;
      },
      {
        query: PaginationQuery,
        detail: { tags: ["Mail"], summary: "List inbox messages" },
      },
    )

    .get(
      "/sent",
      async ({ authInfo, query, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const result = await queryMessages(address, {
          ...query,
          direction: "out",
        });
        maybeRefreshToken(set.headers, authInfo);
        return result;
      },
      {
        query: PaginationQuery,
        detail: { tags: ["Mail"], summary: "List sent messages" },
      },
    )

    .get(
      "/messages/:id",
      async ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const result = await queryMessages(address, { id: params.id });
        const row = result.messages[0];

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
      async ({ authInfo, params, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const result = await queryMessages(address, { thread: params.id });

        if (result.messages.length === 0) {
          set.status = 404;
          return { error: "thread not found" };
        }

        maybeRefreshToken(set.headers, authInfo);
        return result;
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

        const address = `${authInfo.alias}@${authInfo.domain}`;
        const from = body.from ?? address;
        const recipients = Array.isArray(body.to) ? body.to : [body.to];

        try {
          // build attachment refs for the envelope
          let attachmentRefs = [];
          if (Array.isArray(body.attachments) && body.attachments.length > 0) {
            const blobs = blobsStore();
            const owner = address;
            attachmentRefs = body.attachments.map((a) => {
              const meta = blobs.getMeta(a.blob_id);
              if (!meta) throw new Error(`blob ${a.blob_id} not found`);
              if (meta.owner !== owner) {
                throw new Error(`blob ${a.blob_id} not owned by ${owner}`);
              }
              if (meta.status !== "ready") {
                throw new Error(`blob ${a.blob_id} not finalized`);
              }
              return {
                blob_id: meta.blob_id,
                sha256: meta.sha256,
                size: meta.size,
                content_type: a.content_type ?? meta.content_type,
                name: a.name ?? meta.name,
                disposition: a.disposition ?? "attachment",
                encryption: a.encryption,
                thumbnail: a.thumbnail,
              };
            });
          }

          const results = [];
          for (const to of recipients) {
            const conversation_id = body.conversation_id ?? uuidv4();

            // issue per-recipient download tokens for each attachment
            const perRecipientAtts = attachmentRefs.map((ref) => {
              const { token } = blobsStore().issueToken(ref.blob_id, {
                recipient: to,
              });
              return {
                ...ref,
                host: authInfo.domain,
                port: config.port,
                download_token: token,
              };
            });

            const result = await sendMessage({
              from,
              to,
              subject: body.subject ?? "",
              body: body.body ?? "",
              type: body.type ?? "message",
              conversation_id,
              in_reply_to: body.in_reply_to ?? null,
              content_type: body.content_type ?? "text",
              attachments: perRecipientAtts,
              delegator: address,
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
          from: t.Optional(t.String({ minLength: 1 })),
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
          attachments: t.Optional(t.Array(AttachmentInput)),
        }),
        detail: {
          tags: ["Mail"],
          summary: "Send a message to one or more recipients",
        },
      },
    )

    .post(
      "/messages/:id/forward",
      async ({ authInfo, params, body, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }
        const address = `${authInfo.alias}@${authInfo.domain}`;
        const result = await queryMessages(address, { id: params.id });
        const row = result.messages[0];

        if (!row) {
          set.status = 404;
          return { error: "message not found" };
        }

        try {
          const original = getOriginalEnvelope(row);
          const recipients = Array.isArray(body.to) ? body.to : [body.to];
          const results = [];

          for (const to of recipients) {
            const result = await sendMessage({
              from: address,
              to,
              subject: body.subject ?? row.subject ?? "",
              body: JSON.stringify(original),
              type: "message",
              conversation_id: body.conversation_id ?? uuidv4(),
              content_type: "forward",
            });
            results.push({
              status: "forwarded",
              to,
              id: result?.envelope?.id ?? null,
            });
          }

          maybeRefreshToken(set.headers, authInfo);
          set.status = 201;
          return { status: "forwarded", results };
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
          conversation_id: t.Optional(t.String()),
        }),
        detail: { tags: ["Mail"], summary: "Forward a message" },
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
        const result = await queryMessages(address, {
          id: params.id,
          direction: "out",
        });
        const row = result.messages[0];

        if (!row) {
          set.status = 404;
          return { error: "message not found" };
        }

        const from = body.from ?? address;
        const recipients = Array.isArray(body.to) ? body.to : [body.to];

        try {
          const results = [];
          for (const to of recipients) {
            const result = await sendMessage({
              from,
              to,
              subject: body.subject ?? "",
              body: body.body ?? "",
              type: "edit",
              conversation_id: row.conversation_id,
              in_reply_to: params.id,
              content_type: body.content_type ?? "text",
              delegator: address,
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
          content_type: t.Optional(EditContentType),
          from: t.Optional(t.String({ minLength: 1 })),
        }),
        detail: { tags: ["Mail"], summary: "Edit a sent message" },
      },
    );
}
