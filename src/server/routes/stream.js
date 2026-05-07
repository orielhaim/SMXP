import { Elysia } from "elysia";
import { getAddress } from "../../store/addresses.js";
import { getDb } from "../../store/db.js";
import { withAuth } from "../auth.js";
import { eventBus } from "../eventbus.js";

function getMessagesSince(address, lastEventId) {
  const db = getDb();
  const anchor = db
    .query(
      `SELECT created_at FROM messages WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
    )
    .get(lastEventId, address, address);
  if (!anchor) return [];

  return db
    .query(
      `SELECT * FROM messages
       WHERE (delivered_to = ? OR sender = ?) AND created_at > ?
       ORDER BY created_at ASC`,
    )
    .all(address, address, anchor.created_at);
}

export function streamRoutes() {
  return new Elysia({ prefix: "/.smxp" })
    .use(withAuth())

    .get(
      "/stream",
      ({ authInfo, request, set }) => {
        if (!authInfo) {
          set.status = 401;
          return { error: "unauthorized" };
        }

        const addrRow = getAddress(authInfo.domain, authInfo.alias);
        if (!addrRow || addrRow.mode !== "inbox") {
          set.status = 400;
          return { error: "SSE only available for inbox addresses" };
        }

        const targetAddress = `${authInfo.alias}@${authInfo.domain}`;
        const enc = new TextEncoder();

        const sseFrame = (id, event, data) =>
          enc.encode(
            `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          );

        const stream = new ReadableStream({
          start(controller) {
            // Replay missed messages since last seen event ID
            const lastEventId = request.headers.get("last-event-id");
            if (lastEventId) {
              for (const msg of getMessagesSince(targetAddress, lastEventId)) {
                controller.enqueue(
                  sseFrame(msg.id, msg.type ?? "message", msg),
                );
              }
            }

            const callback = (msg) => {
              controller.enqueue(sseFrame(msg.id, msg.type ?? "message", msg));
            };
            eventBus.subscribe(targetAddress, callback);

            const keepalive = setInterval(
              () => controller.enqueue(enc.encode(":keepalive\n\n")),
              30_000,
            );

            request.signal.addEventListener("abort", () => {
              clearInterval(keepalive);
              eventBus.unsubscribe(targetAddress, callback);
              try {
                controller.close();
              } catch {}
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
      {
        detail: { tags: ["Stream"], summary: "Server-Sent Events stream for real-time message delivery" },
      },
    );
}
