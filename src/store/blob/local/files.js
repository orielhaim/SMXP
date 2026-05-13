import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { toBase64Url } from "../../../shared/encoding.js";

export function newBlobId() {
  return `blob_${toBase64Url(randomBytes(12))}`;
}

export function blobPath(root, blobId) {
  const stripped = blobId.replace(/^blob_/, "");
  const prefix = stripped.slice(0, 2) || "00";
  return join(root, prefix, blobId);
}

export function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export async function appendBytes(path, offset, bytes) {
  ensureDir(path);
  const fh = await open(path, "a+");
  try {
    const stat = await fh.stat();
    if (stat.size !== offset) {
      throw new Error(
        `chunk offset mismatch: expected ${stat.size}, got ${offset}`,
      );
    }
    await fh.write(bytes, 0, bytes.length, offset);
    return offset + bytes.length;
  } finally {
    await fh.close();
  }
}

export async function computeSha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export function openReadStream(path, { start, end } = {}) {
  const opts = {};
  if (Number.isInteger(start)) opts.start = start;
  if (Number.isInteger(end)) opts.end = end;
  return createReadStream(path, opts);
}

export function removeFile(path) {
  try {
    rmSync(path, { force: true });
  } catch {}
}

export function emptyWriteStream(path) {
  ensureDir(path);
  return createWriteStream(path, { flags: "w" });
}
