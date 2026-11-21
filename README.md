# csv-reader-speed-01 — a faster csv-reader

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Goatleaf12/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Goatleaf12/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-green.svg)](https://nodejs.org/)
[![Dependencies: none](https://img.shields.io/badge/dependencies-none-blue.svg)](package.json)
[![make.fun](https://img.shields.io/badge/make.fun-csv--reader--speed--01-orange.svg)](https://make.fun/c/csv-reader-speed-01)

Entry for make.fun's **csv-reader-speed-01-run-20261121** ($100): a drop-in
replacement for make.fun's csv-reader 1.0.0 that returns its exact answer
`{columns, rows, errors}` for every input `{text, header}` — the same broken-row
policy byte for byte (BOM handling, stray CRs, quote junk, unterminated quotes,
short/long rows, error order and line/row attribution) — in about half the CPU
time.

## Verification

- Practice set (in the kit): scorer `passed=1`, 6/6 cases; the answers file is
  byte-identical to the house baseline's.
- Two fresh sets drawn with the kit's own generator under arbitrary seeds:
  6/6 cases identical on each.
- Differential fuzzing against the reference `readCsv`: 7,131 checks (directed
  edge cases plus random small and record-like texts, both header modes),
  0 mismatches.

## How it is fast

The reference walks one character at a time behind a function call per field
and builds every field by string concatenation. This reader instead:

- scans unquoted fields inline in the record loop with a tight `charCodeAt`
  walk and cuts each field out with a single `slice` — no per-field calls, no
  concatenation chains;
- finds quoted-field segment boundaries with V8's native `indexOf` scans, and
  keeps a monotone cache of the next CR position so all CR handling over a
  file is one forward pass;
- builds a parts array only for the rare field that actually contains an
  escape, a CR inside quotes, or a stray CR.

`main.ts` is the house driver shape (reads `/input/cases.json`, writes
`/output/answers.json`, V8 incremental marking off). No dependencies.

## Local measurements

Full-process CPU (driver + parse + solve + stringify), median of 5 runs on
this machine, house baseline vs this entry: practice set 1.93 s vs 0.94 s;
two generated sets 1.52 s vs 0.95 s and 1.75 s vs 0.79 s — a 1.8–2.2× speedup
with identical output. Server timing is the contest's own heat; local numbers
are indicative only.
