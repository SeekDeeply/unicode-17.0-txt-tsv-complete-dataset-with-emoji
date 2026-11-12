import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRangeFile, parseUnicodeData, expandNamePattern, rangeLookup, isCommentLine } from './parse-ucd.mjs';
import { parseEmojiTest, countByStatus, crossCheckSequences } from './build-emoji.mjs';
import { buildCharset, hex, uplus } from './build-charset.mjs';

/* ---------------------------------------------------------------- ranges */

test('parseRangeFile handles single code points and ranges', () => {
  const out = parseRangeFile(`
# a comment
0000..007F; Basic Latin
4E00; CJK Thing # trailing comment
   0300..036F   ;   Combining Marks
`);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { start: 0, end: 0x7f, value: 'Basic Latin', extra: [] });
  assert.deepEqual(out[1], { start: 0x4e00, end: 0x4e00, value: 'CJK Thing', extra: [] });
  assert.deepEqual(out[2], { start: 0x300, end: 0x36f, value: 'Combining Marks', extra: [] });
});

test('rangeLookup finds the containing range and returns undefined in gaps', () => {
  const lookup = rangeLookup([
    { start: 0x20, end: 0x7e, value: 'Basic Latin' },
    { start: 0x4e00, end: 0x9fff, value: 'CJK' },
  ]);
  assert.equal(lookup(0x20), 'Basic Latin');
  assert.equal(lookup(0x41), 'Basic Latin');
  assert.equal(lookup(0x7f), undefined);
  assert.equal(lookup(0x4e00), 'CJK');
  assert.equal(lookup(0x9fff), 'CJK');
  assert.equal(lookup(0xa000), undefined);
});

/* ----------------------------------------------------------------- names */

test('expandNamePattern substitutes the code point, four digits minimum', () => {
  assert.equal(expandNamePattern('CJK UNIFIED IDEOGRAPH-*', 0x4e00), 'CJK UNIFIED IDEOGRAPH-4E00');
  assert.equal(expandNamePattern('TANGUT IDEOGRAPH-*', 0x17000), 'TANGUT IDEOGRAPH-17000');
  assert.equal(expandNamePattern('VARIATION SELECTOR-*', 0xe0100), 'VARIATION SELECTOR-E0100');
  assert.equal(expandNamePattern('NO PATTERN', 0x41), 'NO PATTERN');
});

test('hex never zero-pads a supplementary code point to six digits', () => {
  assert.equal(hex(0x41), '0041');
  assert.equal(hex(0x4e00), '4E00');
  assert.equal(hex(0x1f600), '1F600');
  assert.equal(hex(0xf0000), 'F0000');
  assert.equal(hex(0x10fffd), '10FFFD');
  assert.equal(uplus(0x69), 'U+0069');
});

/* -------------------------------------------------------------- UnicodeData */

test('parseUnicodeData expands First/Last pairs and keeps singles', () => {
  const text = [
    '0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;',
    'AC00;<Hangul Syllable, First>;Lo;0;L;;;;;N;;;;;',
    'D7A3;<Hangul Syllable, Last>;Lo;0;L;;;;;N;;;;;',
    'E000;<Private Use, First>;Co;0;L;;;;;N;;;;;',
    'F8FF;<Private Use, Last>;Co;0;L;;;;;N;;;;;',
  ].join('\n');
  const { singles, ranges } = parseUnicodeData(text);
  assert.ok(singles.has(0x41));
  assert.equal(singles.get(0x41).category, 'Lu');
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].label, 'Hangul Syllable');
  assert.equal(ranges[0].start, 0xac00);
  assert.equal(ranges[0].end, 0xd7a3);
  assert.equal(ranges[1].label, 'Private Use');
});

/* ------------------------------------------------------- comment-line rule */

test('isCommentLine does not mistake a rendered keycap for a comment', () => {
  // This is the exact shape of the bug that lost two rows from the old dataset.
  const keycapRow = '#\uFE0F\u20E3\t0023 FE0F 20E3\tfully-qualified\tE0.6\tkeycap: #\tSymbols\tkeycap';
  assert.equal(isCommentLine(keycapRow), false, 'a data row beginning with #️⃣ is not a comment');
  assert.equal(isCommentLine('# a real comment'), true);
  assert.equal(isCommentLine('#'), true);
  assert.equal(isCommentLine('#\tcode_point\tchar'), true, 'the column header is a comment');
  assert.equal(isCommentLine('😀\t1F600\tfully-qualified\tE1.0\tx\ty\tz'), false);
});

/* ------------------------------------------------------------------ emoji */

const EMOJI_SAMPLE = `# emoji-test.txt
# Version: 17.0
# group: Symbols
# subgroup: keycap
0023 FE0F 20E3                                 ; fully-qualified     # #\uFE0F\u20E3 E0.6 keycap: #
0023 20E3                                      ; unqualified         # #\u20E3 E0.6 keycap: #
# group: Component
# subgroup: skin-tone
1F3FB                                          ; component           # \u{1F3FB} E1.0 light skin tone
# group: Smileys & Emotion
# subgroup: face-smiling
1F600                                          ; fully-qualified     # \u{1F600} E1.0 grinning face
`;

test('parseEmojiTest keeps the two rows that start with #', () => {
  const recs = parseEmojiTest(EMOJI_SAMPLE);
  assert.equal(recs.length, 4, 'must parse all four data rows, including the keycap ones');
  assert.deepEqual(countByStatus(recs), {
    'fully-qualified': 2,
    'minimally-qualified': 0,
    unqualified: 1,
    component: 1,
  });
  const keycap = recs.find((r) => r.cpString === '0023 FE0F 20E3');
  assert.equal(keycap.name, 'keycap: #');
  assert.equal(keycap.version, '0.6');
  assert.equal(keycap.group, 'Symbols');
  assert.equal(keycap.subgroup, 'keycap');
  assert.equal(keycap.sequence, '#\uFE0F\u20E3');
});

test('parseEmojiTest splits version and name correctly for multi-codepoint sequences', () => {
  const recs = parseEmojiTest(
    '1F1E8 1F1F3 ; fully-qualified # \u{1F1E8}\u{1F1F3} E2.0 flag: China\n',
  );
  assert.equal(recs[0].name, 'flag: China');
  assert.equal(recs[0].version, '2.0');
  assert.deepEqual(recs[0].codePoints, [0x1f1e8, 0x1f1f3]);
  assert.equal(recs[0].cpString, '1F1E8 1F1F3');
});

test('crossCheckSequences reports differences in both directions', () => {
  const recs = parseEmojiTest('1F600 ; fully-qualified # \u{1F600} E1.0 grinning face\n');
  const seqTxt = ['1F600 ; Basic_Emoji', '1F601 ; Basic_Emoji'].join('\n');
  const { inTestNotSeq, inSeqNotTest } = crossCheckSequences(recs, seqTxt, null);
  assert.deepEqual(inSeqNotTest, ['1F601']);
  assert.deepEqual(inTestNotSeq, []);
});

/* ------------------------------------------------------------- charset */

test('buildCharset enumerates Hangul/Tangut but only brackets private use', () => {
  const ucd = [
    '0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;',
    'AC00;<Hangul Syllable, First>;Lo;0;L;;;;;N;;;;;',
    'AC02;<Hangul Syllable, Last>;Lo;0;L;;;;;N;;;;;',
    'E000;<Private Use, First>;Co;0;L;;;;;N;;;;;',
    'E002;<Private Use, Last>;Co;0;L;;;;;N;;;;;',
  ].join('\n');
  const derivedName = [
    '0041 ; LATIN CAPITAL LETTER A',
    'AC00..AC02 ; HANGUL SYLLABLE *',
  ].join('\n');
  const derivedCategory = [
    '0041 ; Lu',
    'AC00..AC02 ; Lo',
    'E000..E002 ; Co',
  ].join('\n');
  const blocks = '0000..007F; Basic Latin\nAC00..D7AF; Hangul Syllables\nE000..F8FF; Private Use Area\n';
  const scripts = '0000..007F ; Common\nAC00..D7AF ; Hangul\nE000..F8FF ; Unknown\n';
  const propList = 'FDD0..FDEF ; Noncharacter_Code_Point\n';
  const aliases = '0041;LATIN CAPITAL LETTER A;correction\n';

  const { rows } = buildCharset({
    unicodeDataTxt: ucd,
    derivedNameTxt: derivedName,
    derivedGeneralCategoryTxt: derivedCategory,
    blocksTxt: blocks,
    scriptsTxt: scripts,
    nameAliasesTxt: aliases,
    propListTxt: propList,
  });
  const cps = rows.map((r) => r.cp);
  assert.ok(cps.includes(0xac01), 'Hangul interior code point must be enumerated');
  assert.ok(!cps.includes(0xe001), 'private-use interior must NOT be enumerated');
  assert.ok(cps.includes(0xe000) && cps.includes(0xe002), 'private-use boundaries must be present');
  assert.ok(cps.includes(0xfdd0), 'noncharacters must be present');

  const hangul = rows.find((r) => r.cp === 0xac01);
  assert.equal(hangul.name, 'HANGUL SYLLABLE AC01');
  assert.equal(hangul.category, 'Lo');
  assert.equal(hangul.block, 'Hangul Syllables');

  const pua = rows.find((r) => r.cp === 0xe000);
  assert.equal(pua.type, 'private-use');
});

test('buildCharset escapes nothing itself but reports correct categories', () => {
  const { rows } = buildCharset({
    // 15 fields, exactly as in the real UnicodeData.txt
    unicodeDataTxt: '0009;<control>;Cc;0;S;;;;;N;CHARACTER TABULATION;;;;',
    derivedNameTxt: '0020 ; SPACE',
    derivedGeneralCategoryTxt: '0009 ; Cc',
    blocksTxt: '0000..007F; Basic Latin',
    scriptsTxt: '0009 ; Common',
    nameAliasesTxt: '0009;CHARACTER TABULATION;control\n0009;TAB;abbreviation',
    propListTxt: '',
  });
  const tab = rows.find((r) => r.cp === 9);
  assert.equal(tab.type, 'control');
  assert.equal(tab.category, 'Cc');
  assert.equal(tab.name, 'CHARACTER TABULATION', 'NameAliases supplies the formal name for controls');
});
