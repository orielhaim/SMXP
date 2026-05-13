import { Elysia } from "elysia";
import { coreStore, messagesStore } from "../../store/index.js";
import { withAuth } from "../auth.js";
import { eventBus } from "../eventbus.js";

async function getMessagesSince(address, lastEventId) {
  const result = await messagesStore.query(address, {
    since_id: lastEventId,
    limit: 100,
  });
  return result.messages;
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

        const addrRow = coreStore.addresses.get(
          authInfo.domain,
          authInfo.alias,
        );
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
          async start(controller) {
            // Replay missed messages since last seen event ID
            const lastEventId = request.headers.get("last-event-id");
            if (lastEventId) {
              for (const msg of await getMessagesSince(
                targetAddress,
                lastEventId,
              )) {
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
        detail: {
          tags: ["Stream"],
          summary: "Server-Sent Events stream for real-time message delivery",
        },
      },
    );
}
