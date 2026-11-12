import fs from 'node:fs';

/**
 * Is this line a comment/header line in one of our TSV files?
 *
 * The naive <code>line.startsWith('#')</code> is wrong for emoji TSVs: the
 * keycap sequences render as "#️⃣" and " #⃣", so two legitimate rows begin with
 * '#'. That one-line shortcut silently deletes real data (it is precisely how
 * the pre-automation version of this dataset lost two rows).
 *
 * So we only treat a line as a comment when it cannot be a data row:
 * a bare '#', '# text', or a '#\t'-prefixed header. A data row always contains
 * at least two tabs.
 */
export function isCommentLine(line) {
  if (!line) return true;
  if (line === '#') return true;
  if (line.startsWith('# ') || line.startsWith('#\t')) return true;
  // Final guard: anything without a tab inside a TSV is not a data row.
  return !line.includes('\t');
}

/** Parse `0000..007F; Name` style files into [{start, end, value}]. */
export function parseRangeFile(text, { fields = 2 } = {}) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const hash = line.indexOf('#');
    const body = (hash >= 0 ? line.slice(0, hash) : line).trim();
    if (!body) continue;
    const parts = body.split(';').map((s) => s.trim());
    if (parts.length < fields) continue;
    const [range, ...rest] = parts;
    const m = /^([0-9A-Fa-f]{4,6})(?:\.\.([0-9A-Fa-f]{4,6}))?$/.exec(range);
    if (!m) continue;
    const start = parseInt(m[1], 16);
    const end = m[2] ? parseInt(m[2], 16) : start;
    out.push({ start, end, value: rest[0], extra: rest.slice(1) });
  }
  return out;
}

/** Build a range lookup: lookup(cp) -> value. */
export function rangeLookup(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return (cp) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = sorted[mid];
      if (cp < r.start) hi = mid - 1;
      else if (cp > r.end) lo = mid + 1;
      else return r.value;
    }
    return undefined;
  };
}

/**
 * Expand a Name pattern: "CJK UNIFIED IDEOGRAPH-*" with cp 0x4E12 -> "CJK UNIFIED IDEOGRAPH-4E12".
 * Four hex digits minimum, six when the code point needs it.
 */
export function expandNamePattern(pattern, cp) {
  if (!pattern.includes('*')) return pattern;
  const hex = cp.toString(16).toUpperCase().padStart(4, '0');
  return pattern.replace(/\*/g, hex);
}

/**
 * Parse UnicodeData.txt the way UAX #44 intends:
 * <X, First> / <X, Last> pairs describe a range and must be expanded, except for
 * surrogate and private-use ranges which we keep as boundary markers.
 */
export function parseUnicodeData(text) {
  const lines = text.split('\n');
  const singles = new Map(); // cp -> record
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(';');
    if (f.length < 15) continue;
    const cp = parseInt(f[0], 16);
    const name = f[1];
    const rec = {
      cp,
      name,
      category: f[2],
      combiningClass: parseInt(f[3], 10) || 0,
      bidi: f[4],
      decomposition: f[5],
      numeric: f[8],
      mirrored: f[9] === 'Y',
      unicode1Name: f[10],
      isoComment: f[11],
      upper: f[12],
      lower: f[13],
      title: f[14],
    };
    if (name.endsWith(', First>')) {
      const last = parseInt(lines[i + 1].split(';')[0], 16);
      ranges.push({ start: cp, end: last, label: name.replace(/^</, '').replace(/, First>$/, ''), ...rec });
      i++;
      continue;
    }
    if (name.endsWith(', Last>')) continue;
    singles.set(cp, rec);
  }
  return { singles, ranges };
}

/**
 * UnicodeData.txt declares four kinds of First/Last range. Two are enumerated
 * (CJK/Tangut ideographs and Hangul syllables — every code point is a real
 * character), two are boundary-only (surrogates and private use — the interior
 * is by definition not an assigned character and enumerating it would just add
 * 131,000 meaningless rows to a "complete character set").
 */
export const SURROGATE_RANGE = /Surrogate/i;
export const PRIVATE_USE_RANGE = /Private Use/i;
export const BOUNDARY_ONLY_RANGE = /Surrogate|Private Use/i;

/** Read a file from the source cache. */
export function readSource(cacheDir, file) {
  return fs.readFileSync(`${cacheDir}/${file}`, 'utf8');
}
