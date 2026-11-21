[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/krida268/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/krida268/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Slice-Scan CSV Reader

A drop-in replacement for csv-reader 1.0.0 that returns exactly the same
`{columns, rows, errors}` answer for every input — including every broken-row
quirk (stray CRs, quote junk, unterminated quotes, short/long rows) — while
spending far less CPU time getting there.

## How it is fast

The reference reader walks the text one character at a time and grows every
field with `value += c`. This reader keeps the same single left-to-right pass
and the same semantics, but changes how the bytes are moved:

- **Plain fields are sliced, not built.** A tight `charCodeAt` scan finds the
  next comma, LF, or CRLF, then the field is taken with one `slice`. The
  common case allocates exactly one string per field.
- **Stray CRs are a separate slow path.** A lone CR outside quotes is rare, so
  it leaves the hot loop entirely: the field is assembled from clean slices
  around each dropped CR, and one `stray_cr` error is recorded per CR.
- **Quoted fields jump with `indexOf`.** The closing quote is located with
  `indexOf('"')`; chunks between quotes are sliced verbatim when they contain
  no CR (only their LF count is tallied), `""` collapses to one quote, and
  only chunks that actually contain a CR go through the CRLF/CR → LF
  conversion path.
- **No per-field result objects.** Field readers report through shared
  closure variables (value, how it ended, how many characters were appended)
  instead of allocating a result object for every field.
- **No regex, no dependencies, no state between calls.** `run()` is pure and
  deterministic; each call starts from a clean slate.

The driver (`main.ts`) turns off V8 incremental marking before importing
`solve.js`, reads every case from `cases.json`, and writes `answers.json`,
exactly like the house driver's contract.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`input/cases.json` is a JSON array of `{id, input}` where each input is
`{text, header}`; `output/answers.json` receives one answer per case, in
order. Requires Node 22 (which runs the TypeScript driver directly).

Referral code: enzt809f
