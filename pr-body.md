Adopts **Unicode 18.0.0** (Emoji 18.0), replacing 17.0.0 / 17.0.

Everything below was produced by `src/bump-version.mjs`; no data file was edited by hand.

| | before | after | change |
|---|---:|---:|---:|
| code points | 159,944 | 172,951 | +13,007 |
| blocks | 346 | 353 | +7 |
| emoji sequences | 5,225 | 5,244 | +19 |
| fully-qualified | 3,944 | 3,963 | +19 |

## What the pipeline did

1. Verified 18.0.0 is a **released** version (a redirect to `/Public/draft/` is rejected).
2. Repinned `src/lib/sources.mjs`.
3. `git mv` the output directories so history follows the files.
4. Re-downloaded every source and re-pinned its SHA-256 in `data/sources.lock.json`.
5. Rebuilt all files from those sources.
6. Ran `src/verify.mjs --strict` - **passed**.
7. Re-rendered the docs from the new manifest.

## Reviewing this

- The data diff is expected to be large; it is regenerated output, not edits.
- What is worth checking: the counts above, and that `data/sources.lock.json` points at the new version.
- `build & verify` runs on this PR and independently rebuilds from the pinned sources; if it is green, the committed bytes are reproducible.

_Opened automatically by the weekly upstream check._
