/**
 * Central manifest of every upstream artifact the dataset is derived from.
 *
 * Two rules keep this honest:
 *   1. Nothing is generated from hand-maintained data — every byte comes from a
 *      URL listed here.
 *   2. Every URL carries a pinned sha256 in data/sources.lock.json, so a build is
 *      reproducible and a silent upstream change fails loudly instead of
 *      corrupting the dataset.
 */

/** Unicode version this dataset targets. Bumped by tools/check-version. */
export const UCD_VERSION = '18.0.0';
export const UNICODE_VERSION = '18.0';
export const EMOJI_VERSION = '18.0';

const UCD = `https://www.unicode.org/Public/${UCD_VERSION}/ucd`;
const UCDROOT = `https://www.unicode.org/Public/${UCD_VERSION}`;

/**
 * Emoji data does not live at one stable path across releases.
 *
 *   17.0.0  ->  /Public/17.0.0/emoji/emoji-test.txt   (UCD-rooted)
 *   16.0.0  ->  /Public/emoji/16.0/emoji-test.txt     (Emoji-rooted)
 *
 * Both layouts have been used, and which one applies depends on the release, so a
 * single hard-coded URL silently breaks the moment the pin moves. Each emoji
 * source therefore lists candidate URLs in preference order; the first one that
 * serves the file wins, and the lock file records which one was actually used.
 */
const emojiCandidates = (name) => [
  `${UCDROOT}/emoji/${name}`,
  `https://www.unicode.org/Public/emoji/${EMOJI_VERSION}/${name}`,
];

/**
 * @typedef {{ key: string, url: string, urls?: string[], file: string, required: boolean, note: string }} Source
 * @type {Source[]}
 */
export const SOURCES = [
  {
    key: 'UnicodeData',
    url: `${UCD}/UnicodeData.txt`,
    file: 'UnicodeData.txt',
    required: true,
    note: 'General_Category + the authoritative assigned-code-point list and ranges',
  },
  {
    key: 'DerivedName',
    url: `${UCD}/extracted/DerivedName.txt`,
    file: 'DerivedName.txt',
    required: true,
    note: 'Name property including the algorithmically derived range patterns (CJK, Hangul, Tangut)',
  },
  {
    key: 'DerivedGeneralCategory',
    url: `${UCD}/extracted/DerivedGeneralCategory.txt`,
    file: 'DerivedGeneralCategory.txt',
    required: true,
    note: 'General_Category for every code point, including the enumerated ranges that UnicodeData.txt only brackets',
  },
  {
    key: 'Blocks',
    url: `${UCD}/Blocks.txt`,
    file: 'Blocks.txt',
    required: true,
    note: 'Block ranges and their English names',
  },
  {
    key: 'Scripts',
    url: `${UCD}/Scripts.txt`,
    file: 'Scripts.txt',
    required: true,
    note: 'Script property',
  },
  {
    key: 'NameAliases',
    url: `${UCD}/NameAliases.txt`,
    file: 'NameAliases.txt',
    required: true,
    note: 'Formal names/abbreviations for control characters and other characters lacking a Name',
  },
  {
    key: 'PropList',
    url: `${UCD}/PropList.txt`,
    file: 'PropList.txt',
    required: true,
    note: 'Noncharacter_Code_Point and other binary properties',
  },
  {
    key: 'emoji-test',
    url: emojiCandidates('emoji-test.txt')[0],
    urls: emojiCandidates('emoji-test.txt'),
    file: 'emoji-test.txt',
    required: true,
    note: 'Emoji keyboard/display test data (all four qualification statuses)',
  },
  {
    key: 'emoji-data',
    url: `${UCD}/emoji/emoji-data.txt`,
    file: 'emoji-data.txt',
    required: true,
    note: 'Emoji properties (Emoji, Emoji_Presentation, Extended_Pictographic, ...)',
  },
  {
    key: 'emoji-sequences',
    url: emojiCandidates('emoji-sequences.txt')[0],
    urls: emojiCandidates('emoji-sequences.txt'),
    file: 'emoji-sequences.txt',
    required: false,
    note: 'Basic emoji sequences (used for cross-checking emoji-test)',
  },
  {
    key: 'emoji-zwj-sequences',
    url: emojiCandidates('emoji-zwj-sequences.txt')[0],
    urls: emojiCandidates('emoji-zwj-sequences.txt'),
    file: 'emoji-zwj-sequences.txt',
    required: false,
    note: 'ZWJ emoji sequences (used for cross-checking emoji-test)',
  },
];
