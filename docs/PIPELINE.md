# Pipeline design notes

Why the pipeline looks the way it does. The short version: this repository
regenerates its dataset from official Unicode sources on every run, and proves
the result is complete. Every design choice below traces back to a specific
defect in the hand-maintained revision it replaced.

---

## 1. Sources are pinned by hash, not by version string

`data/sources.lock.json` stores the SHA-256 of every upstream file. A version
number alone is not a guarantee: if unicode.org were to re-cut `17.0.0`, a
version-pinned build would silently produce different data and every published
checksum would be wrong without anyone noticing. With hash pinning that case
fails loudly:

```
upstream content changed for 1 source(s) while the version pin (17.0.0) stayed the same:
  UnicodeData: locked 2e1efc1dcb59... != live ab12cd34ef56...
Re-run with --update-lock only after confirming the change is legitimate.
```

`--update-lock` is the deliberate escape hatch, used when adopting a new release.

## 2. UnicodeData ranges must be expanded, not copied

`UnicodeData.txt` does not list every Hangul syllable, Tangut ideograph or CJK
ideograph. It brackets those ranges:

```
AC00;<Hangul Syllable, First>;Lo;0;L;;;;;N;;;;;
D7A3;<Hangul Syllable, Last>;Lo;0;L;;;;;N;;;;;
```

A parser that maps each line to one row therefore loses 11,170 Hangul
syllables, 6,144 Tangut ideographs and 29 more, while still reporting a
plausible-looking total. `parseUnicodeData()` expands `First`/`Last` pairs,
except for surrogate and private-use ranges, which stay as two boundary markers
because their interior is not an assigned character.

The names for the expanded code points come from `DerivedName.txt`, which
carries the patterns (`HANGUL SYLLABLE *`, `TANGUT IDEOGRAPH-*`,
`CJK UNIFIED IDEOGRAPH-*`); `expandNamePattern()` substitutes the code point.

The verifier independently rebuilds the expected set from `UnicodeData.txt` and
asserts set equality in both directions - nothing missing, nothing invented -
so this class of bug cannot come back unnoticed.

## 3. A TSV cell can never contain a raw TAB, CR or LF

The predecessor wrote the character itself in column 1, including U+0009 and
U+000A. That produced, in one file, a row with four fields and a row split
across two lines, so the advertised row count was unreadable by any TSV parser.

Two changes:

- `char` is a *display* value: TAB, CR, LF and the C0/C1 controls become a
  placeholder, and lone surrogates become a placeholder too (a lone surrogate
  is not valid UTF-8; writing one yields U+FFFD and corrupts the value).
- `escaped` is the *lossless* value: backslash-t, backslash-n, backslash-r,
  or the `u{XXXX}` form, or the literal character.

The verifier parses the file, asserts every row has exactly 9 fields, and
round-trips the `escaped` column against the code point.

## 4. Never treat a leading hash as a comment in an emoji file

Emoji keycap sequences render as hash + variation selector + combining
enclosing keycap (U+0023 U+FE0F U+20E3), and the text form is U+0023 U+20E3.
Their TSV rows therefore *begin with a hash character*. The predecessor
filtered comments with a leading-hash test and silently deleted both rows - the
file then reported one fewer fully-qualified and one fewer unqualified sequence
than `emoji-test.txt` actually contains.

`isCommentLine()` is now explicit: a line is a comment only when it is a bare
hash, starts with hash+space, starts with hash+tab, or contains no tab at all.
The unit test `isCommentLine does not mistake a rendered keycap for a comment`
locks this in, and the verifier asserts both keycap rows survive every build.

Being correct in the producer is not enough, though: downstream consumers write
their own parsers. So the emoji TSV also **reorders its columns** - `code_points`
first, `sequence` second - which means no data row begins with a hash character and
the naive filter is safe by construction. The verifier asserts both properties:
no data row starts with a hash, and a leading-hash filter keeps every row.

## 5. Output paths derive from one constant

`src/lib/sources.mjs` is the only place a version appears. Directory names and
file names are built from it, so adopting Unicode 18.0.0 is: change the
constants, `git mv` the two directories, rebuild. `render-docs.mjs` then
rewrites every document straight from `data/manifest.json`, so no README table
can drift from the data again.

## 6. Reproducible by construction

The build timestamp comes from `SOURCE_DATE_EPOCH`, else from the pinned
`buildDate` in the lock file - never from the wall clock. Two builds of
unchanged sources are byte-identical, which is what the CI job `Assert the
rebuild changed nothing` requires. Without this, every CI run would open a
spurious diff and invalidate every checksum.

## 7. Version detection must ignore drafts

`/Public/` lists version directories that are not releases. While this was
written, `/Public/19.0.0/ucd/UnicodeData.txt` returned **HTTP 302** to
`/Public/draft/ucd/UnicodeData.txt` - a draft, not a release. Taking the highest
directory number would have prompted an upgrade to unreleased data.

`check-upstream-version.mjs` therefore requires HTTP 200 *without* a redirect
before it considers a version released, and it reads `emoji-test.txt` from the
UCD-rooted path, because Emoji's own directory numbering lags behind (Emoji data
for 17.0 lives under `/Public/17.0.0/emoji/`, while `/Public/emoji/` stops at
16.0).

## 8. Verification is independent of the build

`src/verify.mjs` does not import the writer functions. It parses the committed
files from disk, re-derives every expectation from the sources on disk, and
compares. If `build.mjs` develops a bug the verifier still fails, because the two
programs share only the low-level parsers - and those have their own unit tests.

What it proves, among 155 checks:

| claim | how |
|---|---|
| every assigned code point is present | rebuilds the set from `UnicodeData.txt` |
| nothing invented | every row must be assigned, a boundary, or a noncharacter |
| `type` column is correct | recomputed from category and range kind |
| TSV is structurally sound | 9 fields per row, no raw TAB/CR/LF |
| escaping is lossless | `escaped` round-trips for all 159,944 rows |
| the string file really is one line | exactly one non-comment line |
| and decodes back exactly | reconstructed code points equal the table |
| per-block strings are correct | each block body equals its rows |
| emoji set equals `emoji-test.txt` | set equality on codepoints+status |
| keycap hash rows survived | explicit assertion |
| emoji names/versions unchanged | compared to the source, field by field |
| emoji properties agree | single-code-point sequences are Emoji=Yes |
| encoding is clean | valid UTF-8, no BOM, LF-only |
| checksums and manifest are honest | every SHA-256 and byte count re-checked |


## 9. Adopting a new release is a command, not a checklist

`src/bump-version.mjs` exists because a version bump used to be six manual steps
with a chance of error in each: edit the pin, rename two directories, delete the
lock, rebuild, verify, re-render the docs. Every one of those was documented and
every one was skippable.

It now runs the whole sequence and refuses to do it wrongly:

| step | why it is a step and not a side effect |
|---|---|
| verify the target is released | a directory that redirects to `/Public/draft/` is a draft; adopting it would publish unreleased data |
| repin `sources.mjs` | it is the single source of truth; every path, filename and URL derives from it |
| `git mv` the directories | so history follows the files instead of showing a delete plus an add |
| delete the lock and cache | `--update-lock` alone would compare against the old hashes; a fresh pin must start from nothing |
| rebuild with `--force` | re-downloads every source rather than reusing a cache keyed by the old version |
| run the strict verifier | the gate: a rebuild that does not verify is not adopted |
| re-render the docs | no number in any document is typed by a human |

The workflow wraps that command and opens a pull request rather than pushing. A
version bump rewrites every data file, which is the change most worth a human's
eyes even when everything verifies. The PR body carries the before/after counts
and the fact that verification passed; `build & verify` runs on the PR and
independently rebuilds from the pinned sources, so a green PR also proves the
committed bytes are reproducible.

### Why one shared module for "latest"

`src/lib/upstream-release.mjs` is imported by both the reporter and the upgrader.
Two copies of that logic would eventually disagree, and the failure mode is nasty:
the report says "current" while the upgrader tries to move, or vice versa. The
module also carries the two non-obvious rules — reject redirecting directories, and
read the Emoji version out of the served file rather than inferring it from a
directory name.
## 10. What is deliberately not done

- **No IMEI/Unihan field ingestion.** `Unihan.zip` is 8 MB of readings, radical
  and stroke data. It is a different dataset with a different audience, and
  folding it into a character table would triple the file size for columns most
  consumers of a TXT/TSV reference never read. The pipeline is structured so it
  can be added as a separate file family without touching the existing one.
- **No generation of the Chinese block names.** There is no official Chinese
  block name list in the UCD, so `data/block-names-zh.json` is curated. It is
  kept outside the generated files, and `tools/sync-block-names-zh.mjs` reports
  any block that has no translation instead of quietly emitting English.
- **No automatic *merge* of a version bump.** The weekly job performs the whole
  migration and opens a PR; a human merges. Automating the work is a labour saving,
  automating the decision is not — a release can legitimately need a new block name
  translated, and that is a judgement call, not a build step.

