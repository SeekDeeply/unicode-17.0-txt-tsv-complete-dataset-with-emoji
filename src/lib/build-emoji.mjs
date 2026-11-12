import { parseRangeFile, rangeLookup } from './parse-ucd.mjs';

/**
 * Parse emoji-test.txt (UTS #51) into ordered records.
 *
 * The official line shape is:
 *   1F600                        ; fully-qualified     # 😀 E1.0 grinning face
 *
 * The three comment fields are: the rendered sequence, the version, and the name.
 * A naive `split('#')[0]` parser works, but the naive *comment* check
 * (`line.startsWith('#')`) also drops the two legitimate rows whose rendered
 * sequence begins with U+0023 NUMBER SIGN — that is exactly the bug this
 * rewrite exists to avoid. We therefore key on "starts with a hex code point",
 * never on "does not start with #".
 */
export function parseEmojiTest(text, { sourceUrl = '' } = {}) {
  const records = [];
  let group = null;
  let subgroup = null;

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;

    const groupMatch = /^# group:\s*(.+)$/.exec(line);
    if (groupMatch) {
      group = groupMatch[1].trim();
      continue;
    }
    const subMatch = /^# subgroup:\s*(.+)$/.exec(line);
    if (subMatch) {
      subgroup = subMatch[1].trim();
      continue;
    }
    // Data lines start with a hex code point, NOT with '#'.
    if (!/^[0-9A-Fa-f]{4,6}(\s+[0-9A-Fa-f]{4,6})*\s*;/.test(line)) continue;

    const semi = line.indexOf(';');
    const codesField = line.slice(0, semi).trim();
    const rest = line.slice(semi + 1);
    const hash = rest.indexOf('#');
    const status = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
    const comment = hash >= 0 ? rest.slice(hash + 1).trim() : '';

    // comment: <rendered sequence> <version> <name>
    // the rendered sequence may itself contain spaces? No — it never does, but
    // it can be multiple code points with no space. Split off the version, which
    // is always E<number>.<number>, then everything after it is the name.
    const vm = /^(.*?)\s+E(\d+\.\d+)\s+(.*)$/.exec(comment);
    let rendered = '';
    let version = '';
    let name = '';
    if (vm) {
      rendered = vm[1];
      version = vm[2];
      name = vm[3];
    } else {
      const vm2 = /^(.*?)\s+(\d+\.\d+)\s+(.*)$/.exec(comment);
      if (vm2) {
        rendered = vm2[1];
        version = vm2[2];
        name = vm2[3];
      } else {
        rendered = comment;
      }
    }

    const codePoints = codesField.split(/\s+/).map((h) => parseInt(h, 16));
    records.push({
      codePoints,
      cpString: codePoints.map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join(' '),
      status,
      version,
      name,
      rendered,
      sequence: String.fromCodePoint(...codePoints),
      group,
      subgroup,
    });
  }
  return records;
}

export const EMOJI_STATUSES = ['fully-qualified', 'minimally-qualified', 'unqualified', 'component'];

export const STATUS_LABEL = {
  'fully-qualified': '✅ fully-qualified',
  'minimally-qualified': '⚠️ minimally-qualified',
  unqualified: '❓ unqualified',
  component: '🧩 component',
};

export const STATUS_LABEL_ZH = {
  'fully-qualified': '✅ 全限定',
  'minimally-qualified': '⚠️ 最小限定',
  unqualified: '❓ 未限定',
  component: '🧩 组件',
};

export function countByStatus(records) {
  const out = { 'fully-qualified': 0, 'minimally-qualified': 0, unqualified: 0, component: 0 };
  for (const r of records) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** Cross-check emoji-test against emoji-sequences.txt + emoji-zwj-sequences.txt. */
export function crossCheckSequences(emojiRecords, sequencesTxt, zwjTxt) {
  const fromTest = new Set(emojiRecords.map((r) => r.cpString));
  const seqs = new Set();
  for (const txt of [sequencesTxt, zwjTxt]) {
    if (!txt) continue;
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const semi = line.indexOf(';');
      if (semi < 0) continue;
      const field = line.slice(0, semi).trim();
      // entries may be "1F1E6 1F1E8" or a RANGE "1F3FB..1F3FF"
      if (field.includes('..')) {
        const [a, b] = field.split('..').map((s) => parseInt(s.trim(), 16));
        for (let cp = a; cp <= b; cp++) seqs.add(cp.toString(16).toUpperCase().padStart(4, '0'));
      } else {
        seqs.add(field.split(/\s+/).map((h) => h.toUpperCase()).join(' '));
      }
    }
  }
  const inTestNotSeq = [...fromTest].filter((s) => !seqs.has(s));
  const inSeqNotTest = [...seqs].filter((s) => !fromTest.has(s));
  return { sequenceCount: seqs.size, inTestNotSeq, inSeqNotTest };
}
