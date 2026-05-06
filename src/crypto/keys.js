import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "@noble/post-quantum/utils.js";
import { createHash } from "crypto";
import { toBase64Url } from "../shared/encoding.js";

export function generateKeyPair(seed) {
  const s = seed || randomBytes(32);
  const keys = ml_dsa65.keygen(s);
  return {
    publicKey: keys.publicKey,
    secretKey: keys.secretKey,
    keyId: toBase64Url(randomBytes(16)),
    algorithm: "ML-DSA-65",
  };
}

export function fingerprintPublicKey(publicKey) {
  // publicKey יכול להיות Uint8Array או base64url string
  const bytes =
    typeof publicKey === "string"
      ? Buffer.from(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64")
      : publicKey;
  const hash = createHash("sha256").update(bytes).digest();
  return toBase64Url(new Uint8Array(hash));
}

export function serializePublicKey(publicKey) {
  return toBase64Url(publicKey);
}

export function serializeSecretKey(secretKey) {
  return toBase64Url(secretKey);
}
