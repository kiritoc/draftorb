# BL-004 — Public aggregates release: size report

Measured 2026-11-21 on the local `data/public` tree produced by
`pnpm etl export 16.22` from the state-release DB (patch 16.22, SUPPORT only).
Artifact built with `pnpm etl publish-public --dry-run`.

## Sizes

| Metric                                |                                           Value | How measured                                                  |
| ------------------------------------- | ----------------------------------------------: | ------------------------------------------------------------- |
| Publishable files                     |                                              69 | `collectPublishFiles` walk of `data/public` minus `profiles/` |
| Export tree (uncompressed)            |                                        7.12 MiB | sum of file sizes                                             |
| `aggregates.tar.gz` asset             |                      1,543,797 B = **1.47 MiB** | `createTarGz` output                                          |
| Largest file                          | `16.22/roles/SUPPORT/enemy-pairs.json` 2.13 MiB | per-file `statSync`                                           |
| Largest file gzipped                  |                                        0.64 MiB | per-file `zlib.gzipSync`                                      |
| SPECS §10 per-file rule (< 5 MB gzip) |                    max 0.64 MiB — **12× under** | same                                                          |
| Gzipped DB (private, for the record)  |                                        ~209 MiB | BL-007 report, `state-20261112T1035Z`                         |

Per-file sizes: every collected file carries its byte size (`PublishFile.size`)
and the command logs the largest entries at pack time; the full per-file
listing is reproducible with `pnpm etl publish-public --dry-run`. The manifest
(`16.22/manifest.json`) lists each published path with its sha256 for integrity.

Download budget: the whole dataset is a **single 1.47 MiB tarball** — trivially
within a launch-time download budget; per-file JSON stays lazy-loaded inside
the app as SPECS §10 requires.

## Contents and safety

- Archive layout: `latest.json` at root + `16.22/**` (65 manifest files +
  `champions.bootstrap.json`/`champions.derived.json` static catalogs kept by
  the exporter). `profiles/` excluded (3 files present locally, none packed).
- Pre-publish scan (`scanPublishSet`): forbidden paths (`profiles/` segment,
  SQLite names) + content scan for PUUID-like identifiers and `RGAPI-`
  patterns — **0 violations** on the real tree, consistent with AUDIT §5e.
- `pnpm etl pull` unchanged (still pulls the private state release for the
  DB + profiles); `pnpm etl export` size checks unchanged.

## Command

```
pnpm etl publish-public --dry-run   # build + scan, no upload
pnpm etl publish-public --out /tmp/aggregates.tar.gz  # also write the tarball locally
pnpm etl publish-public             # publish to <origin repo> release data-latest
pnpm etl publish-public --repo owner/name --tag data-2026-11
```

Stable app URL once published:
`https://github.com/<owner>/<repo>/releases/download/data-latest/aggregates.tar.gz`
