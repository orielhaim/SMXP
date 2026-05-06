import config from "../config.js";

export function resolveTarget(domain) {
  const override = config.devOverrides[domain];
  if (override) {
    return { host: override.host, port: override.port };
  }
  return null;
}

export function buildBaseUrl(host, port) {
  return `http://${host}:${port}`;
}
