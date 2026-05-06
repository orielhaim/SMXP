import { createHash } from "node:crypto";
import { signMessage } from "../crypto/sign.js";
import { toBase64Url } from "./encoding.js";

export const MESSAGE_TYPES = ["message", "edit", "receipt", "delete"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTimestamp(value) {
  return Number.isInteger(value) && value >= 0;
}

export function createEnvelope({
  from,
  to,
  name,
  subject,
  body,
  expires,
  type = "message",
  conversation_id,
  in_reply_to,
  content_type = "text",
  secretKey,
  keyId,
}) {
  if (!MESSAGE_TYPES.includes(type)) {
    throw new Error(`unsupported envelope type "${type}"`);
  }

  if (expires !== undefined && !isValidTimestamp(expires)) {
    throw new Error("expires must be a non-negative integer timestamp");
  }

  if (!isNonEmptyString(conversation_id)) {
    throw new Error(
      "conversation_id is required and must be a non-empty string",
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const normalizedName = isNonEmptyString(name) ? name.trim() : undefined;
  const normalizedSubject = subject || null;
  const normalizedBody = body || null;
  const normalizedInReplyTo = isNonEmptyString(in_reply_to)
    ? in_reply_to.trim()
    : null;

  const preimage = JSON.stringify([
    from,
    to,
    normalizedName || "",
    timestamp,
    type,
    expires ?? null,
    conversation_id,
    normalizedInReplyTo,
    content_type,
    normalizedSubject ?? "",
    normalizedBody ?? "",
  ]);
  const hash = createHash("sha256").update(preimage).digest();
  const id = toBase64Url(hash);

  const envelope = {
    version: "SMXP/1.0",
    id,
    from,
    to,
    timestamp,
    type,
    conversation_id,
    content_type,
  };

  if (normalizedName) envelope.name = normalizedName;
  if (normalizedSubject !== null) envelope.subject = normalizedSubject;
  if (normalizedBody !== null) envelope.body = normalizedBody;
  if (normalizedInReplyTo !== null) envelope.in_reply_to = normalizedInReplyTo;
  if (expires !== undefined) envelope.expires = expires;

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
  const { signature, key_id, ...signable } = envelope;
  const json = JSON.stringify(signable);
  return new TextEncoder().encode(json);
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return "invalid envelope";
  }

  if (
    !envelope.version ||
    !envelope.id ||
    !envelope.from ||
    !envelope.to ||
    !envelope.signature ||
    !envelope.key_id ||
    !envelope.conversation_id
  ) {
    return "missing required fields";
  }

  if (envelope.version !== "SMXP/1.0") {
    return "unsupported version";
  }

  if (envelope.name !== undefined && !isNonEmptyString(envelope.name)) {
    return "name must be a non-empty string";
  }

  if (envelope.subject !== undefined && typeof envelope.subject !== "string") {
    return "subject must be a string";
  }

  if (envelope.body !== undefined && typeof envelope.body !== "string") {
    return "body must be a string";
  }

  if (envelope.expires !== undefined && !isValidTimestamp(envelope.expires)) {
    return "expires must be a non-negative integer timestamp";
  }

  if (
    envelope.content_type !== undefined &&
    typeof envelope.content_type !== "string"
  ) {
    return "content_type must be a string";
  }

  if (
    envelope.in_reply_to !== undefined &&
    !isNonEmptyString(envelope.in_reply_to)
  ) {
    return "in_reply_to must be a non-empty string";
  }

  const type = envelope.type ?? "message";
  if (!MESSAGE_TYPES.includes(type)) {
    return "unsupported message type";
  }

  return null;
}

export function normalizeEnvelopeForStorage(envelope) {
  return {
    ...envelope,
    type: envelope.type ?? "message",
    sender: envelope.from,
    recipient: envelope.to,
    content_type: envelope.content_type ?? "text",
    name: typeof envelope.name === "string" ? envelope.name : null,
    subject: typeof envelope.subject === "string" ? envelope.subject : null,
    body: typeof envelope.body === "string" ? envelope.body : null,
    in_reply_to:
      typeof envelope.in_reply_to === "string" ? envelope.in_reply_to : null,
    expires: Number.isInteger(envelope.expires) ? envelope.expires : null,
  };
}
