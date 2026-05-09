import { signObject } from "../crypto/sign.js";
import { discoverSmxp } from "../dns/discover.js";
import { deliverEnvelope } from "../server/delivery.js";
import { eventBus } from "../server/eventbus.js";
import { verifyLocalSender } from "../server/verification.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
} from "../shared/envelope.js";
import { smxpFetch } from "../shared/fetch.js";
import { getInboxAddressByAddress } from "../store/addresses.js";
import { domainExists, getDomainKeys } from "../store/domains.js";
import { storeMessage } from "../store/messages-provider.js";
import { buildBaseUrl, resolveTarget } from "./resolve.js";

export async function sendMessage({
  from,
  to,
  name,
  subject,
  body,
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
  const senderIsLocal = domainExists(sender.domain);
  const address = getInboxAddressByAddress(
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

  const domainKeys = getDomainKeys(sender.domain);
  if (!domainKeys) {
    throw new Error(`Domain "${sender.domain}" is not configured`);
  }

  const envelope = createEnvelope({
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
    serverSecretKey: domainKeys.secret_key,
    serverKeyId: domainKeys.key_id,
  });

  if (domainExists(recipient.domain)) {
    console.log(`[SEND] Local delivery to ${recipient.address}`);
    const response = await deliverEnvelope(envelope, (message) =>
      verifyLocalSender(message, address),
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Local delivery failed: ${response.status} ${errBody}`);
    }

    const result = await response.json();
    const msgForStorage = normalizeEnvelopeForStorage(envelope);
    await storeMessage(msgForStorage, "out", sender.address);
    eventBus.publish(sender.address, msgForStorage);

    console.log(`[SEND] Message ${envelope.id} delivered locally`);
    return { envelope, result };
  }

  const target = await discoverSmxp(recipient.domain);

  const resolved = resolveTarget(recipient.domain);
  const baseUrl = resolved
    ? buildBaseUrl(resolved.host, resolved.port)
    : buildBaseUrl(target.host, target.port);

  const url = `${baseUrl}/.smxp/receive`;
  console.log(`[SEND] Delivering to ${url}`);

  const result = await smxpFetch.post(url, { json: envelope }).json();

  const msgForStorage = normalizeEnvelopeForStorage(envelope);
  await storeMessage(msgForStorage, "out", sender.address);
  eventBus.publish(sender.address, msgForStorage);

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}

async function sendDelegationRequest(payload) {
  const delegator = parseAddress(payload.delegator);
  const domainKeys = getDomainKeys(delegator.domain);

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
  const target = await discoverSmxp(parseAddress(payload.from).domain);
  const resolved = resolveTarget(parseAddress(payload.from).domain);
  const baseUrl = resolved
    ? buildBaseUrl(resolved.host, resolved.port)
    : buildBaseUrl(target.host, target.port);

  const url = `${baseUrl}/.smxp/delegate-send`;
  console.log(`[SEND] Requesting delegated send via ${url}`);

  const result = await smxpFetch.post(url, { json: signedRequest }).json();
  console.log(`[SEND] Delegated message accepted for ${payload.from}`);
  return result;
}
