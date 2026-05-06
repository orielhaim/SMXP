export function toBase64Url(uint8Array) {
  const base64 = Buffer.from(uint8Array).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return new Uint8Array(Buffer.from(base64, "base64"));
}
