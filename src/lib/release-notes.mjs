import fs from 'node:fs';
import path from 'node:path';

/**
 * Release notes, derived entirely from data/manifest.json.
 *
 * Kept separate from render-docs.mjs because the release workflow pipes it
 * straight into 'gh release create --notes-file', while render-docs writes the
 * files that ship inside the repository.
 */
export function renderReleaseNotes(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'manifest.json'), 'utf8'));
  const n = (v) => v.toLocaleString('en-US');
  const S = manifest.symbols;
  const FENCE = String.fromCharCode(96, 96, 96);

  return [
    '## Unicode ' + manifest.unicodeVersion + ' + Emoji ' + manifest.emojiVersion,
    '',
    '| | |',
    '|---|---|',
    '| code points | ' + n(S.codePoints) + ' |',
    '| blocks | ' + S.blocks + ' |',
    '| noncharacters | ' + S.noncharacters + ' |',
    '| emoji sequences | ' + n(S.emojiSequences) + ' |',
    '| fully-qualified | ' + n(S.emojiByStatus['fully-qualified']) + ' |',
    '| minimally-qualified | ' + n(S.emojiByStatus['minimally-qualified']) + ' |',
    '| unqualified | ' + n(S.emojiByStatus.unqualified) + ' |',
    '| component | ' + n(S.emojiByStatus.component) + ' |',
    '',
    'Build timestamp: ' + manifest.generatedAt,
    '',
    '### Verify',
    '',
    FENCE + 'bash',
    'sha256sum -c checksum_sha256.txt',
    '# regenerate everything from the official sources and prove it matches:',
    'node src/build.mjs && node src/verify.mjs --strict',
    FENCE,
    '',
    'data/sources.lock.json records the exact upstream SHA-256 of every input, so this',
    'release is reproducible byte for byte.',
    '',
  ].join('\n');
}
