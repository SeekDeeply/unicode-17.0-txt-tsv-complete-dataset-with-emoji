#!/usr/bin/env node
/**
 * Poll the Unicode Consortium for a newer *final* UCD release than the one this
 * dataset is pinned to.
 *
 *   node src/check-upstream-version.mjs            # human report
 *   node src/check-upstream-version.mjs --github   # emits KEY=value lines for CI
 *
 * Exit codes:
 *   0  report produced (look at update=true/false)
 *   1  the release listings could not be read
 *
 * Two traps this handles, both observed live on unicode.org:
 *
 *   1. /Public/ contains version directories that are *not released*. At the
 *      time of writing /Public/19.0.0/ exists but redirects to /Public/draft/,
 *      so blindly taking the highest directory number suggests upgrading to a
 *      draft. We require the directory to serve ucd/UnicodeData.txt with HTTP
 *      200 and *no redirect*.
 *
 *   2. Emoji has its own version numbering that lags the UCD one, and since
 *      17.0 emoji-test.txt is published under /Public/<ucd-version>/emoji/.
 *      So "latest emoji dir" (16.0) is not "latest emoji data". We therefore
 *      probe the UCD-rooted path for each candidate UCD version instead of
 *      trusting the /Public/emoji/ listing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UCD_VERSION, UNICODE_VERSION, EMOJI_VERSION } from './lib/sources.mjs';
import { head as heading, info, ok, warn, fail, log } from './lib/log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB = process.argv.includes('--github');
const BASE = 'https://www.unicode.org/Public';
const UA = { 'user-agent': 'unicode-dataset-builder/1.0 (+https://github.com/SeekDeeply)' };

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * A version directory is "released" only if the file is served directly.
 * A redirect means it is a pointer to /Public/draft/ (unreleased).
 */
async function isReleased(uVersion, relPath) {
  const url = `${BASE}/${uVersion}/${relPath}`;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: UA });
    if (res.status === 200) return { released: true, status: 200, url };
    return { released: false, status: res.status, url, location: res.headers.get('location') ?? undefined };
  } catch (err) {
    return { released: false, status: -1, url, error: err.message };
  }
}

async function listVersionDirs() {
  const res = await fetch(`${BASE}/`, { headers: UA });
  if (!res.ok) throw new Error(`cannot list ${BASE}/: HTTP ${res.status}`);
  const html = await res.text();
  const versions = [];
  for (const m of html.matchAll(/href="(\d+\.\d+\.\d+)\//g)) versions.push(m[1]);
  versions.sort(cmp);
  return [...new Set(versions)];
}

/** Read "# Version: X.Y" out of the emoji-test.txt served for a given UCD version. */
async function emojiVersionOf(uVersion) {
  const url = `${BASE}/${uVersion}/emoji/emoji-test.txt`;
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const text = await res.text();
    const m = /^#\s*Version:\s*(\d+\.\d+)\s*$/m.exec(text);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function emitGithub(kv) {
  for (const [k, v] of Object.entries(kv)) console.log(`${k}=${v}`);
}

async function main() {
  heading('Unicode release check');
  info(`pinned: Unicode ${UNICODE_VERSION}  UCD ${UCD_VERSION}  Emoji ${EMOJI_VERSION}`);
  console.log('');

  let dirs;
  try {
    dirs = await listVersionDirs();
  } catch (err) {
    fail(`could not read the Unicode release listing: ${err.message}`);
    if (GITHUB) emitGithub({ update: 'false', error: err.message.replace(/\n/g, ' ') });
    process.exit(1);
  }
  log(`${dirs.length} version directories listed, newest: ${dirs[dirs.length - 1]}`);

  // Walk newest -> oldest and take the first one that is genuinely released.
  let latestReleased = null;
  const skipped = [];
  for (const v of [...dirs].reverse()) {
    const probe = await isReleased(v, 'ucd/UnicodeData.txt');
    if (probe.released) {
      latestReleased = v;
      break;
    }
    skipped.push(`${v}(HTTP ${probe.status}${probe.location ? ` -> ${probe.location}` : ''})`);
  }
  if (!latestReleased) {
    fail('no released version directory found');
    if (GITHUB) emitGithub({ update: 'false', error: 'no released version found' });
    process.exit(1);
  }
  log(`latest released UCD: ${latestReleased}`);
  if (skipped.length) log(`skipped unreleased/redirecting: ${skipped.slice(0, 5).join(', ')}`);

  // Confirm the pinned version still serves what we depend on.
  const pinnedProbes = await Promise.all([
    isReleased(UCD_VERSION, 'ucd/UnicodeData.txt'),
    isReleased(UCD_VERSION, 'ucd/extracted/DerivedName.txt'),
    isReleased(UCD_VERSION, 'emoji/emoji-test.txt'),
  ]);
  const pinnedOk = pinnedProbes.every((p) => p.released);
  if (pinnedOk) ok(`pinned sources reachable (UCD ${UCD_VERSION})`);
  else warn(`some pinned sources are not reachable for ${UCD_VERSION}: ${pinnedProbes.map((p) => p.status).join('/')}`);

  const latestEmoji = await emojiVersionOf(latestReleased);
  const ucdNewer = cmp(latestReleased, UCD_VERSION) > 0;
  const emojiNewer = latestEmoji ? cmp(latestEmoji, EMOJI_VERSION) > 0 : false;
  const update = ucdNewer || emojiNewer;

  console.log('');
  if (update) {
    warn(`newer release available — UCD ${latestReleased}${latestEmoji ? `, Emoji ${latestEmoji}` : ''}`);
    if (!GITHUB) {
      console.log('');
      console.log('  To adopt it:');
      console.log(`    1. src/lib/sources.mjs: UCD_VERSION = '${latestReleased}', EMOJI_VERSION = '${latestEmoji ?? EMOJI_VERSION}'`);
      console.log('    2. git mv the two dataset directories to the new version');
      console.log('    3. node src/build.mjs --force --update-lock');
      console.log('    4. node src/verify.mjs --strict');
      console.log('    5. review the diff, then commit');
    }
  } else {
    ok(`pinned version is current (UCD ${UCD_VERSION} / Emoji ${EMOJI_VERSION})`);
  }

  // Record the check so the repo can show when it last looked upstream.
  if (!GITHUB) {
    const stampPath = path.join(ROOT, 'data', 'last-version-check.json');
    const stamp = {
      checkedAt: new Date().toISOString(),
      pinned: { ucd: UCD_VERSION, unicode: UNICODE_VERSION, emoji: EMOJI_VERSION },
      latestReleased: { ucd: latestReleased, emoji: latestEmoji },
      updateAvailable: update,
    };
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n');
    log('wrote data/last-version-check.json');
  }

  if (GITHUB) {
    emitGithub({
      update: String(update),
      latest_ucd: latestReleased,
      latest_emoji: latestEmoji ?? EMOJI_VERSION,
      pinned_ucd: UCD_VERSION,
      pinned_emoji: EMOJI_VERSION,
    });
  }
  process.exit(0);
}

main().catch((err) => {
  fail(err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
