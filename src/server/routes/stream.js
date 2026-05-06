import { Elysia } from "elysia";
import { getAddress } from "../../store/addresses.js";
import { getDb } from "../../store/db.js";
import { authenticate } from "../auth.js";
import { eventBus } from "../eventbus.js";

function getMessagesSince(address, lastEventId) {
  const db = getDb();
  const lastMsg = db
    .query(
      `SELECT created_at FROM messages WHERE id = ? AND (delivered_to = ? OR sender = ?)`,
    )
    .get(lastEventId, address, address);
  if (!lastMsg) return [];

  return db
    .query(
      `SELECT * FROM messages WHERE (delivered_to = ? OR sender = ?) AND created_at > ? ORDER BY created_at ASC`,
    )
    .all(address, address, lastMsg.created_at);
}

function mapMessageRow(row) {
  return {
    ...row,
    expires: row.expires_at,
  };
}

export function streamRoutes() {
  return new Elysia({ prefix: "/api" }).get("/stream", async ({ request }) => {
    const authInfo = await authenticate(request);
    let targetAddress = null;

    if (authInfo) {
      targetAddress = `${authInfo.alias}@${authInfo.domain}`;
    }

    if (!targetAddress) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if address is inbox
    const [alias, domain] = targetAddress.split("@");
    const addrRow = getAddress(domain, alias);
    if (!addrRow || addrRow.mode !== "inbox") {
      return new Response(
        JSON.stringify({ error: "SSE only available for inbox addresses" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const stream = new ReadableStream({
      start(controller) {
        // Send messages since Last-Event-ID if provided
        const lastEventId = request.headers.get("last-event-id");
        if (lastEventId) {
          const history = getMessagesSince(targetAddress, lastEventId);
          for (const msg of history) {
            const mapped = mapMessageRow(msg);
            controller.enqueue(
              `id: ${mapped.id}\nevent: ${mapped.type}\ndata: ${JSON.stringify(mapped)}\n\n`,
            );
          }
        }

        const callback = (event) => {
          const mapped = mapMessageRow(event);
          controller.enqueue(
            `id: ${mapped.id}\nevent: ${mapped.type}\ndata: ${JSON.stringify(mapped)}\n\n`,
          );
        };

        eventBus.subscribe(targetAddress, callback);

        const keepalive = setInterval(() => {
          controller.enqueue(`:keepalive\n\n`);
        }, 30000);

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
  });
}
