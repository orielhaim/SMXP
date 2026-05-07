import { startServer } from "./server/index.js";
import { initSchema } from "./store/schema.js";

initSchema();
startServer();
