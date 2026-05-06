import { parseAddress } from "../shared/address.js";
import {
  normalizeEnvelopeForStorage,
  validateEnvelope,
} from "../shared/envelope.js";
import { resolveDeliveryAlias } from "../store/aliases.js";
import { domainExists } from "../store/domains.js";
import { messageExists, storeMessage } from "../store/messages.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function deliverEnvelope(envelope, verifySender) {
  const receivedAt = Math.floor(Date.now() / 1000);
  const validationError = validateEnvelope(envelope);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  let to;
  let from;
  try {
    to = parseAddress(envelope.to);
    from = parseAddress(envelope.from);
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }

  if (!domainExists(to.domain)) {
    return jsonResponse({ error: "recipient domain not on this server" }, 404);
  }

  let deliveries;
  try {
    deliveries = resolveDeliveryAlias(to.address);
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }

  if (!deliveries || deliveries.length === 0) {
    return jsonResponse({ error: "recipient alias not found" }, 404);
  }

  if (messageExists(envelope.id)) {
    return jsonResponse({ error: "duplicate message" }, 409);
  }

  if (typeof envelope.expires === "number" && receivedAt > envelope.expires) {
    return jsonResponse({ error: "message expired" }, 410);
  }

  try {
    await verifySender(envelope, from);

    const deliveredTo = [];
    for (const delivery of deliveries) {
      storeMessage(
        normalizeEnvelopeForStorage(envelope),
        "in",
        1,
        delivery.deliveredTo,
      );
      deliveredTo.push(delivery.deliveredTo);
    }

    return jsonResponse(
      {
        status: "accepted",
        id: envelope.id,
        original_to: deliveries[0].originalAddress,
        delivered_to: deliveredTo,
      },
      201,
    );
  } catch (err) {
    return jsonResponse({ error: `verification error: ${err.message}` }, 403);
  }
}
