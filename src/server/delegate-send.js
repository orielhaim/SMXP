import { sendMessage } from "../client/send.js";
import { verifyObjectSignature } from "../crypto/verify.js";
import { parseAddress } from "../shared/address.js";
import { coreStore } from "../store/index.js";
import { getRemoteDomainKey } from "./verification.js";

export class DelegateSendError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertValidDelegation(delegation, delegator, from) {
  if (!delegation) {
    throw new Error(`No delegation found for ${delegator} on ${from}`);
  }

  if (delegation.scope !== "send") {
    throw new Error(
      `Delegation found but scope is ${delegation.scope}, requires send`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (delegation.expires_at !== null && delegation.expires_at < now) {
    throw new Error("Delegation is expired");
  }
}

export async function processDelegateSend(signedRequest) {
  const { server_signature, server_key_id, ...payload } = signedRequest;
  let from;
  let delegator;
  try {
    from = parseAddress(payload.from);
    delegator = parseAddress(payload.delegator);
  } catch (err) {
    throw new DelegateSendError(400, err.message);
  }

  if (!coreStore.domains.exists(from.domain)) {
    throw new DelegateSendError(404, "delegated sender domain not local");
  }

  if (!server_signature || !server_key_id) {
    throw new DelegateSendError(400, "missing signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isInteger(payload.timestamp) ||
    Math.abs(now - payload.timestamp) > 300
  ) {
    throw new DelegateSendError(400, "delegation request timestamp is invalid");
  }

  const delegatorKey = await getRemoteDomainKey(
    delegator.domain,
    server_key_id,
  );
  const signatureValid = verifyObjectSignature(
    payload,
    server_signature,
    delegatorKey.public_key,
  );

  if (!signatureValid) {
    throw new DelegateSendError(403, "delegation request signature failed");
  }

  const delegation = coreStore.delegations.forDelegate(
    from.domain,
    from.localPart,
    delegator.address,
  );

  try {
    assertValidDelegation(delegation, delegator.address, from.address);
  } catch (err) {
    throw new DelegateSendError(403, err.message);
  }

  const result = await sendMessage({
    from: from.address,
    to: payload.to,
    name: payload.name,
    subject: payload.subject,
    body: payload.body,
    expires: payload.expires,
    type: payload.type,
    conversation_id: payload.conversation_id,
    in_reply_to: payload.in_reply_to,
    content_type: payload.content_type,
  });

  return {
    status: "accepted",
    delegated_from: from.address,
    delegator: delegator.address,
    result,
  };
}
