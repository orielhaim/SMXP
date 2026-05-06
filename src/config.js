const config = {
    domain: process.env.SMXP_DOMAIN || "localhost",
    port: parseInt(process.env.SMXP_PORT || "3001"),
    dbPath: process.env.SMXP_DB || "./data/smxp.db",
    host: process.env.SMXP_HOST || "127.0.0.1",
  
    // Dev overrides - מיפוי דומיינים ל-localhost
    devOverrides: {
      "test1.orielhaim.com": { host: "127.0.0.1", port: 3001 },
      "test2.orielhaim.com": { host: "127.0.0.1", port: 3002 },
    },
  };
  
  export default config;
  