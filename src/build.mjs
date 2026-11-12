#!/usr/bin/env node
/**
 * Build the entire Unicode 17.0 + Emoji 17.0 dataset from official UCD sources.
 *
 *   node src/build.mjs                 # build, verifying the source lock
 *   node src/build.mjs --force         # re-download every source first
 *   node src/build.mjs --update-lock   # accept upstream changes into the lock
 *   node src/build.mjs --offline       # use the cache only, no network
 *   node src/build.mjs --check         # build into a temp dir and diff, write nothing
 *
 * The build is deterministic: same sources + same version => byte-identical output.
 * Anything non-deterministic (timestamps) is taken from SOURCE_DATE_EPOCH when set,
 * otherwise from the pinned build date in data/sources.lock.json, so CI reruns
 * never produce spurious diffs.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { syncSources } from './lib/sync-sources.mjs';
import { parseRangeFile } from './lib/parse-ucd.mjs';
import { buildCharset, hex, uplus } from './lib/build-charset.mjs';
import { parseEmojiTest, countByStatus, crossCheckSequences, EMOJI_STATUSES } from './lib/build-emoji.mjs';
import * as W from './lib/writers.mjs';
import { EMOJI_VERSION, UNICODE_VERSION, UCD_VERSION } from './lib/sources.mjs';
import { head, info, ok, warn, fail, log } from './lib/log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------------- utilities */

const args = new Set(process.argv.slice(2));
const FLAGS = {
  force: args.has('--force'),
  updateLock: args.has('--update-lock'),
  offline: args.has('--offline'),
  check: args.has('--check'),
};

const escapeMap = { 0x09: '\\t', 0x0a: '\\n', 0x0d: '\\r', 0x5c: '\\\\' };

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;

/**
 * Lossless escaped form used by the `escaped` TSV column.
 *   TAB/CR/LF -> \\t \\n \\r      backslash -> \\\\
 *   other C0/C1 controls and lone surrogates -> \\u{XXXX}
 *   everything else -> the literal character
 *
 * Surrogates are escaped rather than emitted because a lone surrogate is not
 * valid UTF-8: writing one produces U+FFFD and silently corrupts the value.
 */
function escapeChar(cp) {
  if (escapeMap[cp]) return escapeMap[cp];
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || isSurrogate(cp)) {
    return `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
  }
  return String.fromCodePoint(cp);
}

/**
 * Value that is safe inside a TSV cell or a human-readable listing: it never
 * contains a raw TAB, CR or LF, and it is always valid UTF-8, so a row is always
 * exactly one line with exactly one column per field.
 */
function displayChar(cp) {
  if (cp === 0x09) return '\\t';
  if (cp === 0x0a) return '\\n';
  if (cp === 0x0d) return '\\r';
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || isSurrogate(cp)) return '·';
  return String.fromCodePoint(cp);
}

/**
 * Representation used inside the "one continuous string" files, where every
 * code point is normally emitted literally. Four substitutions keep those files
 * honest — the file stays exactly one line, stays valid UTF-8, and can be
 * decoded back to the exact code point sequence:
 *   U+000A -> <LF>     U+000D -> <CR>     surrogate -> <U+XXXX>
 */
function stringSafeChar(cp) {
  if (cp === 0x0a) return '<LF>';
  if (cp === 0x0d) return '<CR>';
  if (isSurrogate(cp)) return `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
  return String.fromCodePoint(cp);
}

/**
 * Build timestamp, always taken from a pin rather than "now", so that running
 * the build twice on unchanged sources produces byte-identical files (otherwise
 * every CI run would open a spurious diff and invalidate every checksum).
 * Precedence: SOURCE_DATE_EPOCH (reproducible-builds convention) > lock buildDate.
 */
function buildTimestamp(lock) {
  const raw = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : lock?.buildDate;
  if (!raw) return '1970-01-01 00:00:00 UTC';
  const d = new Date(raw);
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')} UTC`;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function writeIfChanged(filePath, content, stats) {
  const buf = Buffer.from(content, 'utf8');
  const hash = sha256(buf);
  let existing = null;
  try {
    existing = await fsp.readFile(filePath);
  } catch {}
  const existedHash = existing ? sha256(existing) : null;
  if (existedHash === hash) {
    stats.unchanged.push(path.relative(ROOT, filePath));
  } else {
    if (FLAGS.check) {
      stats.changed.push(path.relative(ROOT, filePath));
    } else {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, buf);
      stats.written.push(path.relative(ROOT, filePath));
    }
  }
  stats.files.push({ file: path.relative(ROOT, filePath).split(path.sep).join('/'), bytes: buf.length, sha256: hash, lines: content.split('\n').length - (content.endsWith('\n') ? 1 : 0) });
  return { hash, bytes: buf.length };
}

/* -------------------------------------------------------------------- main */

async function main() {
  const t0 = Date.now();
  const stats = { written: [], unchanged: [], changed: [], files: [] };

  head(`Unicode ${UNICODE_VERSION} + Emoji ${EMOJI_VERSION} dataset build`);
  info(`workspace: ${ROOT}`);
  if (FLAGS.check) info('check mode: nothing will be written');

  /* 1. sync sources ------------------------------------------------------- */
  head('1/5  Syncing official sources');
  const { cacheDir } = await syncSources({
    root: ROOT,
    force: FLAGS.force,
    updateLock: FLAGS.updateLock,
    offline: FLAGS.offline,
  });
  const read = (f) => fs.readFileSync(path.join(cacheDir, f), 'utf8');

  const lockPath = path.join(ROOT, 'data', 'sources.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  const generatedAt = buildTimestamp(lock);
  info(`build timestamp: ${generatedAt} (deterministic)`);

  /* 2. build the character table ------------------------------------------ */
  head('2/5  Building character table');
  const { rows, blockRanges, noncharacterCount } = buildCharset({
    unicodeDataTxt: read('UnicodeData.txt'),
    derivedNameTxt: read('DerivedName.txt'),
    derivedGeneralCategoryTxt: read('DerivedGeneralCategory.txt'),
    blocksTxt: read('Blocks.txt'),
    scriptsTxt: read('Scripts.txt'),
    nameAliasesTxt: read('NameAliases.txt'),
    propListTxt: read('PropList.txt'),
  });

  const zhMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'block-names-zh.json'), 'utf8'));

  // attach the derived display strings every writer needs
  for (const r of rows) {
    r.blockZh = zhMap[r.block] ?? r.block;
    r.escaped = escapeChar(r.cp);
    r.escapedChar = displayChar(r.cp);
    r.displayChar = displayChar(r.cp);
    r.literalChar = stringSafeChar(r.cp);
  }

  // sanity: the translation table must cover every block actually used
  const usedBlocks = new Set(rows.map((r) => r.block));
  const untranslated = [...usedBlocks].filter((b) => !zhMap[b] && b !== 'No_Block');
  if (untranslated.length) {
    warn(`${untranslated.length} block(s) have no Chinese name: ${untranslated.slice(0, 8).join(', ')}`);
  }

  const byType = rows.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
    return acc;
  }, {});
  info(`code points: ${rows.length}  ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  info(`blocks used: ${usedBlocks.size}   noncharacters: ${noncharacterCount}`);

  const blockCount = blockRanges.length;
  const charsetMeta = {
    title: `Unicode ${UNICODE_VERSION} complete character set — machine-readable TSV`,
    unicodeVersion: UNICODE_VERSION,
    generatedAt,
    sourceSummary: `UCD ${UCD_VERSION}: UnicodeData.txt, DerivedName.txt, Blocks.txt, Scripts.txt, NameAliases.txt, PropList.txt`,
    blockCount,
    zh: zhMap,
  };

  /* 3. build emoji tables ------------------------------------------------- */
  head('3/5  Building emoji tables');
  const emojiRecords = parseEmojiTest(read('emoji-test.txt'), { sourceUrl: 'https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt' });
  const counts = countByStatus(emojiRecords);
  info(`sequences: ${emojiRecords.length}  ${EMOJI_STATUSES.map((s) => `${s}=${counts[s]}`).join('  ')}`);

  const singleRecords = emojiRecords.filter((r) => r.codePoints.length === 1);
  const singleCounts = countByStatus(singleRecords);

  // Cross-check against the sequence files, reported not enforced: emoji-test is normative.
  const xcheck = crossCheckSequences(
    emojiRecords,
    fs.existsSync(path.join(cacheDir, 'emoji-sequences.txt')) ? read('emoji-sequences.txt') : null,
    fs.existsSync(path.join(cacheDir, 'emoji-zwj-sequences.txt')) ? read('emoji-zwj-sequences.txt') : null,
  );
  if (xcheck.inTestNotSeq.length || xcheck.inSeqNotTest.length) {
    log(
      `cross-check vs emoji-sequences/zwj: ${xcheck.inTestNotSeq.length} only-in-test, ${xcheck.inSeqNotTest.length} only-in-sequences (informational)`,
    );
  } else {
    ok('cross-check vs emoji-sequences/zwj: identical sequence sets');
  }

  const emojiMeta = {
    emojiVersion: EMOJI_VERSION,
    generatedAt,
    sourceSummary: 'emoji-test.txt (official, all four qualification statuses)',
    counts,
    singleCounts,
    groupCount: new Set(emojiRecords.map((r) => r.group)).size,
    subgroupCount: new Set(emojiRecords.map((r) => r.group + '\u0000' + r.subgroup)).size,
  };

  /* 4. write ------------------------------------------------------------- */
  head(`4/5  Writing ${FLAGS.check ? '(diff only)' : 'dataset files'}`);

  // Directory and file names are derived from the version constants, so adopting a
  // new release means editing src/lib/sources.mjs and nothing else. `git mv` the two
  // directories by hand when the version changes (git tracks renames, CI does not).
  const UD = `Unicode-${UNICODE_VERSION}-Complete-Dataset`;
  const ED = `Emoji-${EMOJI_VERSION}-Complete-Dataset`;
  const V = UNICODE_VERSION.replace(/\./g, '.');
  const EV = EMOJI_VERSION.replace(/\./g, '.');

  const out = [
    [path.join(UD, `unicode_${V}_machine.tsv`), W.charsetTSV(rows, charsetMeta)],
    [path.join(UD, `unicode_${V}_human.txt`), W.charsetHuman(rows, charsetMeta)],
    [path.join(UD, `unicode_${V}_string.txt`), W.charsetString(rows, charsetMeta)],
    [path.join(UD, `unicode_${V}_string_blocked.txt`), W.charsetStringBlocked(rows, charsetMeta)],
    [
      path.join(UD, `unicode_${V}_blocks.txt`),
      W.charsetBlocks(
        blockRanges.map((b) => ({
          ...b,
          rangeText: `${hex(b.start)}..${hex(b.end)}`,
        })),
        charsetMeta,
      ),
    ],
    [
      path.join(ED, `emoji_${EV}_full_machine.tsv`),
      W.emojiTSV(emojiRecords, emojiMeta, {
        title: `Emoji ${EMOJI_VERSION} complete dataset — every qualification status`,
        columnNote: 'All sequences: fully-qualified + minimally-qualified + unqualified + component.',
      }),
    ],
    [path.join(ED, `emoji_${EV}_full_human.txt`), W.emojiHuman(emojiRecords, emojiMeta)],
    [
      path.join(ED, `emoji_${EV}_single_machine.tsv`),
      W.emojiTSV(singleRecords, emojiMeta, {
        title: `Emoji ${EMOJI_VERSION} — single-code-point sequences only`,
        columnNote: `Single-code-point subset: ${singleRecords.length} rows.`,
      }),
    ],
    [path.join(ED, `emoji_${EV}_single_human.txt`), W.emojiHuman(singleRecords, emojiMeta)],
    [path.join(ED, `emoji_${EV}_string.txt`), W.emojiString(singleRecords, emojiMeta)],
    [path.join(ED, `emoji_${EV}_string_annotated.txt`), W.emojiStringAnnotated(emojiRecords, emojiMeta)],
  ];

  for (const [rel, content] of out) {
    await writeIfChanged(path.join(ROOT, rel), content, stats);
  }

  /* 5. checksums + manifest ---------------------------------------------- */
  head('5/5  Checksums and manifest');

  const dataFiles = stats.files.filter((f) => /\.(txt|tsv)$/.test(f.file) && !f.file.startsWith('data/'));
  const checksumText =
    dataFiles
      .slice()
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map((f) => `${f.sha256}  ${f.file}`)
      .join('\n') + '\n';
  await writeIfChanged(path.join(ROOT, 'checksum_sha256.txt'), checksumText, stats);

  const manifest = {
    unicodeVersion: UNICODE_VERSION,
    ucdVersion: UCD_VERSION,
    emojiVersion: EMOJI_VERSION,
    generatedAt,
    sources: lock?.files ?? {},
    symbols: {
      codePoints: rows.length,
      byType,
      blocks: blockCount,
      noncharacters: noncharacterCount,
      emojiSequences: emojiRecords.length,
      emojiByStatus: counts,
      emojiSingleCodePoint: singleRecords.length,
      emojiSingleByStatus: singleCounts,
      emojiGroups: emojiMeta.groupCount,
      emojiSubgroups: emojiMeta.subgroupCount,
    },
    files: dataFiles
      .slice()
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map((f) => ({ path: f.file, bytes: f.bytes, lines: f.lines, sha256: f.sha256 })),
  };
  await writeIfChanged(path.join(ROOT, 'data', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', stats);

  /* report --------------------------------------------------------------- */
  head('Build report');
  for (const f of stats.files) {
    const size = f.bytes > 1048576 ? `${(f.bytes / 1048576).toFixed(2)} MB` : `${(f.bytes / 1024).toFixed(1)} KB`;
    console.log(`  ${f.file.padEnd(52)} ${String(f.lines).padStart(9)} lines  ${size.padStart(9)}`);
  }
  console.log('');
  if (FLAGS.check) {
    if (stats.changed.length) {
      fail(`${stats.changed.length} file(s) differ from what is committed:`);
      for (const f of stats.changed) console.log('   ', f);
      process.exit(1);
    }
    ok(`all ${stats.files.length} files are up to date (${stats.unchanged.length} byte-identical)`);
  } else {
    ok(`${stats.written.length} written, ${stats.unchanged.length} unchanged — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

main().catch((err) => {
  fail(err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
