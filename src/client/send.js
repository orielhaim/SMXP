import { signObject } from "../crypto/sign.js";
import { resolveEndpoint } from "../dns/resolve-endpoint.js";
import { DeliveryError, routeAndDeliver } from "../server/delivery.js";
import { eventBus } from "../server/eventbus.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
} from "../shared/envelope.js";
import { smxpFetch } from "../shared/fetch.js";
import { coreStore, messagesStore } from "../store/index.js";

export async function sendMessage({
  from,
  to,
  name,
  subject,
  body,
  timestamp,
  expires,
  type,
  conversation_id,
  in_reply_to,
  content_type,
  delegator,
}) {
  const sender = parseAddress(from);
  const recipient = parseAddress(to);
  const delegateAddress = delegator ? parseAddress(delegator) : sender;
  const senderIsLocal = coreStore.domains.exists(sender.domain);
  const address = coreStore.addresses.getByAddress(
    senderIsLocal ? sender.address : delegateAddress.address,
  );

  if (!address) {
    throw new Error(
      `Inbox address "${senderIsLocal ? sender.address : delegateAddress.address}" not found in local store`,
    );
  }

  if (senderIsLocal && delegateAddress.address !== sender.address) {
    throw new Error("local senders must authenticate as the sender address");
  }

  if (!senderIsLocal) {
    return await sendDelegationRequest({
      from: sender.address,
      to: recipient.address,
      name,
      subject,
      body,
      expires,
      type,
      conversation_id,
      in_reply_to,
      content_type,
      delegator: delegateAddress.address,
    });
  }

  const domainKeys = coreStore.domains.keys(sender.domain);
  if (!domainKeys) {
    throw new Error(`Domain "${sender.domain}" is not configured`);
  }

  const envelope = createEnvelope({
    from: sender.address,
    to: recipient.address,
    name,
    subject,
    body,
    timestamp,
    expires,
    type,
    conversation_id,
    in_reply_to,
    content_type,
    serverSecretKey: domainKeys.secret_key,
    serverKeyId: domainKeys.key_id,
  });

  if (coreStore.domains.exists(recipient.domain)) {
    console.log(`[SEND] Local delivery to ${recipient.address}`);
    let result;
    try {
      result = await routeAndDeliver(envelope);
    } catch (err) {
      if (err instanceof DeliveryError) {
        throw new Error(`Local delivery failed: ${err.status} ${err.message}`);
      }
      throw err;
    }
    const msgForStorage = normalizeEnvelopeForStorage(envelope);
    await messagesStore.store(msgForStorage, "out", sender.address);
    eventBus.publish(sender.address, msgForStorage);

    console.log(`[SEND] Message ${envelope.id} delivered locally`);
    return { envelope, result };
  }

  const endpoint = await resolveEndpoint(recipient.domain);
  const url = `${endpoint.baseUrl}/.smxp/receive`;
  console.log(`[SEND] Delivering to ${url}`);

  const result = await smxpFetch.post(url, { json: envelope }).json();

  const msgForStorage = normalizeEnvelopeForStorage(envelope);
  await messagesStore.store(msgForStorage, "out", sender.address);
  eventBus.publish(sender.address, msgForStorage);

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}

async function sendDelegationRequest(payload) {
  const delegator = parseAddress(payload.delegator);
  const domainKeys = coreStore.domains.keys(delegator.domain);

  if (!domainKeys) {
    throw new Error(`Domain "${delegator.domain}" is not configured`);
  }

  const requestPayload = {
    ...payload,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const signedRequest = {
    ...requestPayload,
    server_signature: signObject(requestPayload, domainKeys.secret_key),
    server_key_id: domainKeys.key_id,
  };
  const endpoint = await resolveEndpoint(parseAddress(payload.from).domain);
  const url = `${endpoint.baseUrl}/.smxp/delegate-send`;
  console.log(`[SEND] Requesting delegated send via ${url}`);

  const result = await smxpFetch.post(url, { json: signedRequest }).json();
  console.log(`[SEND] Delegated message accepted for ${payload.from}`);
  return result;
}
