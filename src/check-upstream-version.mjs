#!/usr/bin/env node
/**
 * Report whether unicode.org has a newer released version than the pinned one.
 *
 *   node src/check-upstream-version.mjs            # human report
 *   node src/check-upstream-version.mjs --github   # also write $GITHUB_OUTPUT
 *
 * This only reports; it never edits anything. src/bump-version.mjs is what
 * actually adopts a new release.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UCD_VERSION, UNICODE_VERSION, EMOJI_VERSION } from './lib/sources.mjs';
import { detectLatestRelease } from './lib/upstream-release.mjs';
import { head as heading, info, ok, warn, fail, log } from './lib/log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB = process.argv.includes('--github');

/**
 * Emit CI outputs.
 *
 * Prefer $GITHUB_OUTPUT (the supported mechanism). Writing key=value to stdout
 * looks like it works and does not: values arrive as step output only when the
 * file is used, so a conditional step silently never runs.
 */
function emitGithub(kv) {
  const target = process.env.GITHUB_OUTPUT;
  if (target) {
    const lines = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.appendFileSync(target, lines + '\n');
  }
  for (const [k, v] of Object.entries(kv)) console.log(`${k}=${v}`);
}

async function main() {
  heading('Unicode release check');
  info(`pinned: Unicode ${UNICODE_VERSION}  UCD ${UCD_VERSION}  Emoji ${EMOJI_VERSION}`);
  console.log('');

  let result;
  try {
    result = await detectLatestRelease({ pinnedUcd: UCD_VERSION, pinnedEmoji: EMOJI_VERSION });
  } catch (err) {
    fail(`could not read the Unicode release listing: ${err.message}`);
    if (GITHUB) emitGithub({ update: 'false', error: err.message.replace(/\n/g, ' ') });
    process.exit(1);
  }

  log(`${result.listedCount} version directories listed, newest: ${result.newestListed}`);
  log(`latest released UCD: ${result.latestReleased}`);
  if (result.skipped.length) {
    const shown = result.skipped.slice(0, 5).map((s) => `${s.version}(HTTP ${s.status}${s.location ? ` -> ${s.location}` : ''})`);
    log(`skipped unreleased/redirecting: ${shown.join(', ')}`);
  }

  if (result.pinnedReachable) ok(`pinned sources reachable (UCD ${UCD_VERSION})`);
  else warn(`some pinned sources are not reachable for ${UCD_VERSION}: ${result.pinnedProbeStatuses.join('/')}`);

  console.log('');
  if (result.updateAvailable) {
    warn(`newer release available - UCD ${result.latestReleased}${result.latestEmoji ? `, Emoji ${result.latestEmoji}` : ''}`);
    if (!GITHUB) {
      console.log('');
      console.log('  To adopt it:');
      console.log('    node src/bump-version.mjs --to ' + result.latestReleased + '   (add --dry-run to preview)');
    }
  } else {
    ok(`pinned version is current (UCD ${UCD_VERSION} / Emoji ${EMOJI_VERSION})`);
  }

  if (!GITHUB) {
    const stampPath = path.join(ROOT, 'data', 'last-version-check.json');
    const stamp = {
      checkedAt: new Date().toISOString(),
      pinned: { ucd: UCD_VERSION, unicode: UNICODE_VERSION, emoji: EMOJI_VERSION },
      latestReleased: { ucd: result.latestReleased, emoji: result.latestEmoji },
      updateAvailable: result.updateAvailable,
    };
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n');
    log('wrote data/last-version-check.json');
  }

  if (GITHUB) {
    emitGithub({
      update: String(result.updateAvailable),
      latest_ucd: result.latestReleased,
      latest_emoji: result.latestEmoji ?? EMOJI_VERSION,
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
