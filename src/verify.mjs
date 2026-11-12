#!/usr/bin/env node
/**
 * Independent verifier. It re-derives every expectation from the *official
 * sources*, then checks the committed dataset files. Nothing here trusts
 * build.mjs: it parses the produced files from disk, parses the sources from
 * disk, and compares. If build.mjs has a bug, this fails.
 *
 *   node src/verify.mjs            # verify committed files
 *   node src/verify.mjs --strict   # also fail on the informational warnings
 *
 * Exit code 0 = the dataset is internally consistent and complete.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parseRangeFile, parseUnicodeData, isCommentLine, SURROGATE_RANGE, PRIVATE_USE_RANGE } from './lib/parse-ucd.mjs';
import { parseEmojiTest, countByStatus, EMOJI_STATUSES } from './lib/build-emoji.mjs';
import { buildEmojiProperties } from './lib/emoji-properties.mjs';
import { UNICODE_VERSION, EMOJI_VERSION } from './lib/sources.mjs';
import { head, ok, warn, fail, info, log } from './lib/log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'sources');
const STRICT = process.argv.includes('--strict');

let checks = 0;
let failures = 0;
const warnings = [];

function check(name, condition, detail) {
  checks++;
  if (condition) return true;
  failures++;
  fail(name + (detail ? ` — ${detail}` : ''));
  return false;
}

function warning(msg) {
  warnings.push(msg);
  warn(msg);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ------------------------------------------------------ 1. parse dataset */

function parseCharsetTSV(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    if (isCommentLine(raw)) continue;
    const f = raw.split('\t');
    if (f.length !== 9) throw new Error(`TSV row has ${f.length} fields (expected 9): ${JSON.stringify(raw.slice(0, 80))}`);
    rows.push({
      codePoint: f[0],
      char: f[1],
      escaped: f[2],
      name: f[3],
      category: f[4],
      block: f[5],
      blockZh: f[6],
      script: f[7],
      type: f[8],
      cp: parseInt(f[0].replace('U+', ''), 16),
    });
  }
  return rows;
}

/* -------------------------------------------------- 2. expected from UCD */

function expectedAssignedSet() {
  const { singles, ranges } = parseUnicodeData(fs.readFileSync(path.join(CACHE, 'UnicodeData.txt'), 'utf8'));
  const set = new Map(); // cp -> 'assigned' | 'control' | 'surrogate' | 'private-use'
  for (const [cp, rec] of singles) {
    set.set(cp, rec.category === 'Cc' || rec.category === 'Cf' ? 'control' : 'assigned');
  }
  for (const r of ranges) {
    if (SURROGATE_RANGE.test(r.label)) {
      set.set(r.start, 'surrogate');
      set.set(r.end, 'surrogate');
      continue;
    }
    if (PRIVATE_USE_RANGE.test(r.label)) {
      set.set(r.start, 'private-use');
      set.set(r.end, 'private-use');
      continue;
    }
    for (let cp = r.start; cp <= r.end; cp++) set.set(cp, 'assigned');
  }
  return set;
}

function noncharacterSet() {
  const set = new Set();
  for (const r of parseRangeFile(fs.readFileSync(path.join(CACHE, 'PropList.txt'), 'utf8'))) {
    if (r.value === 'Noncharacter_Code_Point') for (let cp = r.start; cp <= r.end; cp++) set.add(cp);
  }
  return set;
}

/* ---------------------------------------------------------------- main */

async function main() {
  head('Verifying committed dataset against official Unicode sources');

  const UD = `Unicode-${UNICODE_VERSION}-Complete-Dataset`;
  const ED = `Emoji-${EMOJI_VERSION}-Complete-Dataset`;
  const V = UNICODE_VERSION;
  const EV = EMOJI_VERSION;

  /* --- files exist --------------------------------------------------- */
  const required = [
    `${UD}/unicode_${V}_machine.tsv`,
    `${UD}/unicode_${V}_human.txt`,
    `${UD}/unicode_${V}_string.txt`,
    `${UD}/unicode_${V}_string_blocked.txt`,
    `${UD}/unicode_${V}_blocks.txt`,
    `${ED}/emoji_${EV}_full_machine.tsv`,
    `${ED}/emoji_${EV}_full_human.txt`,
    `${ED}/emoji_${EV}_single_machine.tsv`,
    `${ED}/emoji_${EV}_single_human.txt`,
    `${ED}/emoji_${EV}_string.txt`,
    `${ED}/emoji_${EV}_string_annotated.txt`,
    'checksum_sha256.txt',
    'data/manifest.json',
  ];
  for (const f of required) check(`exists: ${f}`, fs.existsSync(path.join(ROOT, f)));

  /* --- checksums ----------------------------------------------------- */
  head('Checksums');
  const checksumText = read('checksum_sha256.txt');
  let sumChecked = 0;
  for (const line of checksumText.split('\n')) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (!check('checksum line well-formed', !!m, line)) continue;
    const [, expected, file] = m;
    const full = path.join(ROOT, file);
    if (!check(`checksum target exists: ${file}`, fs.existsSync(full))) continue;
    const actual = sha256(await fsp.readFile(full));
    check(`sha256: ${file}`, actual === expected, `expected ${expected.slice(0, 12)}… got ${actual.slice(0, 12)}…`);
    sumChecked++;
  }
  ok(`${sumChecked} file checksums verified`);

  /* --- character table ----------------------------------------------- */
  head('Character table');
  const tsv = parseCharsetTSV(read(`${UD}/unicode_${V}_machine.tsv`));
  info(`parsed ${tsv.length} rows from unicode_17.0_machine.tsv`);

  // strictly increasing, no duplicates
  let sorted = true;
  let dupes = 0;
  for (let i = 1; i < tsv.length; i++) {
    if (tsv[i].cp <= tsv[i - 1].cp) {
      sorted = false;
      if (tsv[i].cp === tsv[i - 1].cp) dupes++;
    }
  }
  check('rows are strictly increasing by code point', sorted, `${dupes} duplicate(s)`);

  // completeness vs UnicodeData
  const expected = expectedAssignedSet();
  const nonchars = noncharacterSet();
  const actual = new Map(tsv.map((r) => [r.cp, r.type]));

  const missingAssigned = [];
  for (const [cp, type] of expected) {
    if (!actual.has(cp)) missingAssigned.push(`U+${cp.toString(16).toUpperCase()}` + `(${type})`);
  }
  check(
    'every code point assigned in UnicodeData.txt is present',
    missingAssigned.length === 0,
    `${missingAssigned.length} missing, first: ${missingAssigned.slice(0, 6).join(', ')}`,
  );

  const missingNonchars = [...nonchars].filter((cp) => !actual.has(cp));
  check(
    `all ${nonchars.size} noncharacters are present`,
    missingNonchars.length === 0,
    `${missingNonchars.length} missing`,
  );

  // nothing invented: every row must be explainable
  const unexplainable = tsv.filter((r) => !expected.has(r.cp) && !nonchars.has(r.cp));
  check(
    'no invented code points (every row is assigned, boundary, or noncharacter)',
    unexplainable.length === 0,
    `${unexplainable.length} unexplained, e.g. ${unexplainable.slice(0, 4).map((r) => r.codePoint).join(', ')}`,
  );

  // type column agrees with the derivation
  const typeMismatch = [];
  for (const r of tsv) {
    const want = nonchars.has(r.cp) ? 'noncharacter' : expected.get(r.cp);
    if (want && want !== r.type) typeMismatch.push(`${r.codePoint}: want ${want} got ${r.type}`);
  }
  check('type column matches derivation', typeMismatch.length === 0, typeMismatch.slice(0, 5).join('; '));

  // TSV structural integrity: no raw TAB/CR/LF inside fields, no empty cells
  const structural = tsv.filter(
    (r) =>
      /[\t\r\n]/.test(r.char) ||
      /[\t\r\n]/.test(r.name) ||
      /[\t\r\n]/.test(r.block) ||
      !r.name ||
      !r.block ||
      !r.blockZh ||
      !r.type ||
      // U+FFFD is itself a real character; only flag it on other rows, where it
      // would mean an unencodable code point got mangled into the replacement char.
      (r.char.includes('\uFFFD') && r.cp !== 0xfffd),
  );
  check('no field contains a raw TAB/CR/LF and no required field is empty', structural.length === 0, `${structural.length} bad rows`);

  // name sanity: printable, non-empty, no stray placeholder
  const badNames = tsv.filter((r) => !r.name || r.name === 'undefined' || /^<>$/.test(r.name));
  check('every row has a non-empty name', badNames.length === 0, `${badNames.length} bad`);

  // algorithmic name expansion actually happened
  const hangul = tsv.find((r) => r.cp === 0xac00);
  check('Hangul syllable names are expanded', hangul?.name.startsWith('HANGUL SYLLABLE'), hangul?.name);
  const cjk = tsv.find((r) => r.cp === 0x4e00);
  check('CJK ideograph names are expanded', cjk?.name === 'CJK UNIFIED IDEOGRAPH-4E00', cjk?.name);
  const tangut = tsv.find((r) => r.cp === 0x17000);
  check('Tangut ideograph names are expanded', tangut?.name.startsWith('TANGUT IDEOGRAPH-'), tangut?.name);

  // escaping round-trip
  const esc = (cp) => {
    if (cp === 0x09) return '\\t';
    if (cp === 0x0a) return '\\n';
    if (cp === 0x0d) return '\\r';
    if (cp === 0x5c) return '\\\\';
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff)) {
      return `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
    }
    return String.fromCodePoint(cp);
  };
  const escBad = tsv.filter((r) => esc(r.cp) !== r.escaped);
  check('escaped column round-trips for all rows', escBad.length === 0, `${escBad.length} mismatched, e.g. ${escBad[0]?.codePoint}`);

  // block coverage
  const blocks = new Set(tsv.map((r) => r.block));
  check('every row has a block', !blocks.has('') && !blocks.has(undefined));
  // The 28 noncharacters at the end of unassigned planes (U+1FFFE … U+EFFFF) sit
  // outside every block by design, so No_Block is only suspicious for other types.
  const noBlock = tsv.filter((r) => r.block === 'No_Block');
  const noBlockUnexpected = noBlock.filter((r) => r.type !== 'noncharacter');
  check('code points outside any block are exactly the plane-end noncharacters', noBlockUnexpected.length === 0, `${noBlockUnexpected.length} unexpected`);
  if (noBlock.length !== 28) warning(`${noBlock.length} No_Block code points (28 expected)`);

  /* --- string files -------------------------------------------------- */
  head('String files');

  // charset string: single line of data, and it must contain every code point
  const stringRaw = await fsp.readFile(path.join(ROOT, `${UD}/unicode_${V}_string.txt`), 'utf8');
  const stringLines = stringRaw.split('\n').filter((l) => l && !l.startsWith('#'));
  check('unicode string file has exactly one data line', stringLines.length === 1, `got ${stringLines.length}`);
  // Undo the three documented substitutions to recover the exact code point list.
  // <U+XXXX> is a surrogate placeholder; <LF>/<CR> are the actual control characters.
  const recoveredCps = [];
  const dataLine = stringLines[0] ?? '';
  const tokenRe = /<(LF|CR|U\+([0-9A-F]{4,6}))>|([\s\S])/gu;
  for (const m of dataLine.matchAll(tokenRe)) {
    if (m[1] === 'LF') recoveredCps.push(0x0a);
    else if (m[1] === 'CR') recoveredCps.push(0x0d);
    else if (m[2]) recoveredCps.push(parseInt(m[2], 16));
    else recoveredCps.push(m[3].codePointAt(0));
  }
  check(
    'unicode string reconstructs exactly the character table',
    recoveredCps.length === tsv.length && recoveredCps.every((cp, i) => cp === tsv[i].cp),
    `${recoveredCps.length} vs ${tsv.length} code points`,
  );

  // block-separated: every block present, each body equals the block's characters
  const blocked = read(`${UD}/unicode_${V}_string_blocked.txt`);
  const sections = blocked.split(/^## /m).slice(1);
  check('block-separated file has one section per block', sections.length >= blocks.size, `${sections.length} sections vs ${blocks.size} blocks`);
  // A block can appear in more than one section when a No_Block code point
  // interrupts it, so accumulate by block name before comparing.
  const gotByBlock = new Map();
  for (const sec of sections) {
    const [heading, ...rest] = sec.split('\n');
    const blockName = heading.split(' | ')[0].trim();
    const body = rest.slice(1).join('');
    if (!gotByBlock.has(blockName)) gotByBlock.set(blockName, []);
    const bucket = gotByBlock.get(blockName);
    for (const m of body.matchAll(/<(LF|CR|U\+([0-9A-F]{4,6}))>|([\s\S])/gu)) {
      if (m[1] === 'LF') bucket.push(0x0a);
      else if (m[1] === 'CR') bucket.push(0x0d);
      else if (m[2]) bucket.push(parseInt(m[2], 16));
      else bucket.push(m[3].codePointAt(0));
    }
  }
  let bodyMismatch = 0;
  for (const blockName of blocks) {
    const gotCps = gotByBlock.get(blockName) ?? [];
    const wantCps = tsv.filter((r) => r.block === blockName).map((r) => r.cp);
    if (gotCps.length !== wantCps.length || !gotCps.every((cp, i) => cp === wantCps[i])) bodyMismatch++;
  }
  check('every block section contains exactly its block characters', bodyMismatch === 0, `${bodyMismatch} block(s) mismatched`);

  // human file: one entry per code point
  const human = read(`${UD}/unicode_${V}_human.txt`);
  const humanEntries = [...human.matchAll(/^ {2}U\+([0-9A-F]{4,6}) {2}/gm)].map((m) => parseInt(m[1], 16));
  check('human file has one entry per code point', humanEntries.length === tsv.length, `${humanEntries.length} vs ${tsv.length}`);
  check(
    'human file entries are in the same order',
    humanEntries.every((cp, i) => cp === tsv[i]?.cp),
    'first divergence at index ' + humanEntries.findIndex((cp, i) => cp !== tsv[i]?.cp),
  );

  // blocks file
  // A block line is "0000..007F; Basic Latin | 基本拉丁文字". Match the range shape
  // explicitly, because a bare /^[0-9A-F]/ also matches a header line like "Blocks: 346".
  const blockLines = read(`${UD}/unicode_${V}_blocks.txt`)
    .split('\n')
    .filter((l) => /^[0-9A-F]{4,6}\.\.[0-9A-F]{4,6}; /.test(l));
  const officialBlocks = parseRangeFile(fs.readFileSync(path.join(CACHE, 'Blocks.txt'), 'utf8'));
  check('blocks file lists every official block', blockLines.length === officialBlocks.length, `${blockLines.length} vs ${officialBlocks.length}`);
  // Every block line must carry a non-empty name in the second field. A block with no
  // Chinese translation falls back to its English name, so this catches malformed
  // lines (a dangling separator or an empty field) rather than modelling the
  // translation gap, which the build warns about and the zh tool enumerates.
  const badBlockLines = blockLines.filter((l) => {
    const parts = l.split(' | ');
    return parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '';
  });
  check('every block line has a name in both fields', badBlockLines.length === 0, `${badBlockLines.length} malformed, e.g. ${badBlockLines[0] ?? ''}`);

  /* --- emoji --------------------------------------------------------- */
  head('Emoji tables');
  const official = parseEmojiTest(fs.readFileSync(path.join(CACHE, 'emoji-test.txt'), 'utf8'));
  const officialCounts = countByStatus(official);

  // isCommentLine, not startsWith('#'): two emoji rows legitimately begin with '#'
  // (the keycap sequences render as "#️⃣"). Filtering on '#' would delete them.
  const fullTsv = read(`${ED}/emoji_${EV}_full_machine.tsv`)
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .map((l) => {
      const f = l.split('\t');
      if (f.length !== 7) throw new Error(`emoji TSV row has ${f.length} fields (expected 7): ${JSON.stringify(l.slice(0, 80))}`);
      return { sequence: f[0], cps: f[1], status: f[2], version: f[3], name: f[4], group: f[5], subgroup: f[6] };
    });

  check(
    'emoji full TSV row count equals official emoji-test row count',
    fullTsv.length === official.length,
    `${fullTsv.length} vs ${official.length}`,
  );
  const fullCounts = {};
  for (const r of fullTsv) fullCounts[r.status] = (fullCounts[r.status] ?? 0) + 1;
  for (const s of EMOJI_STATUSES) {
    check(`emoji status count matches source: ${s}`, fullCounts[s] === officialCounts[s], `${fullCounts[s]} vs ${officialCounts[s]}`);
  }
  // exact set equality, not just counts
  const officialKeys = new Set(official.map((r) => r.cpString + '|' + r.status));
  const datasetKeys = new Set(fullTsv.map((r) => r.cps + '|' + r.status));
  const missingEmoji = [...officialKeys].filter((k) => !datasetKeys.has(k));
  const extraEmoji = [...datasetKeys].filter((k) => !officialKeys.has(k));
  check('no emoji sequence missing from the dataset', missingEmoji.length === 0, `${missingEmoji.length} missing: ${missingEmoji.slice(0, 5).join(', ')}`);
  check('no emoji sequence invented by the dataset', extraEmoji.length === 0, `${extraEmoji.length} extra`);

  // the keycap # rows — the two that a naive '#'-prefix filter silently deletes
  check(
    'keycap sequences beginning with U+0023 survive',
    datasetKeys.has('0023 FE0F 20E3|fully-qualified') && datasetKeys.has('0023 20E3|unqualified'),
    'keycap # rows missing',
  );

  // names / versions unchanged
  const officialByName = new Map(official.map((r) => [r.cpString + '|' + r.status, r]));
  const metaBad = fullTsv.filter((r) => {
    const o = officialByName.get(r.cps + '|' + r.status);
    return !o || o.name !== r.name || `E${o.version}` !== r.version;
  });
  check('emoji names and versions are byte-identical to the source', metaBad.length === 0, `${metaBad.length} mismatched`);

  // rendered sequence must equal the code points
  const renderBad = fullTsv.filter((r) => String.fromCodePoint(...r.cps.split(' ').map((h) => parseInt(h, 16))) !== r.sequence);
  check('rendered sequence matches its code points', renderBad.length === 0, `${renderBad.length} mismatched`);

  // Cross-check against emoji-data.txt (Emoji property). This is the reason that
  // source is in the pipeline: if a single-code-point sequence from emoji-test is
  // not marked Emoji=Yes in emoji-data.txt, one of the two upstream files is
  // internally inconsistent and we want to know before publishing.
  const emojiProps = buildEmojiProperties(fs.readFileSync(path.join(CACHE, 'emoji-data.txt'), 'utf8'));
  const notEmoji = official
    .filter((r) => r.codePoints.length === 1)
    .filter((r) => !emojiProps.isEmoji(r.codePoints[0]));
  check(
    'every single-code-point emoji sequence has Emoji=Yes in emoji-data.txt',
    notEmoji.length === 0,
    `${notEmoji.length} disagree, e.g. ${notEmoji.slice(0, 3).map((r) => r.cpString).join(', ')}`,
  );

  // single-code-point subset
  const singleTsv = read(`${ED}/emoji_${EV}_single_machine.tsv`)
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .map((l) => l.split('\t'));
  const officialSingle = official.filter((r) => r.codePoints.length === 1);
  check('single-codepoint TSV has one row per single-codepoint sequence', singleTsv.length === officialSingle.length, `${singleTsv.length} vs ${officialSingle.length}`);
  check('single-codepoint TSV contains only single code points', singleTsv.every((f) => !f[1].includes(' ')));

  // emoji string files
  const emojiStringRaw = await fsp.readFile(path.join(ROOT, `${ED}/emoji_${EV}_string.txt`), 'utf8');
  const emojiStringData = emojiStringRaw.split('\n').filter((l) => l && !l.startsWith('# '));
  check('emoji string file has exactly one data line', emojiStringData.length === 1, `got ${emojiStringData.length}`);
  const emojiConcat = singleTsv.map((f) => String.fromCodePoint(...f[1].split(' ').map((h) => parseInt(h, 16)))).join('');
  check('emoji string equals the concatenated single-code-point sequences', emojiStringData[0] === emojiConcat, 'content differs');

  const annotated = read(`${ED}/emoji_${EV}_string_annotated.txt`)
    .split('\n')
    .filter((l) => l && !l.startsWith('# '));
  const annotatedConcat = annotated.join('');
  const fullConcat = fullTsv.map((r) => r.sequence).join('');
  check('annotated emoji string concatenates to the full sequence list', annotatedConcat === fullConcat, `${annotatedConcat.length} vs ${fullConcat.length} chars`);

  // human emoji file entry count
  const emojiHumanEntries = [...read(`${ED}/emoji_${EV}_full_human.txt`).matchAll(/^ {6}(?:✅|⚠️|❓|🧩) /gm)];
  check('emoji human file has one entry per sequence', emojiHumanEntries.length === official.length, `${emojiHumanEntries.length} vs ${official.length}`);

  /* --- encoding ------------------------------------------------------ */
  head('Encoding');
  // These three properties are advertised in the README, so they are checked:
  // LF line endings only, no BOM, and every file is valid UTF-8. A CRLF or a BOM
  // would break `sha256sum -c` on a different platform and would silently change
  // what a parser sees at the start of line 1.
  for (const f of required.filter((r) => /\.(txt|tsv)$/.test(r))) {
    const buf = await fsp.readFile(path.join(ROOT, f));
    check(`valid UTF-8: ${f}`, Buffer.from(buf.toString('utf8'), 'utf8').equals(buf));
    check(`no BOM: ${f}`, !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf));
    if (f.includes('emoji_') && f.endsWith('string.txt')) {
      // emoji string data legitimately contains no line breaks at all beyond the header
      continue;
    }
    check(`LF line endings only: ${f}`, !buf.includes(0x0d));
  }

  /* --- manifest ------------------------------------------------------ */
  head('Manifest');
  const manifest = JSON.parse(read('data/manifest.json'));
  check('manifest code point count matches the TSV', manifest.symbols.codePoints === tsv.length, `${manifest.symbols.codePoints} vs ${tsv.length}`);
  check('manifest emoji count matches the TSV', manifest.symbols.emojiSequences === fullTsv.length, `${manifest.symbols.emojiSequences} vs ${fullTsv.length}`);
  check('manifest noncharacter count is 66', manifest.symbols.noncharacters === 66, String(manifest.symbols.noncharacters));
  for (const f of manifest.files) {
    const full = path.join(ROOT, f.path);
    if (!check(`manifest file exists: ${f.path}`, fs.existsSync(full))) continue;
    const buf = await fsp.readFile(full);
    check(`manifest sha256 matches on disk: ${f.path}`, sha256(buf) === f.sha256);
    check(`manifest byte size matches on disk: ${f.path}`, buf.length === f.bytes, `${buf.length} vs ${f.bytes}`);
  }

  /* --- summary ------------------------------------------------------- */
  head('Summary');
  console.log(`  checks run:  ${checks}`);
  console.log(`  failures:    ${failures}`);
  console.log(`  warnings:    ${warnings.length}`);
  console.log('');
  if (failures === 0 && (!STRICT || warnings.length === 0)) {
    ok(`dataset verified: ${tsv.length} code points, ${fullTsv.length} emoji sequences, all checksums valid`);
    process.exit(0);
  }
  if (failures === 0) {
    warn('all hard checks passed but --strict rejects the warnings above');
    process.exit(1);
  }
  fail(`${failures} check(s) failed`);
  process.exit(1);
}

main().catch((err) => {
  fail('verifier crashed: ' + err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
