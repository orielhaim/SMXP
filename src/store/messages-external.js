import { smxpFetch } from "../shared/fetch.js";

function endpoint(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function createExternalMessageStore(baseUrl) {
  return {
    async store(envelope, direction, deliveredTo) {
      await smxpFetch
        .post(endpoint(baseUrl, "/store"), {
          json: { envelope, direction, deliveredTo },
        })
        .json();
    },

    async exists(id, direction = "in") {
      const result = await smxpFetch
        .post(endpoint(baseUrl, "/exists"), {
          json: { id, direction },
        })
        .json();
      return !!result.exists;
    },

    async query(address, params = {}) {
      return await smxpFetch
        .post(endpoint(baseUrl, "/query"), {
          json: { address, params },
        })
        .json();
    },
  };
}
