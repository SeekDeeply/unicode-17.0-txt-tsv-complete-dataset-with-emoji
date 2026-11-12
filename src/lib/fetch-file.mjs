import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Compute the SHA-256 of a file on disk. */
export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL into destPath, with on-disk cache, integrity check, retries and backoff.
 * Returns { path, bytes, sha256, fromCache }.
 */
export async function fetchFile({
  url,
  destPath,
  sha256,
  retries = 4,
  timeoutMs = 180000,
  headers = {},
  force = false,
  log = () => {},
}) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  if (!force && fs.existsSync(destPath)) {
    const bytes = (await fsp.stat(destPath)).size;
    if (!sha256) {
      log(`cache hit   ${path.basename(destPath)} (${bytes} bytes)`);
      return { path: destPath, bytes, sha256: await sha256File(destPath), fromCache: true, url };
    }
    const got = await sha256File(destPath);
    if (got === sha256.toLowerCase()) {
      log(`cache hit   ${path.basename(destPath)} (${bytes} bytes, sha256 ok)`);
      return { path: destPath, bytes, sha256: got, fromCache: true, url };
    }
    log(`cache stale ${path.basename(destPath)} (sha256 mismatch, redownloading)`);
  }

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          headers: { 'user-agent': 'unicode-dataset-builder/1.0 (+https://github.com/SeekDeeply)', ...headers },
          redirect: 'follow',
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha256 && got !== sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${url}: expected ${sha256}, got ${got}`);
      }
      const tmp = `${destPath}.part-${process.pid}`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, destPath);
      log(`downloaded  ${path.basename(destPath)} (${buf.length} bytes)`);
      return { path: destPath, bytes: buf.length, sha256: got, fromCache: false, url };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoff = Math.min(30000, 800 * 2 ** (attempt - 1));
        log(`retry ${attempt}/${retries - 1} for ${path.basename(destPath)} in ${backoff}ms: ${err.message}`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`failed to fetch ${url}: ${lastErr?.message}`);
}

export async function fetchText(opts) {
  const res = await fetchFile(opts);
  return fsp.readFile(res.path, 'utf8');
}
