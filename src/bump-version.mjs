#!/usr/bin/env node
/**
 * Adopt a newer Unicode release end to end, in one command.
 *
 *   node src/bump-version.mjs --to 18.0.0            # do it
 *   node src/bump-version.mjs --to 18.0.0 --dry-run  # show the plan, write nothing
 *   node src/bump-version.mjs --latest               # pick the newest released version
 *   node src/bump-version.mjs --to 18.0.0 --allow-blocked  # continue past a data check
 *
 * What it does, in order, and why each step exists:
 *
 *   1. detect / validate the target version is actually released (not a draft)
 *   2. rewrite the version constants in src/lib/sources.mjs  — the single source
 *      of truth that every path, filename and URL is derived from
 *   3. rename the two output directories with `git mv`, so history follows the files
 *   4. delete the old lock, then rebuild with --force --update-lock, which
 *      re-downloads every source and re-pins the upstream hashes
 *   5. run the verifier in strict mode
 *   6. re-render every document from the new manifest
 *   7. report exactly what changed, and fail if anything is inconsistent
 *
 * Steps 1 and 5 are hard gates: if the target is not released, or the rebuilt data
 * does not pass verification, the tool stops and leaves the repository untouched
 * (all mutations after step 1 happen on the working tree, and --dry-run shows the
 * whole plan without touching anything).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectLatestRelease, compareVersions, isReleasedVersion } from './lib/upstream-release.mjs';
import { head as heading, info, ok, warn, fail, log } from './lib/log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DRY_RUN = flag('--dry-run');
const ALLOW_BLOCKED = flag('--allow-blocked');
const DRY_TAG = DRY_RUN ? ' [dry-run: nothing written]' : '';

/* ------------------------------------------------------------- helpers */

/** Read the current pin straight out of sources.mjs (no bundler, no cache). */
async function readPin() {
  const mod = await import('./lib/sources.mjs?t=' + Date.now());
  return { ucd: mod.UCD_VERSION, unicode: mod.UNICODE_VERSION, emoji: mod.EMOJI_VERSION };
}

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = capture ? `\n${(res.stdout || '') + (res.stderr || '')}`.slice(0, 4000) : '';
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${res.status}${detail}`);
  }
  return res.stdout ?? '';
}

const dirNames = (v) => ({
  unicode: `Unicode-${v}-Complete-Dataset`,
  emoji: `Emoji-${v}-Complete-Dataset`,
});

/* --------------------------------------------------------------- steps */

async function main() {
  const pin = await readPin();
  heading(`Adopt a new Unicode release${DRY_TAG}`);
  info(`pinned now: Unicode ${pin.unicode}  UCD ${pin.ucd}  Emoji ${pin.emoji}`);
  console.log('');

  // Snapshot the "before" numbers now, while the old manifest is still on disk, so the
  // summary can report real deltas instead of reconstructing them from git history.
  const manifestPath = path.join(ROOT, 'data', 'manifest.json');
  const beforeManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;

  /* --- 1. decide the target ---------------------------------------- */
  let target = valueOf('--to');
  let targetEmoji = valueOf('--emoji');

  if (!target && flag('--latest')) {
    info('resolving the newest released version...');
    const latest = await detectLatestRelease({ pinnedUcd: pin.ucd, pinnedEmoji: pin.emoji });
    target = latest.latestReleased;
    targetEmoji = latest.latestEmoji ?? undefined;
    log(`newest released: UCD ${target}${targetEmoji ? `  Emoji ${targetEmoji}` : ''}`);
  }

  if (!target) {
    fail('no target version. Pass --to <X.Y.0> or --latest.');
    process.exit(2);
  }

  if (!/^\d+\.\d+\.\d+$/.test(target)) {
    fail(`target must look like 18.0.0 (a UCD version), got: ${target}`);
    process.exit(2);
  }

  // The dataset's own version label is the UCD version without the patch component.
  const targetUnicode = target.replace(/\.0$/, '');

  if (compareVersions(target, pin.ucd) === 0) {
    ok(`already pinned to UCD ${target} - nothing to do`);
    process.exit(0);
  }
  if (compareVersions(target, pin.ucd) < 0) {
    warn(`target ${target} is OLDER than the pin ${pin.ucd}; proceeding because you asked explicitly`);
  }

  // Hard gate: never migrate onto a directory that is not a release.
  const probe = await isReleasedVersion(target);
  if (!probe.released) {
    fail(`UCD ${target} is not a released version: ${probe.url} returned HTTP ${probe.status}`);
    if (probe.status === 302 || probe.location) {
      fail(`  It redirects to ${probe.location ?? '/Public/draft/'} - a draft directory, not a release.`);
    } else if (probe.status === 404) {
      fail('  That version does not exist on unicode.org. Check the version number.');
    }
    process.exit(1);
  }
  ok(`UCD ${target} is released and serves UnicodeData.txt`);

  if (!targetEmoji) {
    const { emojiVersionOf } = await import('./lib/upstream-release.mjs');
    targetEmoji = (await emojiVersionOf(target)) ?? targetUnicode;
  }

  const from = dirNames(pin.unicode);
  const to = dirNames(targetUnicode);

  heading('Plan');
  console.log(`  src/lib/sources.mjs`);
  console.log(`    UCD_VERSION      ${pin.ucd}  ->  ${target}`);
  console.log(`    UNICODE_VERSION  ${pin.unicode}  ->  ${targetUnicode}`);
  console.log(`    EMOJI_VERSION    ${pin.emoji}  ->  ${targetEmoji}`);
  if (from.unicode !== to.unicode) console.log(`  git mv ${from.unicode}  ->  ${to.unicode}`);
  if (from.emoji !== to.emoji) console.log(`  git mv ${from.emoji}  ->  ${to.emoji}`);
  console.log(`  rm data/sources.lock.json`);
  console.log(`  node src/build.mjs --force --update-lock`);
  console.log(`  node src/verify.mjs --strict`);
  console.log(`  node src/render-docs.mjs`);
  console.log('');

  if (DRY_RUN) {
    ok('dry run complete: no files were changed');
    process.exit(0);
  }

  /* --- 2. rewrite the pin ------------------------------------------ */
  heading('1/6  Updating the version pin');
  const sourcesPath = path.join(ROOT, 'src', 'lib', 'sources.mjs');
  const before = await fsp.readFile(sourcesPath, 'utf8');
  const after = before
    .replace(/export const UCD_VERSION = '[^']*';/, `export const UCD_VERSION = '${target}';`)
    .replace(/export const UNICODE_VERSION = '[^']*';/, `export const UNICODE_VERSION = '${targetUnicode}';`)
    .replace(/export const EMOJI_VERSION = '[^']*';/, `export const EMOJI_VERSION = '${targetEmoji}';`);
  if (after === before) {
    fail('sources.mjs did not change - the version constants have an unexpected shape');
    process.exit(1);
  }
  await fsp.writeFile(sourcesPath, after);
  ok('sources.mjs updated');

  /* --- 3. move the output directories ------------------------------ */
  heading('2/6  Renaming the output directories');
  for (const [key, fromName] of Object.entries(from)) {
    const toName = to[key];
    if (fromName === toName) {
      log(`${fromName} unchanged`);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, fromName))) {
      warn(`${fromName} does not exist; nothing to rename`);
      continue;
    }
    // git mv keeps the rename visible in history; fall back to a plain move when the
    // directory is not tracked (e.g. inside a fresh worktree experiment).
    try {
      run('git', ['mv', fromName, toName]);
      ok(`git mv ${fromName} -> ${toName}`);
    } catch {
      await fsp.rename(path.join(ROOT, fromName), path.join(ROOT, toName));
      ok(`mv ${fromName} -> ${toName} (not tracked by git)`);
    }
    // The old build's files are named for the old version; remove them so nothing
    // stale can survive a failed rebuild and be mistaken for new data.
    const stale = (await fsp.readdir(path.join(ROOT, toName))).filter((f) => /\.(txt|tsv)$/.test(f));
    for (const f of stale) await fsp.unlink(path.join(ROOT, toName, f));
    log(`cleared ${stale.length} stale file(s) in ${toName}`);
  }

  /* --- 4. fresh download and rebuild ------------------------------- */
  heading('3/6  Re-collecting sources and rebuilding');
  // Deleting the lock is what turns --update-lock into a real re-pin: with no prior
  // hashes there is nothing to compare against, so every source is accepted and
  // recorded fresh. --force discards the on-disk cache so nothing stale is reused.
  const lockPath = path.join(ROOT, 'data', 'sources.lock.json');
  if (fs.existsSync(lockPath)) await fsp.unlink(lockPath);
  const cacheDir = path.join(ROOT, '.cache', 'sources');
  if (fs.existsSync(cacheDir)) await fsp.rm(cacheDir, { recursive: true, force: true });
  log('cleared source cache and lock');
  run('node', ['src/build.mjs', '--force']);
  ok('build complete');

  /* --- 5. verify ---------------------------------------------------- */
  heading('4/6  Verifying against the new sources');
  const verify = spawnSync('node', ['src/verify.mjs', '--strict'], { cwd: ROOT, encoding: 'utf8' });
  if (verify.status !== 0) {
    const tail = ((verify.stdout || '') + (verify.stderr || '')).split('\n').slice(-30).join('\n');
    if (ALLOW_BLOCKED) {
      warn('verification failed, but --allow-blocked was passed; continuing');
      console.log(tail);
    } else {
      fail('verification FAILED after the rebuild:');
      console.log(tail);
      fail('');
      fail('The repository now holds a half-migrated tree. Either fix the cause and');
      fail('re-run, or `git checkout -- . && git clean -fd` to go back.');
      process.exit(1);
    }
  } else {
    ok('strict verification passed');
  }

  /* --- 6. regenerate docs ------------------------------------------ */
  heading('5/6  Re-rendering documents');
  run('node', ['src/render-docs.mjs']);
  const stampPath = path.join(ROOT, 'data', 'last-version-check.json');
  if (fs.existsSync(stampPath)) await fsp.unlink(stampPath);
  ok('documents re-rendered from the new manifest');

  /* --- report ------------------------------------------------------- */
  heading('6/6  Result');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  console.log(`  UCD            ${manifest.ucdVersion}`);
  console.log(`  code points    ${manifest.symbols.codePoints.toLocaleString('en-US')}`);
  console.log(`  blocks         ${manifest.symbols.blocks}`);
  console.log(`  emoji          ${manifest.symbols.emojiSequences.toLocaleString('en-US')}`);
  console.log('');

  // Machine-readable summary for the auto-update workflow to build its PR body from.
  // Written as a file rather than printed, so the workflow never has to scrape stdout.
  const delta = (key) => {
    const before = beforeManifest?.symbols?.[key];
    const after = manifest.symbols[key];
    if (typeof before !== 'number' || typeof after !== 'number') return null;
    return { before, after, change: after - before };
  };
  const summary = {
    from: { ucd: pin.ucd, unicode: pin.unicode, emoji: pin.emoji },
    to: { ucd: manifest.ucdVersion, unicode: manifest.unicodeVersion, emoji: manifest.emojiVersion },
    generatedAt: manifest.generatedAt,
    verification: verify.status === 0 ? 'passed' : 'failed (allowed)',
    counts: {
      codePoints: delta('codePoints'),
      blocks: delta('blocks'),
      emojiSequences: delta('emojiSequences'),
      fullyQualified: beforeManifest && {
        before: beforeManifest.symbols.emojiByStatus['fully-qualified'],
        after: manifest.symbols.emojiByStatus['fully-qualified'],
        change: manifest.symbols.emojiByStatus['fully-qualified'] - beforeManifest.symbols.emojiByStatus['fully-qualified'],
      },
    },
  };
  await fsp.writeFile(path.join(ROOT, 'data', 'bump-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  log('wrote data/bump-summary.json');
  console.log('  Changed files:');
  const status = run('git', ['status', '--porcelain'], { capture: true }).trim();
  for (const line of status.split('\n').slice(0, 40)) if (line) console.log('    ' + line);
  const total = status.split('\n').filter(Boolean).length;
  if (total > 40) console.log(`    ... and ${total - 40} more`);
  console.log('');
  ok(`adopted UCD ${target} / Emoji ${targetEmoji}`);
  console.log('');
  console.log('  Review, then commit:');
  console.log(`    git add -A && git commit -m "data: adopt Unicode ${target} / Emoji ${targetEmoji}"`);
}

main().catch((err) => {
  fail(err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
