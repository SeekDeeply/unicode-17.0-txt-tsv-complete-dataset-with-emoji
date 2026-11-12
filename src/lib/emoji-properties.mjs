import { parseRangeFile, rangeLookup } from './parse-ucd.mjs';

/**
 * Emoji property lookups from ucd/emoji/emoji-data.txt (UAX #44 / UTS #51).
 *
 * Used by the verifier as an independent cross-check on emoji-test.txt: the two
 * files come from the same release and must agree about which code points are
 * emoji. If they disagree, publishing would be publishing a contradiction.
 *
 * The data file has lines of the form:
 *   1F600..1F64F  ; Emoji                # E1.0   [80] ...
 *   1F3FB..1F3FF  ; Emoji_Modifier       # E1.0    [5] ...
 */
export function buildEmojiProperties(text) {
  const byProperty = new Map();
  for (const r of parseRangeFile(text)) {
    const name = r.value;
    if (!byProperty.has(name)) byProperty.set(name, []);
    byProperty.get(name).push({ start: r.start, end: r.end, value: name });
  }

  const lookupCache = new Map();
  const lookup = (property) => {
    if (!lookupCache.has(property)) {
      lookupCache.set(property, rangeLookup(byProperty.get(property) ?? []));
    }
    return lookupCache.get(property);
  };

  return {
    properties: [...byProperty.keys()].sort(),
    has(property, cp) {
      return lookup(property)(cp) === property;
    },
    isEmoji(cp) {
      return lookup('Emoji')(cp) === 'Emoji';
    },
    isEmojiPresentation(cp) {
      return lookup('Emoji_Presentation')(cp) === 'Emoji_Presentation';
    },
    isExtendedPictographic(cp) {
      return lookup('Extended_Pictographic')(cp) === 'Extended_Pictographic';
    },
  };
}
