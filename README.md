# Unicode 18.0 + Emoji 18.0 - Complete Dataset (TXT / TSV)

[![build & verify](https://github.com/SeekDeeply/unicode-17.0-txt-tsv-complete-dataset-with-emoji/actions/workflows/build.yml/badge.svg)](https://github.com/SeekDeeply/unicode-17.0-txt-tsv-complete-dataset-with-emoji/actions/workflows/build.yml)
[![code points](https://img.shields.io/badge/code%20points-172,951-blue)](#unicode-18.0-dataset)
[![emoji](https://img.shields.io/badge/emoji%20sequences-5,244-orange)](#emoji-18.0-dataset)
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
| **Code points** | 172,951 - every assigned character, every control, all 66 noncharacters, plus surrogate and private-use boundaries |
| **Blocks** | 353 |
| **Emoji sequences** | 5,244 - every qualification status, not only the recommended ones |
| **Source** | UCD 18.0.0, Emoji 18.0 |
| **Reproducible** | yes - same sources in, byte-identical files out |

---

## Unicode 18.0 dataset

`Unicode-18.0-Complete-Dataset/`

| file | lines | size | use it for |
|---|---:|---:|---|
| `unicode_18.0_machine.tsv` | 172,968 | 19.04 MB | programmatic import - one row per code point, 9 tab-separated columns |
| `unicode_18.0_human.txt` | 693,598 | 14.56 MB | reading and printing - grouped by block, one paragraph per character |
| `unicode_18.0_string.txt` | 6 | 619.4 KB | string processing - all 172,951 characters concatenated into one line |
| `unicode_18.0_string_blocked.txt` | 1,436 | 647.9 KB | per-block strings - one section per block |
| `unicode_18.0_blocks.txt` | 361 | 18.4 KB | the block table, with English and Chinese names |

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
awk -F'\t' '!/^#/ {print $1, $4, $9}' Unicode-18.0-Complete-Dataset/unicode_18.0_machine.tsv | head
```

> **Why a separate escaped column.** TAB and LINE FEED cannot appear literally in a TSV cell:
> TAB would create a 10th column, LF would split the row in two. The previous revision wrote
> them literally, so 142,610 "rows" could not be read as 142,610 rows by any TSV parser.
> Here the code point is the key, `escaped` is the lossless value, and `char` is only a
> display aid.

---

## Emoji 18.0 dataset

`Emoji-18.0-Complete-Dataset/`

| file | lines | size | use it for |
|---|---:|---:|---|
| `emoji_18.0_full_machine.tsv` | 5,259 | 558.4 KB | all 5,244 sequences - programmatic |
| `emoji_18.0_full_human.txt` | 15,982 | 562.1 KB | all sequences - readable, grouped |
| `emoji_18.0_single_machine.tsv` | 1,424 | 94.5 KB | the 1,409 single-code-point sequences only |
| `emoji_18.0_single_human.txt` | 4,473 | 101.9 KB | single-code-point sequences - readable |
| `emoji_18.0_string.txt` | 5 | 5.5 KB | single-code-point sequences concatenated into one line |
| `emoji_18.0_string_annotated.txt` | 319 | 66.1 KB | all sequences in commented chunks of 50, readable line-wise |

### Status breakdown

| status | count | meaning |
|---|---:|---|
| fully-qualified | 3,963 | the recommended RGI emoji - what keyboards should offer |
| minimally-qualified | 1,029 | missing a variation selector; renderable but not recommended |
| unqualified | 243 | bare text symbols that have an emoji presentation |
| component | 9 | skin tones and hair components - building blocks, not standalone emoji |
| **total** | **5,244** | |

All four statuses are included. `emoji-test.txt` is the sole source, and `npm run verify`
proves the set is exactly equal to it - no sequence missing, none invented.

### Emoji TSV columns

```text
code_points   space-separated hex code points, e.g. 0023 FE0F 20E3   <- column 1
sequence      the rendered emoji
status        fully-qualified | minimally-qualified | unqualified | component
version       the E-version the sequence was introduced in
name          CLDR short name
group         emoji-test group
subgroup      emoji-test subgroup
```

> **Why code_points is column 1 and not the rendered emoji.** The keycap sequences
> render as a hash, a variation selector and a combining enclosing keycap. With the
> rendered sequence in column 1, those two data rows would *begin with a hash
> character*, and the single most common TSV idiom - skip lines starting with a
> hash - would silently delete them. That is exactly how the previous revision of
> this dataset ended up with 5,223 rows instead of 5,225.
>
> Putting the code points first makes every data row start with a hex digit, so a
> naive filter loses nothing. The verifier asserts this: no data row begins with a
> hash, and a leading-hash filter keeps all 5,244 rows.

```bash
# both keycap rows are present, in column 2
grep -c 'keycap: #' Emoji-18.0-Complete-Dataset/emoji_18.0_full_machine.tsv
```

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
src/lib/upstream-release.mjs     what "the latest released version" means
src/build.mjs                    fetch -> parse -> expand -> write -> checksum -> manifest
src/verify.mjs                   re-derives expectations from the sources, checks the files
src/bump-version.mjs             adopts a new release end to end
src/check-upstream-version.mjs   reports whether a newer release exists (never edits)
src/render-docs.mjs              regenerates this README from the manifest
```

Adopting a new Unicode release is one command:

```bash
npm run bump:dry    # preview: which version, which files, nothing written
npm run bump -- --to 18.0.0     # adopt a specific release
npm run adopt                    # adopt whatever the newest released version is
```

That command verifies the target is a *released* version, repins `sources.mjs`,
git-renames the output directories, re-downloads every source, rebuilds, runs the strict
verifier, and re-renders the docs. If verification fails it stops and tells you how to roll back.

Three GitHub Actions workflows:

- **build & verify** (push / pull request) - fetches the official sources in a clean checkout,
  rebuilds, and fails if the rebuild differs by a single byte from what is committed. That is
  the guarantee that the data is not hand-edited.
- **auto-adopt new Unicode release** (weekly, Mondays 06:17 UTC) - the collection runs itself.
  It asks unicode.org whether a newer *released* version exists and, if so, runs
  `src/bump-version.mjs` and **commits the result to `main`**. Nobody has to be
  involved: the commit is only reached after the pipeline rebuilt every file from
  freshly downloaded sources and `src/verify.mjs --strict` passed against them, so a dataset
  that is not complete never gets committed. It ignores drafts — `/Public/19.0.0/` redirects
  to `/Public/draft/` and is not a release.
  Dispatch it manually to force a specific version, to preview with `dry_run`, or to use
  `mode: pr` for a reviewable pull request instead of a direct commit.
- **publish release** (tag) - rebuilds, verifies, confirms the rebuild matches the commit,
  then attaches the bundle to a GitHub release.

So the loop is: the weekly job notices a release, does the whole migration, and leaves a PR.
Nothing about the data is retyped by a person at any point.

---

## Licensing

- The **code** in `src/` is Apache-2.0 - see [LICENSE](LICENSE).
- The **data**, derived from the UCD, is under the Unicode License v3 - see [LICENSE_UNICODE](LICENSE_UNICODE).
- Attribution notes are in [NOTICE.txt](NOTICE.txt).

Unicode and the Unicode Logo are registered trademarks of Unicode, Inc. in the U.S. and other
countries.

---

Generated from UCD 18.0.0 / Emoji 18.0 at 2026-11-13 14:29:33 UTC. Every number above comes
from [data/manifest.json](data/manifest.json); run `npm run docs` to refresh it.
