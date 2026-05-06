import { discoverSmxp } from "../dns/discover.js";
import { createEnvelope } from "../shared/envelope.js";
import { getAlias } from "../store/aliases.js";
import { storeMessage } from "../store/messages.js";
import { resolveTarget, buildBaseUrl } from "./resolve.js";
import config from "../config.js";

export async function sendMessage({ from, to, subject, body }) {
  // שליפת alias של השולח
  const aliasPart = from.split("@")[0];
  const alias = getAlias(config.dbPath, aliasPart);

  if (!alias) {
    throw new Error(`Alias "${aliasPart}" not found in local store`);
  }

  // בניית Envelope חתום
  const envelope = createEnvelope({
    from,
    to,
    subject,
    body,
    secretKey: alias.secret_key,
    keyId: alias.key_id,
  });

  // Discovery של הדומיין של המקבל
  const recipientDomain = to.split("@")[1];
  const target = await discoverSmxp(recipientDomain);

  // רזולוציה (dev mode)
  const resolved = resolveTarget(recipientDomain);
  const baseUrl = resolved
    ? buildBaseUrl(resolved.host, resolved.port)
    : buildBaseUrl(target.host, target.port);

  // שליחה
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

  // שמירה מקומית
  storeMessage(config.dbPath, envelope, "out", 1);

  console.log(`[SEND] Message ${envelope.id} delivered successfully`);
  return { envelope, result };
}
