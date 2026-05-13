import { resolveEndpoint } from "../dns/resolve-endpoint.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
  validateEnvelope,
} from "../shared/envelope.js";
import { smxpFetch } from "../shared/fetch.js";
import { coreStore, messagesStore } from "../store/index.js";
import { eventBus } from "./eventbus.js";

export class DeliveryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function flattenForward(envelope) {
  if (envelope.content_type !== "forward") {
    return envelope;
  }

  try {
    return JSON.parse(envelope.body);
  } catch {
    return envelope;
  }
}

export async function storeIncoming(envelope, deliveredTo) {
  let toStore = normalizeEnvelopeForStorage(envelope);

  if (toStore.content_type === "forward" && toStore.body) {
    try {
      const inner = JSON.parse(toStore.body);
      if (Array.isArray(inner.attachments) && inner.attachments.length > 0) {
        toStore = { ...toStore, attachments: inner.attachments };
      }
    } catch {
      // ignore parse errors – fall back to storing the envelope as-is
    }
  }

  await messagesStore.store(toStore, "in", deliveredTo);
  eventBus.publish(deliveredTo, toStore);
}

async function sendExternalForward(sourceAddress, targetAddress, envelope) {
  const source = parseAddress(sourceAddress);
  const target = parseAddress(targetAddress);
  const domainKeys = coreStore.domains.keys(source.domain);

  if (!domainKeys) {
    throw new Error(`Domain "${source.domain}" is not configured`);
  }

  const forwardedEnvelope = createEnvelope({
    from: source.address,
    to: target.address,
    subject: envelope.subject ?? null,
    body: JSON.stringify(flattenForward(envelope)),
    type: "message",
    conversation_id: envelope.conversation_id,
    content_type: "forward",
    serverSecretKey: domainKeys.secret_key,
    serverKeyId: domainKeys.key_id,
  });

  const endpoint = await resolveEndpoint(target.domain);
  const url = `${endpoint.baseUrl}/.smxp/receive`;
  await smxpFetch.post(url, { json: forwardedEnvelope }).json();

  return target.address;
}

async function deliverRouteTarget(envelope, sourceAddress, targetAddress) {
  const target = parseAddress(targetAddress);

  if (coreStore.domains.exists(target.domain)) {
    const targetInbox = coreStore.addresses.getByAddress(target.address);
    if (!targetInbox) {
      throw new Error(`route target "${target.address}" is not an inbox`);
    }

    await storeIncoming(envelope, target.address);
    return { local: target.address };
  }

  return {
    external: await sendExternalForward(
      sourceAddress,
      target.address,
      envelope,
    ),
  };
}

export async function prepareDelivery(envelope) {
  const receivedAt = Math.floor(Date.now() / 1000);
  const validationError = validateEnvelope(envelope);
  if (validationError) {
    throw new DeliveryError(400, validationError);
  }

  let to;
  let from;
  try {
    to = parseAddress(envelope.to);
    from = parseAddress(envelope.from);
  } catch (err) {
    throw new DeliveryError(400, err.message);
  }

  if (!coreStore.domains.exists(to.domain)) {
    throw new DeliveryError(404, "recipient domain not on this server");
  }

  if (await messagesStore.exists(envelope.id)) {
    throw new DeliveryError(409, "duplicate message");
  }

  if (typeof envelope.expires === "number" && receivedAt > envelope.expires) {
    throw new DeliveryError(410, "message expired");
  }

  return { to, from };
}

export async function routeAndDeliver(envelope, prepared = null) {
  const { to } = prepared ?? (await prepareDelivery(envelope));
  const deliveredTo = [];
  const forwardedTo = [];
  const inbox = coreStore.addresses.getByAddress(to.address);
  const routes = coreStore.routes.match(to.domain, to.localPart);

  if (inbox) {
    await storeIncoming(envelope, to.address);
    deliveredTo.push(to.address);

    for (const route of routes) {
      const target = parseAddress(route.target_address);
      if (!coreStore.domains.exists(target.domain)) {
        forwardedTo.push(
          await sendExternalForward(to.address, target.address, envelope),
        );
      }
    }
  } else {
    if (routes.length === 0) {
      throw new DeliveryError(404, "recipient address not found");
    }

    for (const route of routes) {
      const result = await deliverRouteTarget(
        envelope,
        to.address,
        route.target_address,
      );
      if (result.local) deliveredTo.push(result.local);
      if (result.external) forwardedTo.push(result.external);
    }
  }

  return {
    status: "accepted",
    id: envelope.id,
    original_to: to.address,
    delivered_to: deliveredTo,
    forwarded_to: forwardedTo,
  };
}
