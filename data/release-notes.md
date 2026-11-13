## Unicode 18.0 + Emoji 18.0

| | |
|---|---|
| code points | 172,951 |
| blocks | 353 |
| noncharacters | 66 |
| emoji sequences | 5,244 |
| fully-qualified | 3,963 |
| minimally-qualified | 1,029 |
| unqualified | 243 |
| component | 9 |

Build timestamp: 2026-11-13 14:29:33 UTC

### Verify

```bash
sha256sum -c checksum_sha256.txt
# regenerate everything from the official sources and prove it matches:
node src/build.mjs && node src/verify.mjs --strict
```

data/sources.lock.json records the exact upstream SHA-256 of every input, so this
release is reproducible byte for byte.
