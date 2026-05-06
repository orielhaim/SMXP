import { createHash } from "node:crypto";
import { signMessage } from "../crypto/sign.js";
import { toBase64Url } from "./encoding.js";

export const MESSAGE_TYPES = ["message", "edit", "receipt"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeReferences(type, references) {
  if (references == null) {
    if (type === "edit") {
      throw new Error(`type "${type}" requires a reference id`);
    }
    if (type === "receipt") {
      throw new Error(`type "${type}" requires at least one reference id`);
    }
    return undefined;
  }

  if (type === "receipt") {
    if (!Array.isArray(references) || references.length === 0) {
      throw new Error(
        `type "${type}" requires references to be a non-empty array`,
      );
    }

    for (const reference of references) {
      if (!isNonEmptyString(reference)) {
        throw new Error(
          `type "${type}" requires every reference id to be a non-empty string`,
        );
      }
    }

    return references;
  }

  if (!isNonEmptyString(references)) {
    throw new Error(
      `type "${type}" requires references to be a non-empty string`,
    );
  }

  return references;
}

export function createEnvelope({
  from,
  to,
  name,
  subject,
  body,
  type = "message",
  references,
  secretKey,
  keyId,
}) {
  if (!MESSAGE_TYPES.includes(type)) {
    throw new Error(`unsupported envelope type "${type}"`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const normalizedName = isNonEmptyString(name) ? name.trim() : undefined;
  const normalizedSubject = subject || "";
  const normalizedBody = body || "";
  const normalizedReferences = normalizeReferences(type, references);

  const preimage = JSON.stringify([
    from,
    to,
    normalizedName || "",
    timestamp,
    type,
    normalizedReferences ?? null,
    normalizedSubject,
    normalizedBody,
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
    subject: normalizedSubject,
    content_type: "text/plain",
    body: normalizedBody,
  };

  if (normalizedName) {
    envelope.name = normalizedName;
  }

  if (normalizedReferences !== undefined) {
    envelope.references = normalizedReferences;
  }

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
    !envelope.key_id
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

  if (
    envelope.content_type !== undefined &&
    typeof envelope.content_type !== "string"
  ) {
    return "content_type must be a string";
  }

  const type = envelope.type ?? "message";
  if (!MESSAGE_TYPES.includes(type)) {
    return "unsupported message type";
  }

  try {
    normalizeReferences(type, envelope.references);
  } catch (err) {
    return err.message;
  }

  return null;
}

export function normalizeEnvelopeForStorage(envelope) {
  return {
    ...envelope,
    type: envelope.type ?? "message",
    name: typeof envelope.name === "string" ? envelope.name : null,
    subject: typeof envelope.subject === "string" ? envelope.subject : "",
    body: typeof envelope.body === "string" ? envelope.body : "",
    references: envelope.references === undefined ? null : envelope.references,
  };
}
