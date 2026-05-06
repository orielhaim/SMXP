import { createServerApp } from "./index.js";

const app = createServerApp();

export function route(req) {
  return app.handle(req);
}
