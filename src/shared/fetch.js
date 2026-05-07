import ky from "ky";

const RETRY_LIMIT = parseInt(process.env.SMXP_RETRY_LIMIT ?? "3", 10);
const RETRY_DELAY = parseInt(process.env.SMXP_RETRY_DELAY ?? "1000", 10);
const RETRY_BACKOFF_LIMIT = parseInt(
  process.env.SMXP_RETRY_BACKOFF_LIMIT ?? "10000",
  10,
);
const TIMEOUT = parseInt(process.env.SMXP_TIMEOUT ?? "10000", 10);
const TOTAL_TIMEOUT = parseInt(process.env.SMXP_TOTAL_TIMEOUT ?? "30000", 10);

export const smxpFetch = ky.create({
  timeout: TIMEOUT,
  totalTimeout: TOTAL_TIMEOUT,
  retry: {
    limit: RETRY_LIMIT,
    delay: RETRY_DELAY,
    backoffLimit: RETRY_BACKOFF_LIMIT,
    methods: ["post", "get", "put", "delete"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeRetry: [
      ({ retryCount, error }) => {
        console.warn(`[FETCH] Retry #${retryCount} — ${error.message}`);
      },
    ],
    beforeError: [
      ({ error, request }) => {
        const url = request?.url ?? "unknown";
        error.message = `[SMXP] Request to ${url} failed: ${error.message}`;
        return error;
      },
    ],
  },
});

const DOH_RETRY_LIMIT = parseInt(process.env.SMXP_DOH_RETRY_LIMIT ?? "2", 10);
const DOH_TIMEOUT = parseInt(process.env.SMXP_DOH_TIMEOUT ?? "5000", 10);

export const dohFetch = ky.create({
  timeout: DOH_TIMEOUT,
  retry: {
    limit: DOH_RETRY_LIMIT,
    methods: ["get"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
  headers: {
    accept: "application/dns-json",
  },
  hooks: {
    beforeRetry: [
      ({ retryCount, error }) => {
        console.warn(`[DOH] Retry #${retryCount} — ${error.message}`);
      },
    ],
  },
});
