import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { fromBase64Url, toBase64Url } from "../shared/encoding.js";

export function signMessage(messageBytes, secretKeyBase64Url) {
  const secretKey = fromBase64Url(secretKeyBase64Url);
  const sig = ml_dsa65.sign(messageBytes, secretKey);
  return toBase64Url(sig);
}

export function signObject(obj, secretKeyBase64Url) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  return signMessage(bytes, secretKeyBase64Url);
}
