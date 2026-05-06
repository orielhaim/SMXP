import config from "../config.js";
import { dohQuery } from "./doh.js";

const SVCB_PARAM_KEYS = {
  0: "mandatory",
  1: "alpn",
  2: "no-default-alpn",
  3: "port",
  4: "ipv4hint",
  5: "ech",
  6: "ipv6hint",
};

function parseSvcbData(hexString) {
  let hex = hexString;
  if (hex.startsWith("\\#")) {
    const parts = hex.split(" ");
    hex = parts.slice(2).join(" ");
  }

  const bytes = hex.split(" ").map((b) => parseInt(b, 16));
  let offset = 0;

  function readUint16() {
    const val = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    return val;
  }

  function readBytes(n) {
    const slice = bytes.slice(offset, offset + n);
    offset += n;
    return slice;
  }

  const priority = readUint16();

  const labels = [];
  while (offset < bytes.length) {
    const labelLen = bytes[offset];
    offset++;
    if (labelLen === 0) break;
    const label = readBytes(labelLen)
      .map((b) => String.fromCharCode(b))
      .join("");
    labels.push(label);
  }
  const targetName = labels.length > 0 ? labels.join(".") : ".";

  const params = {};
  while (offset < bytes.length) {
    const key = readUint16();
    const valueLen = readUint16();
    const valueBytes = readBytes(valueLen);

    const keyName = SVCB_PARAM_KEYS[key] || `key${key}`;

    switch (key) {
      case 1: {
        const alpns = [];
        let i = 0;
        while (i < valueBytes.length) {
          const len = valueBytes[i];
          i++;
          const alpnId = valueBytes
            .slice(i, i + len)
            .map((b) => String.fromCharCode(b))
            .join("");
          alpns.push(alpnId);
          i += len;
        }
        params[keyName] = alpns;
        break;
      }
      case 3: {
        params[keyName] = (valueBytes[0] << 8) | valueBytes[1];
        break;
      }
      default: {
        params[keyName] = valueBytes
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        break;
      }
    }
  }

  return { priority, targetName, params };
}

export async function discoverSmxp(domain) {
  const override = config.devOverrides[domain];
  if (override) {
    return {
      host: override.host,
      port: override.port,
      alpn: ["h2"],
      targetName: domain,
    };
  }

  const name = `_smxp.${domain}`;
  const response = await dohQuery(name, "SVCB");

  if (response.Status !== 0) {
    const rcodes = [
      "NOERROR",
      "FORMERR",
      "SERVFAIL",
      "NXDOMAIN",
      "NOTIMP",
      "REFUSED",
    ];
    throw new Error(`DNS error: ${rcodes[response.Status] || response.Status}`);
  }

  const answers = response.Answer || [];
  if (answers.length === 0) {
    throw new Error(`No SMXP SVCB record found for ${domain}`);
  }

  const parsed = parseSvcbData(answers[0].data);
  return {
    host: parsed.targetName,
    port: parsed.params.port || 443,
    alpn: parsed.params.alpn || ["h2"],
    targetName: parsed.targetName,
  };
}
