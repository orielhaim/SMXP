import { dohFetch } from "../shared/fetch.js";

const DOH_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

export async function dohQuery(name, type, endpoints = DOH_ENDPOINTS) {
  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("name", name);
      url.searchParams.set("type", type);

      const data = await dohFetch.get(url.toString()).json();

      return data;
    } catch (err) {
      errors.push(`${endpoint}: ${err.message}`);
    }
  }

  throw new Error(`All DoH endpoints failed:\n${errors.join("\n")}`);
}
