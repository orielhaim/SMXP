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
  