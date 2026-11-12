#!/usr/bin/env node
/**
 * Regenerate data/block-names-zh.json from Blocks.txt.
 *
 * The Chinese names are curated (there is no official Chinese block name list in
 * the UCD), so this script never invents them: it reads the existing table, keeps
 * every translation it finds, and reports blocks that still need a human to fill
 * them in. That keeps the curated part curated while making the *coverage* of the
 * table a checked property rather than something discovered by eye.
 *
 *   node tools/sync-block-names-zh.mjs           # report only
 *   node tools/sync-block-names-zh.mjs --write   # add missing blocks with ''
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRangeFile } from '../src/lib/parse-ucd.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'sources', 'Blocks.txt');
const TABLE = path.join(ROOT, 'data', 'block-names-zh.json');

if (!fs.existsSync(CACHE)) {
  console.error('missing ' + CACHE + ' — run `node src/build.mjs` first');
  process.exit(1);
}

const blocks = parseRangeFile(fs.readFileSync(CACHE, 'utf8')).map((b) => b.value);
const table = fs.existsSync(TABLE) ? JSON.parse(fs.readFileSync(TABLE, 'utf8')) : {};

const missing = blocks.filter((b) => !table[b]);
const stale = Object.keys(table).filter((b) => !blocks.includes(b));

console.log('blocks in Blocks.txt : ' + blocks.length);
console.log('translations present : ' + (blocks.length - missing.length));
console.log('missing              : ' + missing.length);
for (const b of missing) console.log('  - ' + b);
if (stale.length) {
  console.log('stale entries (not in Blocks.txt): ' + stale.length);
  for (const b of stale) console.log('  ! ' + b);
}

if (process.argv.includes('--write')) {
  const next = {};
  for (const b of blocks) next[b] = table[b] ?? '';
  fs.writeFileSync(TABLE, JSON.stringify(next, null, 1) + '\n');
  console.log('wrote ' + TABLE + ' with ' + blocks.length + ' entries');
}

if (missing.length && !process.argv.includes('--write')) {
  console.log('');
  console.log('These blocks will render with the English name until a translation is added.');
  process.exit(0);
}
