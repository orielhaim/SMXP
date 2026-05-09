import { sendMessage } from "../client/send.js";
import { verifyObjectSignature } from "../crypto/verify.js";
import { parseAddress } from "../shared/address.js";
import { getDelegationByDelegate } from "../store/delegations.js";
import { domainExists } from "../store/domains.js";
import { getRemoteDomainKey } from "./verification.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

export async function handleDelegateSend(request) {
  let signedRequest;
  try {
    signedRequest = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }

  try {
    const { server_signature, server_key_id, ...payload } = signedRequest;
    const from = parseAddress(payload.from);
    const delegator = parseAddress(payload.delegator);

    if (!domainExists(from.domain)) {
      return jsonResponse({ error: "delegated sender domain not local" }, 404);
    }

    if (!server_signature || !server_key_id) {
      return jsonResponse({ error: "missing signature" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(payload.timestamp) ||
      Math.abs(now - payload.timestamp) > 300
    ) {
      return jsonResponse(
        { error: "delegation request timestamp is invalid" },
        400,
      );
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
      return jsonResponse(
        { error: "delegation request signature failed" },
        403,
      );
    }

    const delegation = getDelegationByDelegate(
      from.domain,
      from.localPart,
      delegator.address,
    );
    assertValidDelegation(delegation, delegator.address, from.address);

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

    return jsonResponse(
      {
        status: "accepted",
        delegated_from: from.address,
        delegator: delegator.address,
        result,
      },
      201,
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, 403);
  }
}
