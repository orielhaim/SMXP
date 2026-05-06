import { signObject } from "../crypto/sign.js";
import { getAddress } from "../store/addresses.js";
import { getDelegationByDelegate } from "../store/delegations.js";

export function handleDelegationsRequest(request, domainName) {
  const url = new URL(request.url);
  const aliasName = url.searchParams.get("alias");
  const delegateName = url.searchParams.get("delegate");

  if (!aliasName || !delegateName) {
    return new Response(
      JSON.stringify({ error: "alias and delegate parameters are required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const domain = domainName.trim().toLowerCase();
  const aliasPart = aliasName.trim().toLowerCase();
  const address = getAddress(domain, aliasPart);

  if (!address || address.mode !== "inbox") {
    return new Response(JSON.stringify({ error: "inbox address not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const delegation = getDelegationByDelegate(domain, aliasPart, delegateName);

  if (!delegation) {
    return new Response(JSON.stringify({ error: "delegation not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (delegation.expires_at !== null && delegation.expires_at < now) {
    return new Response(JSON.stringify({ error: "delegation expired" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    alias: aliasPart,
    domain,
    delegate: delegation.delegate,
    scope: delegation.scope,
    created_at: delegation.created_at,
    expires_at: delegation.expires_at,
  };

  const response = {
    ...payload,
    signature: signObject(payload, address.secret_key),
    key_id: address.key_id,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
