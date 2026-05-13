const config = {
  host: process.env.HOST || "0.0.0.0",
  port: parseInt(process.env.PORT || "3001", 10),
  adminSecret: process.env.ADMIN_SECRET || "",

  core: {
    path: process.env.CORE_DB || "./data/core.db",
  },

  messages: {
    driver: process.env.MESSAGES_DRIVER || "local",
    path: process.env.MESSAGES_DB || "./data/messages.db",
    url: process.env.MESSAGES_URL || "",
    token: process.env.MESSAGES_TOKEN || "",
  },

  blobs: {
    driver: process.env.BLOBS_DRIVER || "local",
    dbPath: process.env.BLOBS_DB || "./data/blobs.db",
    dataRoot: process.env.BLOBS_ROOT || "./data/blobs",
    maxSize: parseInt(process.env.BLOBS_MAX_SIZE || `${500 * 1024 * 1024}`, 10),
    url: process.env.BLOBS_URL || "",
    token: process.env.BLOBS_TOKEN || "",
  },

  devOverrides: {
    "test1.orielhaim.com": { host: "127.0.0.1", port: 3001 },
    "test2.orielhaim.com": { host: "127.0.0.1", port: 3002 },
  },
};

export default config;
