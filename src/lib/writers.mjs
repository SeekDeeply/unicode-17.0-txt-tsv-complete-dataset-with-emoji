import { hex, uplus } from './build-charset.mjs';
import { STATUS_LABEL, STATUS_LABEL_ZH } from './build-emoji.mjs';

/**
 * Every writer here is pure: (data) -> string. Nothing touches the filesystem,
 * so writers are trivially testable and the build step owns all I/O.
 *
 * Line endings are always \n (LF) and files are always UTF-8 with no BOM, which
 * is what the checksum file and the round-trip verifier assume.
 */

export const SEP = '─'.repeat(84);
export const SEP_HEAVY = '═'.repeat(80);

/**
 * Split ascending rows into contiguous runs sharing one block. Because the rows
 * are already sorted by code point, run order == code point order, so a reader
 * streaming the file top to bottom still sees a monotonically increasing list.
 * The same block name can legitimately appear more than once (a No_Block
 * noncharacter in an unassigned plane interrupts a block range).
 */
function runs(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (!cur || cur[0].block !== r.block) {
      cur = [];
      out.push(cur);
    }
    cur.push(r);
  }
  return out;
}

export function headerBanner({ title, titleZh, lines }) {
  const out = [];
  out.push(SEP_HEAVY);
  out.push(title);
  if (titleZh) out.push(titleZh);
  out.push(SEP_HEAVY);
  for (const l of lines) out.push(l);
  out.push(SEP_HEAVY);
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ charset */

/**
 * Machine-readable TSV.
 *
 * The old file was 3 columns (char, codepoint, name) and was structurally
 * broken: U+0009 made a 4-field row and U+000A split the row in two, so no TSV
 * parser could read 142,610 rows as 142,610 rows. Rather than special-casing
 * two code points, we drop the raw character column entirely: the code point is
 * the primary key and is unambiguous. A dedicated escaped `escape` column keeps
 * a lossless, re-parseable representation of any character users want to render.
 */
export function charsetTSV(rows, meta) {
  const out = [];
  out.push(`# ${meta.title}`);
  out.push(`# Unicode version: ${meta.unicodeVersion}`);
  out.push(`# Generated: ${meta.generatedAt}`);
  out.push(`# Rows: ${rows.length}`);
  out.push('#');
  out.push('# Columns (tab-separated):');
  out.push('#   1 code_point  U+XXXX / U+XXXXXX, zero padded');
  out.push('#   2 char        the literal character; see "escape" column when it is control/TAB/LF/CR');
  out.push('#   3 escaped     lossless escaped form (\\t, \\n, \\r, \\u{XXXX}, or the literal char)');
  out.push('#   4 name        Name property (algorithmic names expanded)');
  out.push('#   5 category    General_Category');
  out.push('#   6 block       Unicode block (English)');
  out.push('#   7 block_zh    Unicode block (Chinese)');
  out.push('#   8 script      Script property value');
  out.push('#   9 type        assigned | noncharacter | surrogate | private-use');
  out.push('#');
  out.push(`#\tcode_point\tchar\tescaped\tname\tcategory\tblock\tblock_zh\tscript\ttype`);
  for (const r of rows) {
    out.push(
      [
        uplus(r.cp),
        r.escapedChar,
        r.escaped,
        r.name,
        r.category ?? '-',
        r.block,
        r.blockZh,
        r.script,
        r.type,
      ].join('\t'),
    );
  }
  return out.join('\n') + '\n';
}

/** Human-readable: one paragraph per code point, grouped under block headings. */
export function charsetHuman(rows, meta) {
  const out = [];
  out.push(headerBanner({
    title: `Unicode ${meta.unicodeVersion} Complete Character Set — Human-Readable Edition`,
    titleZh: `Unicode ${meta.unicodeVersion} 全字符总表（人类可读版）`,
    lines: [
      `Generated: ${meta.generatedAt}`,
      `Data source: ${meta.sourceSummary}`,
      `Total code points: ${rows.length}`,
      `Blocks: ${meta.blockCount}`,
    ],
  }));

  // Sections follow contiguous runs, not a global block map, so the file stays in
  // ascending code point order even where a code point outside any block
  // (No_Block, e.g. noncharacters) sits between two blocks.
  for (const list of runs(rows)) {
    const block = list[0].block;
    const zh = list[0].blockZh;
    out.push(SEP);
    out.push(`📦 ${block}${zh ? ` | ${zh}` : ''}`);
    const first = list[0].cp;
    const last = list[list.length - 1].cp;
    out.push(`   ${uplus(first)} .. ${uplus(last)}   (${list.length} code point${list.length === 1 ? '' : 's'})`);
    out.push(SEP);
    out.push('');
    for (const r of list) {
      const icon = iconFor(r);
      out.push(`  ${uplus(r.cp)}  ${r.displayChar}`);
      out.push(`      ${icon} ${r.type}   ${r.category ?? '-'}   ${r.script}`);
      out.push(`      📝 ${r.name}`);
      out.push('');
    }
  }
  return out.join('\n');
}

function iconFor(r) {
  switch (r.type) {
    case 'noncharacter': return '🚫';
    case 'surrogate': return '🔗';
    case 'private-use': return '🏠';
    case 'control': return '⚙️';
    default:
      if (r.category === 'Cc' || r.category === 'Cf') return '⚙️';
      if (/CJK|Hangul|Tangut|Nushu|Khitan/.test(r.block)) return '🈴';
      return '📌';
  }
}

/**
 * Single-line continuous string.
 *
 * The old file wrote raw control characters into the middle of the string,
 * including U+000A and U+000D, which means "one line" was a lie: `wc -l`
 * reported 0, editors reflowed it, and any tool that read it line-wise broke.
 * We keep the raw string (that is the point of the file) but neutralise the two
 * characters that would destroy its single-line property — CR and LF — and
 * escape them. Everything else, all 159k+ characters, is emitted literally.
 */
export function charsetString(rows, meta) {
  const body = rows.map((r) => r.literalChar).join('');
  const head = [
    `# Unicode ${meta.unicodeVersion} complete character string — exactly ONE data line`,
    `# Code points: ${rows.length}, in ascending order, concatenated with no separator`,
    `# Substitutions (only these three, everything else literal), so the file stays one line of valid UTF-8:`,
    `#   U+000A LINE FEED -> <LF>    U+000D CARRIAGE RETURN -> <CR>    surrogate code points -> <U+XXXX>`,
    `# Generated: ${meta.generatedAt}`,
  ].join('\n');
  return head + '\n' + body + '\n';
}

/** Block-separated strings, one block per section. */
export function charsetStringBlocked(rows, meta) {
  const out = [];
  out.push(headerBanner({
    title: `Unicode ${meta.unicodeVersion} Complete Character Set — Block-Separated Strings`,
    titleZh: `Unicode ${meta.unicodeVersion} 全字符总表（按区块分行版）`,
    lines: [`Generated: ${meta.generatedAt}`, `Blocks: ${meta.blockCount}`, `Code points: ${rows.length}`],
  }));

  for (const list of runs(rows)) {
    out.push(`## ${list[0].block}${list[0].blockZh ? ` | ${list[0].blockZh}` : ''}`);
    out.push(`   ${uplus(list[0].cp)}..${uplus(list[list.length - 1].cp)}  (${list.length} code points)`);
    out.push(list.map((r) => r.literalChar).join(''));
    out.push('');
  }
  return out.join('\n');
}

/** Block table. */
export function charsetBlocks(blockRanges, meta) {
  const out = [];
  out.push(headerBanner({
    title: `Unicode ${meta.unicodeVersion} Blocks`,
    titleZh: `Unicode ${meta.unicodeVersion} 区块列表`,
    lines: [`Generated: ${meta.generatedAt}`, `Blocks: ${blockRanges.length}`],
  }));
  for (const b of blockRanges) {
    // Never emit a dangling " | " with no name. If a block has no Chinese
    // translation yet, fall back to the English name — which is what the row table
    // (blockZh) already does — so the column is always populated and a missing
    // translation cannot produce a malformed line. build.mjs warns about it, and
    // tools/sync-block-names-zh.mjs lists exactly which blocks still need a human.
    const zh = meta.zh[b.value] ?? b.value;
    out.push(`${b.rangeText}; ${b.value} | ${zh}`);
  }
  return out.join('\n') + '\n';
}

/* -------------------------------------------------------------------- emoji */

export function emojiTSV(records, meta, { title, columnNote }) {
  const out = [];
  // NOTE: data rows may legitimately begin with '#' (keycap renders as "#️⃣").
  // Consumers must skip only "# ", "#\t" and bare "#" lines — see isCommentLine().
  out.push(`# ${title}`);
  out.push(`# Emoji version: ${meta.emojiVersion}`);
  out.push(`# Generated: ${meta.generatedAt}`);
  out.push(`# Rows: ${records.length}`);
  out.push('#');
  out.push(`# ${columnNote}`);
  out.push('#   1 sequence      rendered emoji sequence');
  out.push('#   2 code_points   space-separated hex code points');
  out.push('#   3 status        fully-qualified | minimally-qualified | unqualified | component');
  out.push('#   4 version       the E-version the sequence was introduced in');
  out.push('#   5 name          CLDR short name');
  out.push('#   6 group         emoji-test group');
  out.push('#   7 subgroup      emoji-test subgroup');
  out.push('#');
  out.push('#\tsequence\tcode_points\tstatus\tversion\tname\tgroup\tsubgroup');
  for (const r of records) {
    out.push([r.sequence, r.cpString, r.status, `E${r.version}`, r.name, r.group, r.subgroup].join('\t'));
  }
  return out.join('\n') + '\n';
}

export function emojiHuman(records, meta) {
  const out = [];
  out.push(headerBanner({
    title: `Emoji ${meta.emojiVersion} Complete Dataset — Human-Readable Edition`,
    titleZh: `Emoji ${meta.emojiVersion} 全量数据（人类可读版）`,
    lines: [
      `Generated: ${meta.generatedAt}`,
      `Data source: ${meta.sourceSummary}`,
      `Sequences: ${records.length}   (✅ ${meta.counts['fully-qualified']}  ⚠️ ${meta.counts['minimally-qualified']}  ❓ ${meta.counts.unqualified}  🧩 ${meta.counts.component})`,
      `Groups: ${meta.groupCount}   Subgroups: ${meta.subgroupCount}`,
    ],
  }));

  let group = null;
  let subgroup = null;
  for (const r of records) {
    if (r.group !== group) {
      group = r.group;
      out.push('');
      out.push(SEP);
      out.push(`📁 ${group}`);
      out.push(SEP);
    }
    if (r.subgroup !== subgroup) {
      subgroup = r.subgroup;
      out.push('');
      out.push(`  📂 ${subgroup}`);
    }
    out.push(`${r.sequence}  ${r.cpString}`);
    out.push(`      ${STATUS_LABEL[r.status]}   E${r.version}`);
    out.push(`      📝 ${r.name}`);
  }
  return out.join('\n') + '\n';
}

export function emojiString(records, meta) {
  const body = records.map((r) => r.sequence).join('');
  const head = [
    `# Emoji ${meta.emojiVersion} — every sequence concatenated into ONE line`,
    `# Sequences: ${records.length}`,
    `# Generated: ${meta.generatedAt}`,
    `# Note: all sequences are emitted literally; no separator is inserted between them.`,
  ].join('\n');
  return head + '\n' + body + '\n';
}

export function emojiStringAnnotated(records, meta, { chunk = 50 } = {}) {
  const out = [];
  const head = [
    `# Emoji ${meta.emojiVersion} — annotated chunked string`,
    `# Sequences: ${records.length}`,
    `# Chunks of ${chunk}; each line is one concatenated run, so the data can be read line-wise.`,
    `# Generated: ${meta.generatedAt}`,
    '',
  ].join('\n');
  out.push(head);
  for (let i = 0; i < records.length; i += chunk) {
    const slice = records.slice(i, i + chunk);
    out.push(`# chunk ${i / chunk + 1}: sequences ${i + 1}..${i + slice.length}`);
    out.push(slice.map((r) => r.sequence).join(''));
    out.push('');
  }
  return out.join('\n');
}
