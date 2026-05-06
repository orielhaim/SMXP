import { discoverSmxp } from "../dns/discover.js";
import { deliverEnvelope } from "../server/delivery.js";
import { verifyLocalSender } from "../server/verification.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
} from "../shared/envelope.js";
import { getInboxAddressByAddress } from "../store/addresses.js";
import { domainExists } from "../store/domains.js";
import { storeMessage } from "../store/messages.js";
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
}) {
  const sender = parseAddress(from);
  const recipient = parseAddress(to);
  const address = getInboxAddressByAddress(sender.address);

  if (!address) {
    throw new Error(
      `Inbox address "${sender.address}" not found in local store`,
    );
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
    secretKey: address.secret_key,
    keyId: address.key_id,
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
    storeMessage(
      normalizeEnvelopeForStorage(envelope),
      "out",
      1,
      sender.address,
    );

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Delivery failed: ${res.status} ${errBody}`);
  }

  const result = await res.json();

  storeMessage(normalizeEnvelopeForStorage(envelope), "out", 1, sender.address);

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}
