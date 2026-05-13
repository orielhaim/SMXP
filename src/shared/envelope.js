import { createHash } from "node:crypto";
import { signMessage } from "../crypto/sign.js";
import { toBase64Url } from "./encoding.js";

export const MESSAGE_TYPES = ["message", "edit", "receipt", "delete"];
export const CONTENT_TYPES = ["text", "markdown", "html", "forward"];
export const DISPOSITIONS = ["attachment", "inline", "embedded"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidTimestamp(v) {
  return Number.isInteger(v) && v >= 0;
}

function validateAttachment(a, idx) {
  if (!a || typeof a !== "object") return `attachments[${idx}]: not an object`;
  if (!isNonEmptyString(a.blob_id))
    return `attachments[${idx}].blob_id required`;
  if (!isNonEmptyString(a.host)) return `attachments[${idx}].host required`;
  if (!isNonEmptyString(a.sha256)) return `attachments[${idx}].sha256 required`;
  if (!Number.isInteger(a.size) || a.size < 0)
    return `attachments[${idx}].size invalid`;
  if (a.disposition && !DISPOSITIONS.includes(a.disposition)) {
    return `attachments[${idx}].disposition invalid`;
  }
  if (a.port !== undefined && (!Number.isInteger(a.port) || a.port <= 0)) {
    return `attachments[${idx}].port invalid`;
  }
  if (a.encryption) {
    const e = a.encryption;
    if (e.algorithm !== "AES-256-GCM")
      return `attachments[${idx}].encryption.algorithm unsupported`;
    if (!isNonEmptyString(e.key))
      return `attachments[${idx}].encryption.key required`;
    if (!isNonEmptyString(e.nonce_prefix))
      return `attachments[${idx}].encryption.nonce_prefix required`;
    if (!Number.isInteger(e.chunk_size) || e.chunk_size <= 0) {
      return `attachments[${idx}].encryption.chunk_size invalid`;
    }
    if (!Number.isInteger(e.plaintext_size) || e.plaintext_size < 0) {
      return `attachments[${idx}].encryption.plaintext_size invalid`;
    }
  }
  return null;
}

function attachmentPreimagePart(a) {
  // Only stable fields — fields that vary per recipient are excluded
  return [
    a.blob_id,
    a.sha256,
    a.size,
    a.disposition ?? "attachment",
    a.encryption?.plaintext_sha256 ?? null,
  ];
}

export function createEnvelope({
  from,
  to,
  name,
  subject,
  body,
  timestamp,
  expires,
  type = "message",
  conversation_id,
  in_reply_to,
  content_type = "text",
  attachments,
  serverSecretKey,
  serverKeyId,
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

  const atts = Array.isArray(attachments) ? attachments : [];
  for (let i = 0; i < atts.length; i++) {
    const err = validateAttachment(atts[i], i);
    if (err) throw new Error(err);
  }

  const envelopeTimestamp = timestamp ?? Math.floor(Date.now() / 1000);
  if (!isValidTimestamp(envelopeTimestamp)) {
    throw new Error("timestamp must be a non-negative integer");
  }
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
    envelopeTimestamp,
    type,
    expires ?? null,
    conversation_id,
    normalizedInReplyTo,
    content_type,
    normalizedSubject ?? "",
    normalizedBody ?? "",
    atts.map(attachmentPreimagePart),
  ]);

  const hash = createHash("sha256").update(preimage).digest();
  const id = toBase64Url(hash);

  const envelope = {
    version: "SMXP/1.0",
    id,
    from,
    to,
    timestamp: envelopeTimestamp,
    type,
    conversation_id,
    content_type,
  };

  if (normalizedName) envelope.name = normalizedName;
  if (normalizedSubject !== null) envelope.subject = normalizedSubject;
  if (normalizedBody !== null) envelope.body = normalizedBody;
  if (normalizedInReplyTo !== null) envelope.in_reply_to = normalizedInReplyTo;
  if (expires !== undefined) envelope.expires = expires;
  if (atts.length > 0) envelope.attachments = atts;

  const signable = JSON.stringify(envelope);
  const signableBytes = new TextEncoder().encode(signable);
  const serverSignature = signMessage(signableBytes, serverSecretKey);

  return {
    ...envelope,
    server_signature: serverSignature,
    server_key_id: serverKeyId,
  };
}

export function getSignableBytes(envelope) {
  const { server_signature, server_key_id, ...signable } = envelope;
  return new TextEncoder().encode(JSON.stringify(signable));
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") return "invalid envelope";

  if (
    !envelope.version ||
    !envelope.id ||
    !envelope.from ||
    !envelope.to ||
    !envelope.server_signature ||
    !envelope.server_key_id ||
    !envelope.conversation_id
  )
    return "missing required fields";

  if (envelope.version !== "SMXP/1.0") return "unsupported version";
  if (envelope.name !== undefined && !isNonEmptyString(envelope.name))
    return "name invalid";
  if (envelope.subject !== undefined && typeof envelope.subject !== "string")
    return "subject invalid";
  if (envelope.body !== undefined && typeof envelope.body !== "string")
    return "body invalid";
  if (envelope.expires !== undefined && !isValidTimestamp(envelope.expires))
    return "expires invalid";
  if (
    envelope.content_type !== undefined &&
    !CONTENT_TYPES.includes(envelope.content_type)
  ) {
    return "unsupported content_type";
  }
  if (
    envelope.in_reply_to !== undefined &&
    !isNonEmptyString(envelope.in_reply_to)
  ) {
    return "in_reply_to invalid";
  }

  const type = envelope.type ?? "message";
  if (!MESSAGE_TYPES.includes(type)) return "unsupported message type";

  if (envelope.attachments !== undefined) {
    if (!Array.isArray(envelope.attachments))
      return "attachments must be an array";
    for (let i = 0; i < envelope.attachments.length; i++) {
      const err = validateAttachment(envelope.attachments[i], i);
      if (err) return err;
    }
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
    attachments: Array.isArray(envelope.attachments)
      ? envelope.attachments
      : [],
  };
}
