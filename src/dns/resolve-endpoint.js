import config from "../config.js";
import { discoverSmxp } from "./discover.js";

export function hasDevOverride(domain) {
  return !!config.devOverrides[domain];
}

export async function resolveEndpoint(domain) {
  const target = await discoverSmxp(domain);
  return {
    ...target,
    baseUrl: `http://${target.host}:${target.port}`,
  };
}
