import { dohQuery } from "./doh.js";

export async function fetchPolicy(domain) {
  try {
    const name = `_smxp-policy.${domain}`;
    const response = await dohQuery(name, "TXT");

    if (response.Status !== 0 || !response.Answer || response.Answer.length === 0) {
      // ברירת מחדל — מקבלים הכל
      return { requireSig: true, maxSize: 25 * 1024 * 1024, acceptFrom: "*" };
    }

    const txt = response.Answer[0].data.replace(/"/g, "");
    return parsePolicy(txt);
  } catch {
    return { requireSig: true, maxSize: 25 * 1024 * 1024, acceptFrom: "*" };
  }
}

function parsePolicy(txt) {
  const parts = txt.split(";").map((s) => s.trim());
  const policy = { requireSig: true, maxSize: 25 * 1024 * 1024, acceptFrom: "*" };

  for (const part of parts) {
    const [key, val] = part.split("=").map((s) => s.trim());
    switch (key) {
      case "require-sig":
        policy.requireSig = val === "yes";
        break;
      case "max-size":
        policy.maxSize = parseInt(val) * (val.endsWith("m") ? 1024 * 1024 : 1);
        break;
      case "accept-from":
        policy.acceptFrom = val;
        break;
    }
  }

  return policy;
}
