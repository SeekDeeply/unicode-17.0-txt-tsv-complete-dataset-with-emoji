/**
 * Detect the newest *released* Unicode version, and whether it is newer than the
 * version this repository pins.
 *
 * Shared by src/check-upstream-version.mjs (report only) and src/bump-version.mjs
 * (actually adopt it), so the two can never disagree about what "latest" means.
 *
 * Two traps, both observed live on unicode.org:
 *
 *   1. /Public/ contains version directories that are NOT released. At the time of
 *      writing /Public/19.0.0/ exists but redirects to /Public/draft/, so taking the
 *      highest directory number would suggest upgrading to a draft. A directory
 *      counts only if it serves ucd/UnicodeData.txt with HTTP 200 and no redirect.
 *
 *   2. Emoji has its own version numbering that lags the UCD one, and since 17.0
 *      emoji-test.txt is published under /Public/<ucd-version>/emoji/. So "latest
 *      emoji directory" is not "latest emoji data"; we read the Version line out of
 *      the file served for each candidate UCD version.
 */

const BASE = 'https://www.unicode.org/Public';
const UA = { 'user-agent': 'unicode-dataset-builder/1.0 (+https://github.com/SeekDeeply)' };

/** Compare two dotted numeric version strings. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * A version directory is "released" only if the file is served directly. A redirect
 * means it is a pointer to /Public/draft/ (unreleased).
 */
export async function isReleasedVersion(uVersion, relPath = 'ucd/UnicodeData.txt') {
  const url = `${BASE}/${uVersion}/${relPath}`;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: UA });
    if (res.status === 200) return { released: true, status: 200, url };
    return { released: false, status: res.status, url, location: res.headers.get('location') ?? undefined };
  } catch (err) {
    return { released: false, status: -1, url, error: err.message };
  }
}

export async function listVersionDirs() {
  const res = await fetch(`${BASE}/`, { headers: UA });
  if (!res.ok) throw new Error(`cannot list ${BASE}/: HTTP ${res.status}`);
  const html = await res.text();
  const versions = [];
  for (const m of html.matchAll(/href="(\d+\.\d+\.\d+)\//g)) versions.push(m[1]);
  versions.sort(compareVersions);
  return [...new Set(versions)];
}

/** Read "# Version: X.Y" out of the emoji-test.txt served for a given UCD version. */
export async function emojiVersionOf(uVersion) {
  const candidates = [
    `${BASE}/${uVersion}/emoji/emoji-test.txt`,
    // Older releases (<= 16.0) publish emoji data under its own directory tree.
    `${BASE}/emoji/${uVersion.replace(/\.0$/, '')}/emoji-test.txt`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      const text = await res.text();
      const m = /^#\s*Version:\s*(\d+\.\d+)\s*$/m.exec(text);
      if (m) return m[1];
    } catch {
      // try the next location
    }
  }
  return null;
}

/**
 * Full detection. Returns a plain object so callers can decide what to do.
 */
export async function detectLatestRelease({ pinnedUcd, pinnedEmoji }) {
  const dirs = await listVersionDirs();
  let latestReleased = null;
  const skipped = [];
  for (const v of [...dirs].reverse()) {
    const probe = await isReleasedVersion(v);
    if (probe.released) {
      latestReleased = v;
      break;
    }
    skipped.push({ version: v, status: probe.status, location: probe.location });
  }
  if (!latestReleased) throw new Error('no released version directory found on unicode.org');

  const latestEmoji = await emojiVersionOf(latestReleased);
  const ucdNewer = compareVersions(latestReleased, pinnedUcd) > 0;
  const emojiNewer = latestEmoji ? compareVersions(latestEmoji, pinnedEmoji) > 0 : false;

  // Confirm the pinned version still serves what we depend on, so a vanished release
  // is reported instead of silently looking "up to date".
  const pinnedProbes = await Promise.all([
    isReleasedVersion(pinnedUcd, 'ucd/UnicodeData.txt'),
    isReleasedVersion(pinnedUcd, 'ucd/extracted/DerivedName.txt'),
    isReleasedVersion(pinnedUcd, 'emoji/emoji-test.txt'),
  ]);

  return {
    listedCount: dirs.length,
    newestListed: dirs[dirs.length - 1],
    latestReleased,
    latestEmoji,
    skipped,
    pinnedReachable: pinnedProbes.every((p) => p.released),
    pinnedProbeStatuses: pinnedProbes.map((p) => p.status),
    updateAvailable: ucdNewer || emojiNewer,
    ucdNewer,
    emojiNewer,
  };
}
