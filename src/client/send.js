import config from "../config.js";
import { discoverSmxp } from "../dns/discover.js";
import { deliverEnvelope } from "../server/delivery.js";
import { verifyLocalSender } from "../server/verification.js";
import { parseAddress } from "../shared/address.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
} from "../shared/envelope.js";
import { getInboxAliasByAddress } from "../store/aliases.js";
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
  references,
}) {
  const sender = parseAddress(from);
  const recipient = parseAddress(to);
  const alias = getInboxAliasByAddress(config.dbPath, sender.address);

  if (!alias) {
    throw new Error(`Inbox alias "${sender.address}" not found in local store`);
  }

  const envelope = createEnvelope({
    from: sender.address,
    to: recipient.address,
    name,
    subject,
    body,
    expires,
    type,
    references,
    secretKey: alias.secret_key,
    keyId: alias.key_id,
  });

  if (domainExists(config.dbPath, recipient.domain)) {
    console.log(`[SEND] Local delivery to ${recipient.address}`);
    const response = await deliverEnvelope(config.dbPath, envelope, (message) =>
      verifyLocalSender(config.dbPath, message, alias),
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Local delivery failed: ${response.status} ${errBody}`);
    }

    const result = await response.json();
    storeMessage(
      config.dbPath,
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

  storeMessage(
    config.dbPath,
    normalizeEnvelopeForStorage(envelope),
    "out",
    1,
    sender.address,
  );

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}
