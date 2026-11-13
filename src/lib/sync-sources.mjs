import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fetchFile, sha256File } from './fetch-file.mjs';
import { SOURCES, UCD_VERSION } from './sources.mjs';
import { info, log, ok, warn } from './log.mjs';

/**

 * Canonical location of the downloaded sources for the pinned version.
 *
 * Exported so the verifier reads the same bytes the build read. The path is
 * version-scoped: the cache is keyed by filename, and the same filename holds
 * different bytes in different releases.
 */
export function sourceCacheDir(root) {
  return path.join(root, '.cache', 'sources', UCD_VERSION);
}

/**
 * Download every source into the cache and maintain data/sources.lock.json.
 *
 * --force        re-download even when the cache is valid
 * --update-lock  accept upstream changes and rewrite the lock file
 *                (refuses unless all sources verify against the live hash list
 *                it just produced, so a partial/failed fetch cannot poison it)
 */
export async function syncSources({ root, force = false, updateLock = false, offline = false } = {}) {
  // The cache is persistent across runs, which is the point: a rebuild of unchanged
  // sources must not re-download 14 MB. But it is keyed by FILENAME, and the same
  // filename holds different bytes in different Unicode versions. So the cache has to
  // be scoped by version, or moving the pin serves 17.0's UnicodeData.txt while the
  // URL says 18.0 - which is exactly the "upstream content changed" alarm this build
  // raises, with a useless message, on a perfectly legitimate version bump.
  const lockPath = path.join(root, 'data', 'sources.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { version: UCD_VERSION, files: {} };
  // Always scope the cache by version, so two releases can never share a filename.
  // The unversioned layout used earlier is simply abandoned: a stale file there would
  // otherwise be served for a version it does not belong to.
  const cacheDir = sourceCacheDir(root);
  const versionsMatch = lock.version === UCD_VERSION;
  // --force still means "re-download even though the cache is valid".
  const effectiveForce = force;
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
  if (!versionsMatch) {
    log(`version pin changed (${lock.version} -> ${UCD_VERSION}): using a separate cache directory`);
  }

  for (const src of SOURCES) {
    const dest = path.join(cacheDir, src.file);
    const locked = lock.files?.[src.key]?.sha256;
    // Emoji sources can live at more than one published path; try each candidate in
    // order and keep the first that serves a file. See emojiCandidates() in sources.mjs.
    const candidates = src.urls ?? [src.url];
    let res;
    let lastErr;
    for (const url of candidates) {
      try {
        // Fetch WITHOUT hash enforcement, then compare against the lock ourselves.
        //
        // Passing the expected hash into fetchFile would make a changed upstream look
        // like a transient network fault: it retries three times and dies with
        // "sha256 mismatch", which tells the user nothing about what to do. Comparing
        // here instead produces the actionable message (see drift handling below), and
        // a merely corrupted cache still heals itself, because a re-download that
        // matches the lock is simply a cache hit.
        res = await fetchFile({
          url,
          destPath: dest,
          sha256: undefined,
          force: effectiveForce && !offline,
          log: (m) => log(m),
        });
        break;
      } catch (err) {
        lastErr = err;
        if (url !== candidates[candidates.length - 1]) {
          log(`${src.key}: ${url} unavailable, trying next published location`);
        }
      }
    }
    if (!res) {
      if (!src.required) {
        warn(`optional source ${src.key} unavailable (${lastErr?.message.split('\n')[0]}) — continuing`);
        continue;
      }
      throw lastErr;
    }
    if (locked && res.sha256 !== locked) drift.push({ key: src.key, url: src.url, locked, live: res.sha256 });
    // Record the URL that actually served the file, not the first candidate: the lock
    // is the record of where this exact byte sequence came from.
    next.files[src.key] = { url: res.url ?? src.url, file: src.file, sha256: res.sha256, bytes: res.bytes };
    results.push({ ...src, ...res });
  }

  if (drift.length && !updateLock) {
    const lines = drift
      .map((d) => `  ${d.key}\n    ${d.url}\n    locked ${d.locked}\n    live   ${d.live}`)
      .join('\n');
    throw new Error(
      `upstream content changed for ${drift.length} source(s) while the version pin (${UCD_VERSION}) stayed the same:\n\n` +
        lines +
        '\n\nUnicode does not normally re-cut a released version, so treat this as suspicious:\n' +
        '  - if it is a legitimate re-cut, re-run with --update-lock and review the data diff\n' +
        '  - otherwise do not build: the pinned bytes are what every published checksum describes',
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
