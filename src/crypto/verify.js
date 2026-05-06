import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { fromBase64Url } from "../shared/encoding.js";

export function verifySignature(
  messageBytes,
  signatureBase64Url,
  publicKeyBase64Url,
) {
  try {
    const sig = fromBase64Url(signatureBase64Url);
    const publicKey = fromBase64Url(publicKeyBase64Url);
    return ml_dsa65.verify(sig, messageBytes, publicKey);
  } catch (e) {
    return false;
  }
}

export function verifyObjectSignature(obj, signatureBase64Url, publicKeyBase64Url) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  return verifySignature(bytes, signatureBase64Url, publicKeyBase64Url);
}
