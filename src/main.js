import config from "./config.js";
import { startServer } from "./server/index.js";
import { init } from "./store/index.js";

init(config);
startServer();
