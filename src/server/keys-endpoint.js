import { getAlias } from "../store/aliases.js";
import { getDb } from "../store/db.js";
import { signObject } from "../crypto/sign.js";
import config from "../config.js";

export function handleKeysRequest(aliasName) {
  const alias = getAlias(config.dbPath, aliasName);

  if (!alias) {
    return new Response(JSON.stringify({ error: "alias not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // שליפת מפתח השרת כדי לחתום על התשובה
  const db = getDb(config.dbPath);
  const serverKey = db.query(`SELECT value FROM server_config WHERE key = ?`).get("server_secret_key");
  const serverKeyId = db.query(`SELECT value FROM server_config WHERE key = ?`).get("server_key_id");

  if (!serverKey || !serverKeyId) {
    return new Response(JSON.stringify({ error: "server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    alias: aliasName,
    domain: config.domain,
    public_key: alias.public_key,
    key_id: alias.key_id,
    algorithm: alias.algorithm,
  };

  // חתימת השרת על התשובה
  const serverSignature = signObject(payload, serverKey.value);

  const response = {
    ...payload,
    server_signature: serverSignature,
    server_key_id: serverKeyId.value,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
