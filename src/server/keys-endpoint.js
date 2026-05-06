import { signObject } from "../crypto/sign.js";
import { getAlias } from "../store/aliases.js";
import { getDb } from "../store/db.js";

export function handleKeysRequest(domainName, aliasName) {
  const domain = domainName.trim().toLowerCase();
  const aliasPart = aliasName.trim().toLowerCase();
  const alias = getAlias(domain, aliasPart);

  if (!alias || alias.mode !== "inbox") {
    return new Response(JSON.stringify({ error: "inbox alias not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = getDb();
  const serverKey = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_secret_key");
  const serverKeyId = db
    .query(`SELECT value FROM server_config WHERE key = ?`)
    .get("server_key_id");

  if (!serverKey || !serverKeyId) {
    return new Response(JSON.stringify({ error: "server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    alias: aliasPart,
    domain,
    public_key: alias.public_key,
    key_id: alias.key_id,
    algorithm: alias.algorithm,
  };

  const response = {
    ...payload,
    server_signature: signObject(payload, serverKey.value),
    server_key_id: serverKeyId.value,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
