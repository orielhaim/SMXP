import { discoverSmxp } from "../dns/discover.js";
import { resolveTarget, buildBaseUrl } from "../client/resolve.js";
import { verifySignature, verifyObjectSignature } from "../crypto/verify.js";
import { fingerprintPublicKey } from "../crypto/keys.js";
import { getSignableBytes } from "../shared/envelope.js";
import { getAlias } from "../store/aliases.js";
import { storeMessage, messageExists } from "../store/messages.js";
import { dohQuery } from "../dns/doh.js";
import config from "../config.js";

async function fetchServerPublicKey(domain) {
  const resolved = resolveTarget(domain);

  // שליפת המפתח מה-endpoint
  let serverKeyInfo;
  if (resolved) {
    const url = `${buildBaseUrl(resolved.host, resolved.port)}/.smxp/server-key`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch server key from ${domain}`);
    serverKeyInfo = await res.json();
  } else {
    // production — שליפה מהשרת המרוחק (אחרי discovery)
    const target = await discoverSmxp(domain);
    const url = `${buildBaseUrl(target.host, target.port)}/.smxp/server-key`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch server key from ${domain}`);
    serverKeyInfo = await res.json();
  }

  // אימות fingerprint מול DNS
  if (!resolved) {
    // ב-production: שולפים fingerprint מ-DNS ומאמתים
    const dnsFingerprint = await fetchDnsFingerprint(domain);
    const actualFingerprint = fingerprintPublicKey(serverKeyInfo.public_key);

    if (dnsFingerprint !== actualFingerprint) {
      throw new Error(
        `Server key fingerprint mismatch! DNS: ${dnsFingerprint}, actual: ${actualFingerprint}`,
      );
    }
    console.log(`[VERIFY] DNS fingerprint matches server key`);
  }

  return serverKeyInfo;
}

async function fetchDnsFingerprint(domain) {
  const name = `_smxpkey.${domain}`;
  const response = await dohQuery(name, "TXT");

  if (
    response.Status !== 0 ||
    !response.Answer ||
    response.Answer.length === 0
  ) {
    throw new Error(`No SMXP key record for ${domain}`);
  }

  const txt = response.Answer[0].data.replace(/"/g, "");
  const parts = txt.split(";").map((s) => s.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key.trim() === "fp") {
      const val = rest.join("=").trim();
      // פורמט: sha256:base64url
      if (val.startsWith("sha256:")) {
        return val.slice(7);
      }
    }
  }

  throw new Error(`No fingerprint found in DNS for ${domain}`);
}

async function fetchAliasPublicKey(domain, alias) {
  const resolved = resolveTarget(domain);
  const target = resolved || (await discoverSmxp(domain));

  const baseUrl = resolved
    ? buildBaseUrl(resolved.host, resolved.port)
    : buildBaseUrl(target.host, target.port);

  const url = `${baseUrl}/.well-known/smxp/keys/${alias}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch alias key: ${res.status}`);
  }

  return await res.json();
}

export async function handleReceive(req) {
  let envelope;
  try {
    envelope = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ולידציה בסיסית
  if (
    !envelope.version ||
    !envelope.id ||
    !envelope.from ||
    !envelope.to ||
    !envelope.signature ||
    !envelope.key_id
  ) {
    return new Response(JSON.stringify({ error: "missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (envelope.version !== "SMXP/1.0") {
    return new Response(JSON.stringify({ error: "unsupported version" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // בדיקה שה-to שייך לנו
  const toAlias = envelope.to.split("@")[0];
  const toDomain = envelope.to.split("@")[1];

  if (toDomain !== config.domain) {
    return new Response(
      JSON.stringify({ error: "recipient not on this server" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const localAlias = getAlias(config.dbPath, toAlias);
  if (!localAlias) {
    return new Response(
      JSON.stringify({ error: "recipient alias not found" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Replay protection — בדיקת ID
  if (messageExists(config.dbPath, envelope.id)) {
    return new Response(JSON.stringify({ error: "duplicate message" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  // === אימות שכבה 1+2+3 ===
  const senderDomain = envelope.from.split("@")[1];
  const senderAlias = envelope.from.split("@")[0];

  try {
    // שכבה 1: שליפת מפתח השרת מ-DNS (או dev endpoint)
    const serverKeyInfo = await fetchServerPublicKey(senderDomain);
    console.log(
      `[VERIFY] Got server key for ${senderDomain}: kid=${serverKeyInfo.key_id}`,
    );

    // שכבה 2: שליפת מפתח ה-alias מהשרת השולח + אימות חתימת השרת
    const aliasKeyResponse = await fetchAliasPublicKey(
      senderDomain,
      senderAlias,
    );
    console.log(
      `[VERIFY] Got alias key for ${senderAlias}@${senderDomain}: kid=${aliasKeyResponse.key_id}`,
    );

    // אימות שחתימת השרת על תשובת המפתח תקינה
    const { server_signature, server_key_id, ...aliasPayload } =
      aliasKeyResponse;
    const serverSigValid = verifyObjectSignature(
      aliasPayload,
      server_signature,
      serverKeyInfo.public_key,
    );

    if (!serverSigValid) {
      console.log(`[VERIFY] Server signature invalid for alias key response`);
      return new Response(
        JSON.stringify({ error: "server signature verification failed" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    console.log(`[VERIFY] Server signature valid`);

    // שכבה 3: אימות חתימת ההודעה עם מפתח ה-alias
    const signableBytes = getSignableBytes(envelope);
    const msgSigValid = verifySignature(
      signableBytes,
      envelope.signature,
      aliasKeyResponse.public_key,
    );

    if (!msgSigValid) {
      console.log(`[VERIFY] Message signature invalid`);
      return new Response(
        JSON.stringify({ error: "message signature verification failed" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    console.log(`[VERIFY] Message signature valid! Storing message.`);

    // שמירה
    storeMessage(config.dbPath, envelope, "in", 1);

    return new Response(
      JSON.stringify({ status: "accepted", id: envelope.id }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error(`[VERIFY] Error during verification:`, err.message);
    return new Response(
      JSON.stringify({ error: `verification error: ${err.message}` }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
