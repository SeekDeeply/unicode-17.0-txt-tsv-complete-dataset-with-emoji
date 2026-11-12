# Unicode 17.0 + Emoji 17.0 - Complete Dataset (TXT / TSV)

[![build & verify](https://github.com/SeekDeeply/unicode-17.0-txt-tsv-complete-dataset-with-emoji/actions/workflows/build.yml/badge.svg)](https://github.com/SeekDeeply/unicode-17.0-txt-tsv-complete-dataset-with-emoji/actions/workflows/build.yml)
[![code points](https://img.shields.io/badge/code%20points-159,944-blue)](#unicode-17.0-dataset)
[![emoji](https://img.shields.io/badge/emoji%20sequences-5,225-orange)](#emoji-17.0-dataset)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Every byte in this repository is **generated from the official Unicode Character Database**
by the pipeline in `src/`, and every build is reproducible. Nothing is hand-edited, and no
statistic in this file was typed by a human.

```bash
npm run build      # fetch official sources, regenerate all data files
npm run verify     # independent checks against those sources
npm test           # unit tests for the parsers
```

---

## What is in here

| | |
|---|---|
| **Code points** | 159,944 - every assigned character, every control, all 66 noncharacters, plus surrogate and private-use boundaries |
| **Blocks** | 346 |
| **Emoji sequences** | 5,225 - every qualification status, not only the recommended ones |
| **Source** | UCD 17.0.0, Emoji 17.0 |
| **Reproducible** | yes - same sources in, byte-identical files out |

---

## Unicode 17.0 dataset

`Unicode-17.0-Complete-Dataset/`

| file | lines | size | use it for |
|---|---:|---:|---|
| `unicode_17.0_machine.tsv` | 159,961 | 18.10 MB | programmatic import - one row per code point, 9 tab-separated columns |
| `unicode_17.0_human.txt` | 641,535 | 13.47 MB | reading and printing - grouped by block, one paragraph per character |
| `unicode_17.0_string.txt` | 6 | 568.7 KB | string processing - all 159,944 characters concatenated into one line |
| `unicode_17.0_string_blocked.txt` | 1,408 | 596.5 KB | per-block strings - one section per block |
| `unicode_17.0_blocks.txt` | 354 | 18.0 KB | the block table, with English and Chinese names |

### Coverage rule

A code point is in the dataset when it is one of:

1. **assigned** - it has a General_Category in `UnicodeData.txt`. This includes the ranges that
   `UnicodeData.txt` only brackets with `<X, First>` / `<X, Last>` - all 11,172 Hangul
   syllables, 6,144 Tangut ideographs and every CJK ideograph from Extension A through J.
   Those are expanded, one row each, with their algorithmic names.
2. **a boundary** - the first and last code point of each surrogate and private-use range.
   The interior of those ranges is by definition *not* an assigned character, so listing it
   would add 131,068 meaningless rows to a "complete character set".
3. **a noncharacter** - all 66, from `U+FDD0` to `U+10FFFF`. They are not assigned,
   but they are a finite, officially enumerated set that anyone auditing text needs to identify.

### TSV columns

```text
code_point   U+XXXX / U+XXXXXX
char         the literal character; control characters appear as a midline dot placeholder here
escaped      lossless escaped form: backslash-t, backslash-n, backslash-r, or \u{XXXX}
name         the Name property, with algorithmic names expanded
category     General_Category
block        Unicode block, English
block_zh     Unicode block, Chinese
script       Script property
type         assigned | control | noncharacter | surrogate | private-use
```

```bash
# every data row has exactly 9 columns and occupies exactly one line
awk -F'\t' '!/^#/ {print $1, $4, $9}' Unicode-17.0-Complete-Dataset/unicode_17.0_machine.tsv | head
```

> **Why a separate escaped column.** TAB and LINE FEED cannot appear literally in a TSV cell:
> TAB would create a 10th column, LF would split the row in two. The previous revision wrote
> them literally, so 142,610 "rows" could not be read as 142,610 rows by any TSV parser.
> Here the code point is the key, `escaped` is the lossless value, and `char` is only a
> display aid.

---

## Emoji 17.0 dataset

`Emoji-17.0-Complete-Dataset/`

| file | lines | size | use it for |
|---|---:|---:|---|
| `emoji_17.0_full_machine.tsv` | 5,240 | 556.5 KB | all 5,225 sequences - programmatic |
| `emoji_17.0_full_human.txt` | 15,925 | 560.4 KB | all sequences - readable, grouped |
| `emoji_17.0_single_machine.tsv` | 1,415 | 93.8 KB | the 1,400 single-code-point sequences only |
| `emoji_17.0_single_human.txt` | 4,446 | 101.3 KB | single-code-point sequences - readable |
| `emoji_17.0_string.txt` | 5 | 5.5 KB | single-code-point sequences concatenated into one line |
| `emoji_17.0_string_annotated.txt` | 319 | 66.0 KB | all sequences in commented chunks of 50, readable line-wise |

### Status breakdown

| status | count | meaning |
|---|---:|---|
| fully-qualified | 3,944 | the recommended RGI emoji - what keyboards should offer |
| minimally-qualified | 1,029 | missing a variation selector; renderable but not recommended |
| unqualified | 243 | bare text symbols that have an emoji presentation |
| component | 9 | skin tones and hair components - building blocks, not standalone emoji |
| **total** | **5,225** | |

All four statuses are included. `emoji-test.txt` is the sole source, and `npm run verify`
proves the set is exactly equal to it - no sequence missing, none invented.

```bash
# the two rows a naive parser silently drops
grep -P '^#\uFE0F\u20E3|^#\u20E3' Emoji-17.0-Complete-Dataset/emoji_17.0_full_machine.tsv
```

> **Why that matters.** TSV rows are commonly filtered with a leading-hash check.
> The keycap sequences render as a hash, a variation selector and a combining keycap - so
> those **two real rows start with a hash character** and get deleted. This dataset treats a
> line as a comment only when it is a bare hash, a hash plus space, or a hash plus tab
> (see `isCommentLine` in `src/lib/parse-ucd.mjs`), and the verifier asserts both rows survive.

---

## Data integrity

`checksum_sha256.txt` covers every data file:

```bash
sha256sum -c checksum_sha256.txt
```

`data/manifest.json` records the size, line count and SHA-256 of each file plus every headline
count, and `data/sources.lock.json` pins the SHA-256 of each **upstream** file. If unicode.org ever
serves different bytes for a fixed version, the build fails instead of silently regenerating
something new.

---

## How it stays current

```text
src/lib/sources.mjs              the only place a version number lives
src/build.mjs                    fetch -> parse -> expand -> write -> checksum -> manifest
src/verify.mjs                   re-derives expectations from the sources, checks the files
src/check-upstream-version.mjs   polls unicode.org for a newer final release
src/render-docs.mjs              regenerates this README from the manifest
```

Three GitHub Actions workflows:

- **build & verify** (push / pull request) - fetches the official sources in a clean checkout,
  rebuilds, and fails if the rebuild differs by a single byte from what is committed. That is
  the guarantee that the data is not hand-edited.
- **check for new Unicode release** (weekly) - polls unicode.org and, when a newer *final*
  release ships, opens one tracking issue with the exact commands. It deliberately ignores
  draft versions: `/Public/19.0.0/` currently redirects to `/Public/draft/` and is not a release.
- **publish release** (tag) - rebuilds, verifies, confirms the rebuild matches the commit,
  then attaches the bundle to a GitHub release.

To adopt a new Unicode version:

```bash
# 1. edit src/lib/sources.mjs: UCD_VERSION / EMOJI_VERSION
# 2. rename the output directories to the new version
node src/build.mjs --force --update-lock   # download, rebuild, accept new upstream hashes
node src/verify.mjs --strict
node src/render-docs.mjs                   # docs follow the manifest automatically
```

---

## Licensing

- The **code** in `src/` is Apache-2.0 - see [LICENSE](LICENSE).
- The **data**, derived from the UCD, is under the Unicode License v3 - see [LICENSE_UNICODE](LICENSE_UNICODE).
- Attribution notes are in [NOTICE.txt](NOTICE.txt).

Unicode and the Unicode Logo are registered trademarks of Unicode, Inc. in the U.S. and other
countries.

---

Generated from UCD 17.0.0 / Emoji 17.0 at 2026-11-12 14:21:36 UTC. Every number above comes
from [data/manifest.json](data/manifest.json); run `npm run docs` to refresh it.
