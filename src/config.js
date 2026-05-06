const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  dbPath: process.env.DB || "./data/smxp.db",
  adminSecret: process.env.ADMIN_SECRET || "",

  devOverrides: {
    "test1.orielhaim.com": { host: "127.0.0.1", port: 3001 },
    "test2.orielhaim.com": { host: "127.0.0.1", port: 3002 },
  },
};

export default config;
