const primaryDomain = (process.env.SMXP_DOMAIN || "localhost")
  .trim()
  .toLowerCase();

const config = {
  domains: (process.env.SMXP_DOMAINS || primaryDomain)
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
  domain: primaryDomain,
  port: parseInt(process.env.SMXP_PORT || "3001", 10),
  dbPath: process.env.SMXP_DB || "./data/smxp.db",
  host: process.env.SMXP_HOST || "127.0.0.1",

  devOverrides: {
    "test1.orielhaim.com": { host: "127.0.0.1", port: 3001 },
    "test2.orielhaim.com": { host: "127.0.0.1", port: 3002 },
  },
};

export default config;
