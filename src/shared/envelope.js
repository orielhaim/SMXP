import { createHash } from "crypto";
import { signMessage } from "../crypto/sign.js";
import { toBase64Url } from "./encoding.js";

export function createEnvelope({ from, to, subject, body, secretKey, keyId }) {
  const timestamp = Math.floor(Date.now() / 1000);

  // ה-ID נוצר מתוכן ההודעה (כמו ב-Nostr)
  const preimage = JSON.stringify([from, to, timestamp, subject, body]);
  const hash = createHash("sha256").update(preimage).digest();
  const id = toBase64Url(hash);

  const envelope = {
    version: "SMXP/1.0",
    id,
    from,
    to,
    timestamp,
    subject: subject || "",
    content_type: "text/plain",
    body,
  };

  // חתימה על כל השדות (ללא ה-signature עצמו)
  const signable = JSON.stringify(envelope);
  const signableBytes = new TextEncoder().encode(signable);
  const signature = signMessage(signableBytes, secretKey);

  return {
    ...envelope,
    signature,
    key_id: keyId,
  };
}

export function getSignableBytes(envelope) {
  // שחזור האובייקט ללא signature ו-key_id
  const { signature, key_id, ...signable } = envelope;
  const json = JSON.stringify(signable);
  return new TextEncoder().encode(json);
}
