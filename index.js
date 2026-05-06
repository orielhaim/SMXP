const DOH_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

async function dohQuery(name, type, endpoints = DOH_ENDPOINTS) {
  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("name", name);
      url.searchParams.set("type", type);

      const res = await fetch(url.toString(), {
        headers: { accept: "application/dns-json" },
      });

      if (!res.ok) {
        errors.push(`${endpoint}: ${res.status} ${res.statusText}`);
        continue;
      }

      return await res.json();
    } catch (err) {
      errors.push(`${endpoint}: ${err.message}`);
    }
  }

  throw new Error(`All DoH endpoints failed:\n${errors.join("\n")}`);
}

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
      case 0: {
        const keys = [];
        for (let i = 0; i < valueBytes.length; i += 2) {
          keys.push((valueBytes[i] << 8) | valueBytes[i + 1]);
        }
        params[keyName] = keys.map((k) => SVCB_PARAM_KEYS[k] || `key${k}`);
        break;
      }
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
      case 2: {
        params[keyName] = true;
        break;
      }
      case 3: {
        params[keyName] = (valueBytes[0] << 8) | valueBytes[1];
        break;
      }
      case 4: {
        const addrs = [];
        for (let i = 0; i < valueBytes.length; i += 4) {
          addrs.push(valueBytes.slice(i, i + 4).join("."));
        }
        params[keyName] = addrs;
        break;
      }
      case 5: {
        params[keyName] = Buffer.from(valueBytes).toString("base64");
        break;
      }
      case 6: {
        const addrs = [];
        for (let i = 0; i < valueBytes.length; i += 16) {
          const groups = [];
          for (let j = 0; j < 16; j += 2) {
            groups.push(
              ((valueBytes[i + j] << 8) | valueBytes[i + j + 1]).toString(16),
            );
          }
          addrs.push(groups.join(":"));
        }
        params[keyName] = addrs;
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

async function discoverSmxp(domain) {
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

  return answers.map((answer) => ({
    name: answer.name,
    type: answer.type,
    ttl: answer.TTL,
    ...parseSvcbData(answer.data),
  }));
}

const domain = Bun.argv[2] ?? "orielhaim.com";
const result = await discoverSmxp(domain);
console.dir(result, { depth: null });
