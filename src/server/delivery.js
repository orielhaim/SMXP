import { buildBaseUrl, resolveTarget } from "../client/resolve.js";
import { discoverSmxp } from "../dns/discover.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
  validateEnvelope,
} from "../shared/envelope.js";
import { smxpFetch } from "../shared/fetch.js";
import { getInboxAddressByAddress } from "../store/addresses.js";
import { domainExists, getDomainKeys } from "../store/domains.js";
import { messageExists, storeMessage } from "../store/messages-provider.js";
import { matchRoutes } from "../store/routes.js";
import { eventBus } from "./eventbus.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

async function storeInboxDelivery(envelope, deliveredTo) {
  const msgForStorage = normalizeEnvelopeForStorage(envelope);
  await storeMessage(msgForStorage, "in", deliveredTo);
  eventBus.publish(deliveredTo, msgForStorage);
}

async function sendExternalForward(sourceAddress, targetAddress, envelope) {
  const source = parseAddress(sourceAddress);
  const target = parseAddress(targetAddress);
  const domainKeys = getDomainKeys(source.domain);

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

  const resolved = resolveTarget(target.domain);
  const targetServer = resolved || (await discoverSmxp(target.domain));
  const baseUrl = buildBaseUrl(targetServer.host, targetServer.port);
  const url = `${baseUrl}/.smxp/receive`;
  await smxpFetch.post(url, { json: forwardedEnvelope }).json();

  return target.address;
}

async function deliverRouteTarget(envelope, sourceAddress, targetAddress) {
  const target = parseAddress(targetAddress);

  if (domainExists(target.domain)) {
    const targetInbox = getInboxAddressByAddress(target.address);
    if (!targetInbox) {
      throw new Error(`route target "${target.address}" is not an inbox`);
    }

    await storeInboxDelivery(envelope, target.address);
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

  if (await messageExists(envelope.id)) {
    return jsonResponse({ error: "duplicate message" }, 409);
  }

  if (typeof envelope.expires === "number" && receivedAt > envelope.expires) {
    return jsonResponse({ error: "message expired" }, 410);
  }

  try {
    await verifySender(envelope, from);

    const deliveredTo = [];
    const forwardedTo = [];
    const inbox = getInboxAddressByAddress(to.address);
    const routes = matchRoutes(to.domain, to.localPart);

    if (inbox) {
      await storeInboxDelivery(envelope, to.address);
      deliveredTo.push(to.address);

      for (const route of routes) {
        const target = parseAddress(route.target_address);
        if (!domainExists(target.domain)) {
          forwardedTo.push(
            await sendExternalForward(to.address, target.address, envelope),
          );
        }
      }
    } else {
      if (routes.length === 0) {
        return jsonResponse({ error: "recipient address not found" }, 404);
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

    return jsonResponse(
      {
        status: "accepted",
        id: envelope.id,
        original_to: to.address,
        delivered_to: deliveredTo,
        forwarded_to: forwardedTo,
      },
      201,
    );
  } catch (err) {
    return jsonResponse({ error: `verification error: ${err.message}` }, 403);
  }
}
