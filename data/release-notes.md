## Unicode 17.0 + Emoji 17.0

| | |
|---|---|
| code points | 159,944 |
| blocks | 346 |
| noncharacters | 66 |
| emoji sequences | 5,225 |
| fully-qualified | 3,944 |
| minimally-qualified | 1,029 |
| unqualified | 243 |
| component | 9 |

Build timestamp: 2026-11-13 10:57:07 UTC

### Verify

```bash
sha256sum -c checksum_sha256.txt
# regenerate everything from the official sources and prove it matches:
node src/build.mjs && node src/verify.mjs --strict
```

data/sources.lock.json records the exact upstream SHA-256 of every input, so this
release is reproducible byte for byte.
