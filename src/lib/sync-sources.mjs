import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fetchFile, sha256File } from './fetch-file.mjs';
import { SOURCES, UCD_VERSION } from './sources.mjs';
import { info, log, ok, warn } from './log.mjs';

/**
 * Download every source into the cache and maintain data/sources.lock.json.
 *
 * --force        re-download even when the cache is valid
 * --update-lock  accept upstream changes and rewrite the lock file
 *                (refuses unless all sources verify against the live hash list
 *                it just produced, so a partial/failed fetch cannot poison it)
 */
export async function syncSources({ root, force = false, updateLock = false, offline = false } = {}) {
  const cacheDir = path.join(root, '.cache', 'sources');
  const lockPath = path.join(root, 'data', 'sources.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { version: UCD_VERSION, files: {} };
  // buildDate is pinned in the lock so a rebuild of unchanged sources is byte-identical.
  // SOURCE_DATE_EPOCH wins when set (reproducible-builds convention).
  const pinnedBuildDate =
    lock.buildDate ??
    (process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString());
  const next = { version: UCD_VERSION, generatedFrom: `Unicode ${UCD_VERSION}`, buildDate: pinnedBuildDate, files: {} };
  const results = [];
  const drift = [];

  if (offline) {
    info('offline mode: using whatever is already in the cache');
  }

  for (const src of SOURCES) {
    const dest = path.join(cacheDir, src.file);
    const locked = lock.files?.[src.key]?.sha256;
    let res;
    try {
      res = await fetchFile({
        url: src.url,
        destPath: dest,
        sha256: !force && !offline ? locked : undefined,
        force: force && !offline,
        log: (m) => log(m),
      });
    } catch (err) {
      if (!src.required && !fs.existsSync(dest)) {
        warn(`optional source ${src.key} unavailable (${err.message.split('\n')[0]}) — continuing`);
        continue;
      }
      throw err;
    }
    if (locked && res.sha256 !== locked) drift.push({ key: src.key, url: src.url, locked, live: res.sha256 });
    next.files[src.key] = { url: src.url, file: src.file, sha256: res.sha256, bytes: res.bytes };
    results.push({ ...src, ...res });
  }

  if (drift.length && !updateLock) {
    const lines = drift.map((d) => `  ${d.key}: locked ${d.locked.slice(0, 12)}… != live ${d.live.slice(0, 12)}…`).join('\n');
    throw new Error(
      `upstream content changed for ${drift.length} source(s) while the version pin (${UCD_VERSION}) stayed the same:\n` +
        lines +
        '\nUpstream changed content under a fixed version, which should not happen.\n' +
        'Re-run with --update-lock only after confirming the change is legitimate.',
    );
  }

  if (updateLock || !fs.existsSync(lockPath)) {
    await fsp.mkdir(path.dirname(lockPath), { recursive: true });
    await fsp.writeFile(lockPath, JSON.stringify(next, null, 2) + '\n');
    ok(`lock file written: ${Object.keys(next.files).length} sources`);
  } else {
    log(`lock verified: ${results.length} sources match data/sources.lock.json`);
  }

  return { results, cacheDir, lockPath, drift };
}

export { sha256File };
