import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmojiProperties } from './emoji-properties.mjs';

const SAMPLE = [
  '# emoji-data.txt',
  '0023          ; Emoji                # E0.0  [1] (#)       number sign',
  '1F3FB..1F3FF  ; Emoji_Modifier       # E1.0  [5] (🏻..🏿) skin tones',
  '1F600..1F64F  ; Emoji                # E1.0 [80] (😀..🙏) faces',
  '1F600..1F64F  ; Emoji_Presentation   # E1.0 [80] (😀..🙏) faces',
  '1F000..1F02B  ; Extended_Pictographic# E0.0 [44] mahjong',
].join('\n');

test('buildEmojiProperties reads Emoji, Emoji_Presentation and Extended_Pictographic', () => {
  const p = buildEmojiProperties(SAMPLE);
  assert.ok(p.properties.includes('Emoji'));
  assert.ok(p.properties.includes('Emoji_Modifier'));
  assert.ok(p.properties.includes('Extended_Pictographic'));

  assert.equal(p.isEmoji(0x23), true, 'U+0023 is an emoji text-default character');
  assert.equal(p.isEmojiPresentation(0x23), false, 'U+0023 is not emoji-presentation by default');
  assert.equal(p.isEmoji(0x1f600), true);
  assert.equal(p.isEmojiPresentation(0x1f600), true);
  assert.equal(p.isEmoji(0x4e00), false, 'a CJK ideograph is not an emoji');
  assert.equal(p.has('Emoji_Modifier', 0x1f3fd), true);
  assert.equal(p.has('Emoji_Modifier', 0x1f600), false);
  assert.equal(p.isExtendedPictographic(0x1f000), true);
  assert.equal(p.isExtendedPictographic(0x1f600), false, 'not listed in the sample');
});

test('buildEmojiProperties handles an empty file without throwing', () => {
  const p = buildEmojiProperties('# nothing here');
  assert.equal(p.isEmoji(0x1f600), false);
  assert.equal(p.has('Emoji', 0x41), false);
});
