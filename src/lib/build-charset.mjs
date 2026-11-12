import {
  parseRangeFile,
  parseUnicodeData,
  rangeLookup,
  expandNamePattern,
  BOUNDARY_ONLY_RANGE,
  SURROGATE_RANGE,
} from './parse-ucd.mjs';

/**
 * Build the authoritative character table: one row per code point that the
 * dataset claims to cover.
 *
 * Coverage rule (documented in README so nobody has to guess):
 *   every code point with a General_Category assignment in UnicodeData.txt,
 *   including the enumerated ranges (Hangul syllables, CJK ideographs, Tangut
 *   ideographs) — PLUS the boundary code points of the surrogate and
 *   private-use ranges, PLUS the 66 noncharacters, which are not "assigned" in
 *   UnicodeData but are a finite, officially enumerated set and are what users
 *   of a "complete" list actually look for.
 *
 * Every row carries the block (en + zh), script, and the reason it is in the file.
 */

const TYPE = {
  ASSIGNED: 'assigned',
  CONTROL: 'control',
  NONCHARACTER: 'noncharacter',
  SURROGATE: 'surrogate',
  PRIVATE_USE: 'private-use',
  UNASSIGNED: 'unassigned',
};

export { TYPE };

function humanNameFor(cp, udRec, nameLookup) {
  if (!udRec) return undefined;
  const raw = udRec.name;
  if (raw && !raw.startsWith('<')) return raw;
  // <control>, <noncharacter-FDD0>, <surrogate-D800>, <private-use-E000>, <CJK Ideograph, First> ...
  const derived = nameLookup(cp);
  if (derived) return derived;
  const alias = udRec.unicode1Name;
  if (alias && alias !== '<control>') return alias;
  return raw.replace(/^<|>$/g, '');
}

/**
 * @param {object} ctx
 * @param {string} ctx.unicodeDataTxt
 * @param {string} ctx.derivedNameTxt
 * @param {string} ctx.derivedGeneralCategoryTxt
 * @param {string} ctx.blocksTxt
 * @param {string} ctx.scriptsTxt
 * @param {string} ctx.nameAliasesTxt
 * @param {string} ctx.propListTxt
 */
export function buildCharset(ctx) {
  const { singles, ranges } = parseUnicodeData(ctx.unicodeDataTxt);

  const nameRanges = parseRangeFile(ctx.derivedNameTxt).map((r) => ({ start: r.start, end: r.end, value: r.value }));
  const nameLookup = rangeLookup(nameRanges);

  const categoryRanges = parseRangeFile(ctx.derivedGeneralCategoryTxt).map((r) => ({ start: r.start, end: r.end, value: r.value }));
  const categoryLookup = rangeLookup(categoryRanges);

  const blockRanges = parseRangeFile(ctx.blocksTxt).map((r) => ({ start: r.start, end: r.end, value: r.value }));
  const blockLookup = rangeLookup(blockRanges);

  const scriptRanges = parseRangeFile(ctx.scriptsTxt).map((r) => ({ start: r.start, end: r.end, value: r.value }));
  const scriptLookup = rangeLookup(scriptRanges);

  // Noncharacter_Code_Point from PropList.txt
  const noncharacters = new Set();
  for (const r of parseRangeFile(ctx.propListTxt)) {
    if (r.value === 'Noncharacter_Code_Point') {
      for (let cp = r.start; cp <= r.end; cp++) noncharacters.add(cp);
    }
  }

  // First formal alias per code point (NameAliases.txt is ordered by type precedence).
  const aliasFirst = new Map();
  for (const r of parseRangeFile(ctx.nameAliasesTxt)) {
    if (r.value && !aliasFirst.has(r.start) && r.start === r.end) aliasFirst.set(r.start, r.value);
  }

  // --- assemble candidate code points -------------------------------------
  /** @type {Map<number, {type: string, ud: any}>} */
  const candidates = new Map();

  for (const [cp, rec] of singles) {
    candidates.set(cp, { type: rec.category === 'Cc' || rec.category === 'Cf' ? TYPE.CONTROL : TYPE.ASSIGNED, ud: rec });
  }

  for (const r of ranges) {
    if (BOUNDARY_ONLY_RANGE.test(r.label)) {
      const boundaryType = SURROGATE_RANGE.test(r.label) ? TYPE.SURROGATE : TYPE.PRIVATE_USE;
      candidates.set(r.start, { type: boundaryType, ud: null, label: r.label, boundary: 'first' });
      if (r.end !== r.start) candidates.set(r.end, { type: boundaryType, ud: null, label: r.label, boundary: 'last' });
      continue;
    }
    for (let cp = r.start; cp <= r.end; cp++) {
      candidates.set(cp, { type: TYPE.ASSIGNED, ud: null, label: r.label });
    }
  }

  for (const cp of noncharacters) {
    if (!candidates.has(cp)) candidates.set(cp, { type: TYPE.NONCHARACTER, ud: null });
  }

  // Private-use ranges in UnicodeData are declared as First/Last pairs; we keep
  // only the two boundary markers so the file documents where the zone is
  // without enumerating 131k meaningless code points.
  for (const r of ranges) {
    if (!/Private Use/i.test(r.label)) continue;
    for (let cp = r.start + 1; cp < r.end; cp++) candidates.delete(cp);
  }

  // --- emit rows -----------------------------------------------------------
  const cps = [...candidates.keys()].sort((a, b) => a - b);
  const rows = [];
  for (const cp of cps) {
    const entry = candidates.get(cp);
    const block = blockLookup(cp) ?? 'No_Block';
    const script = scriptLookup(cp) ?? 'Unknown';
    const derived = nameLookup(cp);
    // General_Category comes from DerivedGeneralCategory.txt, which covers the
    // enumerated ranges (Hangul, CJK, Tangut) that UnicodeData.txt brackets.
    const category = categoryLookup(cp) ?? entry.ud?.category ?? null;
    // A code point inside a Private Use block with no Name is private-use, not
    // merely "unassigned"; keep the distinction explicit in the type column.
    const isPrivateUseBlock = /Private Use/.test(block);
    const type =
      entry.type === TYPE.ASSIGNED && category === 'Co' ? TYPE.PRIVATE_USE : entry.type;

    let name;
    let isPattern = false;
    switch (type) {
      case TYPE.CONTROL: {
        const alias = aliasFirst.get(cp);
        name = alias ?? (derived ? expandNamePattern(derived, cp) : '<control>');
        break;
      }
      case TYPE.NONCHARACTER:
        name = `<noncharacter-${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
        break;
      case TYPE.SURROGATE:
        name = `<surrogate-${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
        break;
      case TYPE.PRIVATE_USE:
        name = derived ? expandNamePattern(derived, cp) : `<private-use-${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
        break;
      default: {
        if (derived) {
          isPattern = derived.includes('*');
          name = expandNamePattern(derived, cp);
        } else if (entry.ud?.name && !entry.ud.name.startsWith('<')) {
          name = entry.ud.name;
        } else {
          name = `<unassigned-${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
        }
      }
    }

    rows.push({
      cp,
      name,
      type,
      category,
      script,
      block,
      blockZh: null, // filled by build.mjs from translation table
      pattern: isPattern,
      boundary: entry.boundary ?? null,
    });
  }

  return { rows, blockRanges, nameRanges, noncharacterCount: noncharacters.size };
}

/**
 * Hex code point, four digits minimum and only as many more as the value needs
 * (U+0069, U+4E00, U+1F600, U+F0000, U+10FFFD). Never zero-pads to six, because
 * U+0F0000 is not a valid Unicode code point notation anyone publishes.
 */
export function hex(cp) {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

/** U+XXXX canonical form used in the human-readable files. */
export function uplus(cp) {
  return `U+${hex(cp)}`;
}

export function codePointToString(cp) {
  return String.fromCodePoint(cp);
}
