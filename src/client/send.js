import config from "../config.js";
import { discoverSmxp } from "../dns/discover.js";
import {
  createEnvelope,
  normalizeEnvelopeForStorage,
} from "../shared/envelope.js";
import { getAlias } from "../store/aliases.js";
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
  const aliasPart = from.split("@")[0];
  const alias = getAlias(config.dbPath, aliasPart);

  if (!alias) {
    throw new Error(`Alias "${aliasPart}" not found in local store`);
  }

  const envelope = createEnvelope({
    from,
    to,
    name,
    subject,
    body,
    expires,
    type,
    references,
    secretKey: alias.secret_key,
    keyId: alias.key_id,
  });

  const recipientDomain = to.split("@")[1];
  const target = await discoverSmxp(recipientDomain);

  const resolved = resolveTarget(recipientDomain);
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

  storeMessage(config.dbPath, normalizeEnvelopeForStorage(envelope), "out", 1);

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}
