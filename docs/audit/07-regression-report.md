# Vetta — Regression Report (deliverable E, Phase 9)

Same commands, same corpus, same machine, same keyless configuration as
`docs/audit/01-baseline-report.md`. The claim made here is narrow: **the deterministic outputs of the
product are unchanged**, and every gate that was green is still green.

---

## 1. Gates, before → after

| Check                                       | Baseline                                  | After Batches 1–4                                                        | Verdict                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test` (15 whitelisted suites)          | 180 pass / 0 fail                         | 180 pass / 0 fail                                                        | identical — **superseded: Batch 7 widened this to all 24 suites, 208/208 (§4b)**                                                                                               |
| All 24 `src` suites run explicitly          | 206 pass / 1 fail                         | **205–206 pass / 1–2 fail**                                              | see §4a: the extra failure is a pre-existing wall-clock flake that only surfaces once the runner is widened — **both causes closed in §4b**                                    |
| `npm run typecheck`                         | clean                                     | clean                                                                    | identical                                                                                                                                                                      |
| `npm run lint`                              | 1 error + 46 warnings                     | 1 error + 46 warnings                                                    | identical — verified by name, not just by total (§3)                                                                                                                           |
| `npm run build`                             | exit 0                                    | exit 0                                                                   | identical                                                                                                                                                                      |
| Built output served (`vite preview`, :8081) | not captured at baseline                  | `/`, `/jobs`, `/login`, `/app` → **200**                                 | new evidence, passing                                                                                                                                                          |
| Dev server (:8080)                          | 200                                       | 200                                                                      | identical                                                                                                                                                                      |
| `npm run check:auth`                        | "dev and build agree: sign-in on"         | same                                                                     | identical                                                                                                                                                                      |
| `npm run check:router-clock`                | invariants held                           | **"All replay invariants held"**                                         | identical — 10 task × context route decisions reproduced                                                                                                                       |
| Migrations                                  | 27 files, glob-applied                    | **26 applied, 62 public tables** on a fresh PGLite process               | identical                                                                                                                                                                      |
| `npm test`, final (after Batch 8)           | 180 of 402 tests, scripts half silently 0 | **403 of 403 tests execute: 403 pass / 0 fail / 0 `todo`, exit 0** (§4c) | the gate now covers the whole repo, and the whole repo passes on Windows — the one product-side change in it (`with-app-env.mjs` quoting) was reported and applied on approval |
| `npm run lint`, final                       | 1 error + 46 warnings                     | **0 errors + 46 warnings** (§3)                                          | the repo's only live error was a style-only ternary statement, now the equivalent `if`/`else`; the 46 warnings are unchanged by (file, rule, message)                          |

### Batch 6 (lint boundary rules + recruiting README)

| Check                                  | Before Batch 6                   | After Batch 6                                                                                                                                                 | Verdict                                                                  |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run lint`                         | 1 error + 46 warnings, 231 files | **1 error + 46 warnings, 231 files**, `no-restricted-imports` fired 0×                                                                                        | identical — the rules froze a 0-violation state, they did not create one |
| `npm run typecheck`                    | clean                            | clean (exit 0)                                                                                                                                                | identical                                                                |
| `npm run build`                        | exit 0                           | exit 0                                                                                                                                                        | identical                                                                |
| `npm test` (unchanged 15-suite script) | 180 / 0 fail                     | 180 / 0 fail                                                                                                                                                  | identical                                                                |
| Rules proven to bite                   | —                                | 3 probe files (static `@/…server`, relative `../lib/…server`, `await import("…server")`, and `src/lib → @/components`) all reported **error**; probes deleted | new evidence, passing                                                    |
| `src/lib/recruiting/README.md`         | absent                           | present, counts re-derived from the tree (100 files: 30 / 13 / 19 / 38)                                                                                       | new file, docs only                                                      |

## 2. Behavioural comparison — the 200-applicant benchmark

`npm run bench:match` on the same 40-document corpus, keyless, PGLite, 12 cores, compared against the
baseline artifact `resume-match-2026-11-03T14-21-42-279Z.json`.

**Deterministic outputs — these are the ones that must match exactly:**

| Field                                                                                 | Baseline                    | After                         | Match |
| ------------------------------------------------------------------------------------- | --------------------------- | ----------------------------- | ----- |
| L5 applications completed                                                             | 200                         | 200                           | ✅    |
| L5 failed / notCompleted                                                              | 0 / 0                       | 0 / 0                         | ✅    |
| `corpusPostRun` (dedupe invariants: 40 distinct emails/texts/hashes → 200 candidates) | as recorded                 | byte-identical                | ✅    |
| L4 errors array                                                                       | `[]`                        | `[]`                          | ✅    |
| L6 chosen engines                                                                     | `["local","local","local"]` | `["local","local","local"]`   | ✅    |
| Gate                                                                                  | PASS (`vs-in-file-targets`) | PASS                          | ✅    |
| **Pricing surface**                                                                   | 425 fields                  | **423 of 425 byte-identical** | ✅    |
| Typical 4k-resume + 3k-JD cost band                                                   | ₹0.029–₹0.622 per rank      | ₹0.029–₹0.622 per rank        | ✅    |

The **only two** differing pricing fields are measured-CPU, not modelled cost:
`freeTierHeadroom.cpuMsPerRank_p95` 0.834 → 0.556 ms and `ranksPerSecPerCore` 1825 → 3049. Every
price, token estimate and rupee figure in the table is unchanged — which is the point, since the cost
maths is one of the duplication clusters I deliberately did **not** touch.

**Timings (non-deterministic, machine-state dependent):**

| Layer                      | Baseline p50                         | After p50                            |
| -------------------------- | ------------------------------------ | ------------------------------------ |
| L1 rank (local engine)     | 0.460 ms                             | 0.247 ms                             |
| L2 full pipeline           | 65.70 ms                             | 65.18 ms                             |
| L3 cache hit (mem / db)    | 12.32 / 18.96 ms                     | 9.11 / 12.00 ms                      |
| L4 rerank                  | 58.14 ms                             | 52.98 ms                             |
| L5 200 applications, wall  | 23,248 ms                            | 15,639 ms                            |
| L5 per-resume / throughput | 116.2 ms · 8.60/s · parallelism 7.50 | 78.2 ms · 12.79/s · parallelism 7.52 |
| L6 route decision          | 28.26 ms                             | 6.89 ms                              |

L5 is 33 % faster and L6 76 % faster with identical work completed. I am **not** attributing that to
the cleanup alone: the baseline run happened while the machine had other load, and these are wall
clocks on an i5 laptop, not counters. What is defensible is the direction and the invariant —
throughput went up, completed/failed counts and every deterministic field did not move. Derived
parallelism (7.50 → 7.52) is the stable one.

## 3. Lint-warning attribution (why "46 = 46" is a real check, not a coincidence)

After the Batch 4 cuts the count was **58**, because removing an export orphans its imports. I then
diffed the ESLint JSON by file+symbol to separate the 12 new ones from the 46 pre-existing, removed
exactly those 12 (listed in the deletion report §Batch 4), and re-ran. Back to 46, with the same
names: `auth/client.ts SOCIAL_PROVIDERS`, `auth/server.ts` ×2, `observability.server.ts QueueMetric`,
`ai-schema.ts` ×8, `team-api.ts` ×4, `tenant-isolation.test.ts` ×5, `semantic-indexing.test.ts` ×4,
`enterprise-collaboration.test.ts` ×5, `resilience.test.ts` ×3, `ai-guard.test.ts` ×2,
`observability-auth.test.ts` ×2, and 10 singles. The 1 error was
`scripts/apply-200-candidates.mjs:285` `no-unused-expressions` — pre-existing, and left at the gate in
Batches 1–7 on the reasoning that touching it is behaviour-adjacent in the script that feeds the
200-applicant demo. **That reasoning was vaguer than the measurement deserved.** Read in Batch 8b, the
site is `t.n++; t.sumMs += r.ms; r.ok ? t.ok++ : t.fail++;` — a ternary used as a statement whose _both_
branches increment exactly one counter, i.e. a style artifact, not the discarded-value bug the rule's name
suggests. So it was rewritten as the equivalent `if (r.ok) t.ok++; else t.fail++;`, which is what prettier
itself emits for those four lines (`--write` output byte-identical to the hand edit), and the repo now
lints at **0 errors + 46 warnings**, the 46 unchanged by file, rule and message.

Batch 7 (which edited two test files and could therefore have moved `no-unused-vars` in either
direction) re-ran the same attribution rather than the same total: every (file, rule, message) bucket
matched its baseline count, with only line numbers shifted.

## 4. Pre-existing failure — still failing, unchanged

> **Status: closed in Batch 7 (§4b).** Everything below is the finding as it stood when it was made,
> kept unedited because it is the reason the fix is shaped the way it is — including its line
> numbers, which the Batch 7 rewrite of that file moved.

`src/lib/recruiting/grounding-and-adversarial.test.ts:354`
"Provider Fallback Transparency: Records provenance and fallback reason without silent changes" —
fails identically before and after. It is invisible to `npm test` because the whitelist at
`package.json:19` omits its suite. Not caused by, and not fixed by, this cleanup. See gate item 4.

**What the failure actually is** (established in Batch 6, because "stale assertion" was an assumption
I went to check rather than repeat): the test drives `mode: "full"` with **no provider keys** and then
asserts `provenance.fallback === true`. `ai.server.ts` intentionally reports `false` there.
`ai.server.ts:677` — _"only a network arm that could not answer earns the `fallback` label **the desk
and the outcome model both read**"_ — and `:680` sets `fallbackReason = routerChoseLocal ? null : …`.
So keyless-local is recorded as a **routing decision**, not a failure, and the distinction is
load-bearing downstream. The test still gets its transparency: `engine: "local"`, `isLocal: true`,
`provider: "local"`, `model: "evidence"`, `evaluatedAt` all pass at `:388-393`.

**The finding that matters more than the failure:** grepping every suite for the fallback fields
returns **only these three lines, in this one never-run test**. The genuine branch — a provider was
attempted, failed, and the ladder exhausted, which is what writes `fallback: true` + reason +
`originalProvider` into the ledger the desk and `trainOutcome` consume — has **zero coverage**. And it
cannot be reached keyless, because with no keys the router pre-selects local. So widening the gate
would leave the most behaviour-sensitive provenance field untested either way. That is why I am not
editing the assertion, and why the replacement needs a decision (gate item 4).

## 4a. Widening `npm test` — measured, and why it is not a one-liner

> **Status: the `src` half was widened in Batch 7 (§4b); the flake below is fixed and the surviving
> limitation is the `scripts` quoting, which is still yours to decide on.**

The audit found the repo has **402 tests**, not 207:

| Surface                                | Suites | Tests   | Result                                                                     |
| -------------------------------------- | ------ | ------- | -------------------------------------------------------------------------- |
| `src/**/*.test.ts` (all 24)            | 24     | 207     | 205–206 pass / **1–2 fail** (§4 + the §4a flake)                           |
| `scripts/*.test.mjs` (all 9)           | 9      | 195     | 189 pass / **6 fail**                                                      |
| Both in one runner                     | 33     | **402** | 394 pass / **8 fail** (6 + §4 + the flake, which that run happened to hit) |
| `npm test` as shipped, on this machine | 15 + 0 | **180** | 180 pass / 0 fail                                                          |

Three separate problems, none of them mine:

1. **The whitelist hides 9 `src` suites** (27 tests: 26 passing invisibly + the 1 in §4).
2. **On Windows the `scripts` half silently runs zero tests.** `npm test` starts with
   `node --test 'scripts/**/*.test.mjs'`; cmd.exe keeps single quotes literal, node matches no files,
   reports `# tests 0` and **exits 0**. Those 9 suites only run under a POSIX shell. So the fraction
   of the repo's tests that `npm test` actually executed here was **180/402 = 44.8 %** (superseded end of
   §4a: `src` widened in Batch 7, `scripts` in Batch 8 — **403/403 now**).
3. **The 6 `scripts` failures are environment, not code** — verified by mtime: every subject file
   (`browser-smoke.mjs`, `with-app-env.mjs`, `preview.test.mjs`, `sign-out-plan.test.mjs`) is dated
   2026-10-18/2026-10-30, i.e. untouched by this audit. Three are
   `with-app-env.test.mjs` spawning `C:\Program Files\nodejs\node.exe` unquoted →
   `'C:\Program' is not recognized`; two are symlink-invocation tests (Windows `realpath`); one is
   `browser-smoke-verdict.test.mjs` asserting the literal source
   `checkedOutputPath(args.outPng, ["/workspace"])` while the shipped file is
   `allowedDirs = ["/workspace", resolve("/workspace"), process.cwd()]` — a pre-existing source/test
   drift predating the audit.

**And a new one, found only by widening:** `resilience.test.ts:582` "Timeout: the caller's deadline
bounds the whole retry queue, not one attempt" is **flaky under a widened runner and green under the
shipped one**. Measured, in order:

| Run                                                  | Result                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (15 whitelisted suites)                   | 180 pass / 0 fail — the suite passes                                                                                                                    |
| that suite alone (19 tests)                          | pass                                                                                                                                                    |
| it + `model-router` + `calibrate-explain` (51 tests) | pass                                                                                                                                                    |
| all 24 `src` suites, one runner                      | **passed it once** (207 tests, 206/1), **failed it three times** (205/2) — `2 !== 1`, "one attempt armed, and the second arm never got a timer", ~1.6 s |
| the same 24 suites with `--test-concurrency=1`       | **206/1 — passes**, only §4's stale assertion fails                                                                                                     |

Serial execution of the identical file set is green, so this is **parallel-worker CPU contention
delaying a real timer**, not suite ordering and not shared state between suites. That distinction is
what makes it fixable without touching the product: the test needs a fake timer (`--test-force-exit`
won't help; `node:test`'s `mock.timers`) or a widened tolerance, and both are test-only changes.

> **Corrections to the two sentences above, from §4b.** The inference "contention _delays a real timer_"
> was half right: contention is the trigger, but nothing was delayed — the second ≥1 s timer in the
> recording belongs to PGLite's WASM runtime, and widening the runner is what makes one land inside the
> measured window more often. And of the two candidate fixes proposed here, **both are wrong**: neither a
> fake timer nor a widened tolerance would have made the assertion claim what it means to claim. The
> shipped fix attributes each recording to its call site. I am leaving the wrong reasoning in place rather
> than quietly rewriting it, because the sequence — a plausible-sounding inference, then a probe that
> falsified it — is the part worth keeping.

So the honest version of my own §1 row is "1–2 failures", not "1": the first measurement of the widened
run happened to get lucky. The assertion counts arms that got a timer inside a caller-supplied deadline,
which makes it wall-clock sensitive, and 24 suites on parallel workers is enough contention to let a
second arm start. It is **pre-existing in the test's design** (nothing in Batches 1–4 touched
`resilience.test.ts` or the timeout clamp), and it is **invisible today** only because the whitelist
keeps the runner small.

That is the second reason not to flip `package.json:19` yet: widening it would make the gate red on a
timing flake as well as on §4, which is a worse property than the whitelist it replaces.

_(One clause of that paragraph needed the same correction as above: a second **arm** never started. The
runner armed one budget and the database armed a foreign timer; the count was wrong, not the plan.)_

**Landed instead (purely additive, zero change to `npm test`):** `npm run test:src` (24 suites via
glob — the list can no longer rot) and `npm run test:all` (all 33 suites in **one** node invocation,
both patterns double-quoted so cmd.exe passes them through; `&&` between the halves was tried first and
rejected, because the 6 known `scripts` failures would have short-circuited the `src` half and hidden
exactly what widening is meant to reveal). The decision to move `test` itself is gate item 5, and I
recommend it only _after_ §4 and this §4a flake are resolved, in that order.

## 4b. Batch 7 — the two test-side fixes, then the gate widened

Gate items 4 and 5, done in the order §4a said they had to be done: flake first, then the fallback
contract, then the widening. Three files changed — [src/lib/recruiting/resilience.test.ts](file:///C:/Users/punam/Downloads/rp1RKbTXMmwGpqUp-grok-workspace/src/lib/recruiting/resilience.test.ts),
[src/lib/recruiting/grounding-and-adversarial.test.ts](file:///C:/Users/punam/Downloads/rp1RKbTXMmwGpqUp-grok-workspace/src/lib/recruiting/grounding-and-adversarial.test.ts)
and `package.json` (the `test` script). **No product file was touched, and no test-only seam was added to
one.** Pre-edit copies are at `vetta-audit/50-pre-testfixes/` (byte-verified before editing).

### The flake was my instrument, not the machine

§4a could only say "CPU contention delays a real timer". To find out _which_ timer, I ran a throwaway
probe that mirrored `withFakeProvider` but stamped every `setTimeout` with the moment it was armed and
the stack that armed it (output archived at `vetta-audit/50-pre-testfixes/timeout-probe-output.txt`;
the probe file was deleted, as with the Batch 6 probes). In one 1 500 ms call it recorded:

| Timer                         | Armed at | Armed by                                                                                                  |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 10 000 ms                     | 975 ms   | `node_modules/@electric-sql/pglite/dist/index.js` → `__setitimer_js` → WASM                               |
| 10 000 ms                     | 3 070 ms | same                                                                                                      |
| (the runner's attempt budget) | —        | **none in this cold run**; `attempts: 0`, `"groq not tried again: the caller's 1500ms deadline is spent"` |

(Two of them, both 10 000 ms, both inside a call the caller said lasts 1 500 ms — and neither of them
the runner's. An earlier console run of the same probe, whose output I did not archive, put them at
1 032 and 2 154 ms: the _value_ is constant, the _arrival_ is not, which is exactly what makes a
value-threshold filter unsafe.)

So `timerDelays.filter((d) => d >= 1_000)` was counting the **embedded database's own Postgres interval
timer** as if it were one of the runner's attempt budgets. It only shows up under a widened runner
because that is when a PGLite timer is likely to land inside the measured window. Nothing was slow;
the test was counting the wrong thing. The probe also shows the opposite risk on a cold process (the
ledger read eating the whole 1 500 ms before any arm), which is why the fix below had to keep the real
clock rather than remove it.

### The fix: attribute the recording, don't relax the assertion

resilience.test.ts:488 adds `armedByProjectCode()` and :525 applies it inside the wrapper, so
`timerDelays` now holds _the timers this project armed_ and no others. Attribution is by immediate call
site: a frame inside `node_modules` is dropped, a frame in `src` is kept.

That is a **narrowing that makes every assertion stronger**, not a tolerance added to make a test pass:

| Assertion                            | What it claimed before             | What it claims now                                        |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| `timerDelays.includes(9_000)`        | something in the process armed 9 s | the runner armed 9 s                                      |
| `!timerDelays.includes(14_000)` (×2) | no library happened to arm 14 s    | **the runner** did not arm the historical constant        |
| `armed.length === 1`                 | one ≥1 s timer existed             | **one attempt** got a budget, and the second arm got none |
| `armed[0] ∈ (1_400, 1_500]`          | an unattributed delay was in range | the attempt budget is the deadline minus the ledger read  |
| ladder `includes(14_000)`            | some 14 s timer                    | the legacy path still arms 14 s                           |

The alternative — `node:test`'s `mock.timers` — was rejected on what it would cost the assertion. The
test's subject is the _interaction_ between a caller-supplied deadline and a genuinely asynchronous
ledger read: `armed[0]` is expected to be 1 500 ms minus whatever the read really took. Fake the global
clock and you capture the database's own timers too, so the number under test stops being a measurement
and becomes a constant the test itself chose; the only way to keep it meaningful would be to mock the
ledger read away, which is a different test. Attribution keeps the real clock, the real PGLite and the
real abort, and corrects only the counting.
Backoff sleeps stay in the recording (`400·(a+1)+rand(200)` peaks at 999 ms, under the 1 000 ms cut), so
the test still distinguishes a budget from a retry pause.

### Gate item 4: the fallback field now has coverage on both sides of its own contract

The stale assertion is replaced with the contract `ai.server.ts:672-698` actually implements, and the
branch that assertion was _trying_ to describe is now tested for real:

- `grounding-and-adversarial.test.ts:418` (the rewritten original) — keyless `mode: "full"`: engine
  `local`, and `fallback === **false**`, `fallbackReason === null`, `originalProvider === null`,
  requirements intact. The transparency the test was written to protect ("no silent change") is
  asserted in the direction the product chose: a routing **decision** is not reported as a failure,
  because `fallback` is what the Ops desk and `trainOutcome` read.
- `grounding-and-adversarial.test.ts:468` (new) — one keyed arm, its endpoint answers **401**
  (non-retryable, so the runner gives up on it honestly instead of burning the deadline): `armCalls > 0`
  so the fallback cannot be a cache artifact, `fromCache === false`, `fallback === true`, and the two
  fields named at their measured values — `fallbackReason === "Groq 401"`,
  `originalProvider === "groq"`. Values were read from a throwaway probe first
  (`vetta-audit/50-pre-testfixes/fallback-probe-output.txt`), then deleted, so the assertions name the
  contract instead of restating it vaguely.
- Both cases run inside `withProviderEnv` (:367), which clears all five provider keys, pins
  `__vettaOllamaUp__` down and resets `__vettaCircuits__`. The old test passed keyless only because the
  shell happened to have no keys; "no keys" and "an arm answered" are the two environment facts the
  provenance contract depends on, so a test that describes one now pins the other.

§4's "the most behaviour-sensitive provenance field has zero passing coverage" is therefore closed: the
`true` side and the `false` side are each covered, and neither can be satisfied by the other path.

**One related pre-existing gap, reported not fixed:** on a cache hit `ai.server.ts:386-397` builds
provenance **without** `fallback` / `fallbackReason` / `originalProvider` at all — they are optional in
`src/lib/recruiting/types.ts:190-192`, which is why it compiles. A rank that was _recorded_ as a
fallback reads back as neither a choice nor a fallback. That is pre-existing, changing it would change
what the desk displays, and it is not this audit's call; my new test asserts `fromCache === false`
precisely so the two paths cannot be confused for each other.

### Gates re-run after Batch 7

| Check                                  | Before Batch 7                                                | After Batch 7                                                                                                                                            | Verdict                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/**/*.test.ts`, one runner         | 207 tests, 206 pass / 1 fail (and 2 fails when the flake hit) | **208 tests, 208 pass / 0 fail × 4 consecutive runs** (`vetta-audit/50-pre-testfixes/stability-4x.txt`), **plus a 5th after the final formatting edits** | the §4 failure and the flake are both gone                                                                                                 |
| `npm test` (`package.json:19`)         | `# tests 0` + 180 / 0 fail                                    | `# tests 0` + **208 / 0 fail**, exit 0                                                                                                                   | src half now glob-driven: 24 suites, no list to rot                                                                                        |
| `npm run test:all`                     | 402 tests, 394 pass / **8 fail**                              | 403 tests, **397 pass / 6 fail**                                                                                                                         | the remaining 6 are all in `scripts` — the mtime-verified environment set from §4a, unchanged                                              |
| `npm run lint`                         | 1 error + 46 warnings, 231 files                              | **identical**, `no-restricted-imports` still 0 fires                                                                                                     | every (file, rule, message) bucket matched its baseline count (`diff-lint.cjs` vs `vetta-audit/lint-batch6.json`); only line numbers moved |
| `npm run typecheck`                    | clean                                                         | clean                                                                                                                                                    | ✅                                                                                                                                         |
| `npm run build`                        | exit 0                                                        | exit 0 (+ `db:migrate` PGLite skip)                                                                                                                      | ✅                                                                                                                                         |
| Dev server :8080                       | 200                                                           | 200                                                                                                                                                      | ✅                                                                                                                                         |
| `npm run check:auth`                   | dev and build agree: sign-in on                               | same                                                                                                                                                     | ✅                                                                                                                                         |
| `npm run check:router-clock`           | "All replay invariants held"                                  | **"All replay invariants held"**                                                                                                                         | ✅ — the timeout work in Batch 7 is test-side; no route or clock changed                                                                   |
| Prettier status of the 2 edited suites | both DIRTY (pre-existing)                                     | both still DIRTY, **on pre-existing lines only**                                                                                                         | verified hunk-by-hunk: every line Batch 7 added conforms (`printWidth: 100`)                                                               |
| `src` + `scripts` line count           | 51 716                                                        | **51 834** (+118: resilience +13, grounding +105)                                                                                                        | additions are tests and one script line; nothing removed                                                                                   |

### What Batch 7 deliberately left alone

> **Closed in Batch 8 (§4c), including the reason it was left.** Read the paragraph below as the
> decision point it was, not as the current state: `npm test` now runs both halves on Windows.

**The `scripts` half of `npm test` still runs 0 tests on Windows** — its single-quoted glob is unchanged,
verbatim. Fixing the quoting would execute those 195 tests here and make `npm test` **red** on 6
pre-existing, mtime-verified environment failures (`'C:\Program' is not recognized`, two symlink
`realpath` cases, one source/test drift in `browser-smoke-verdict.test.mjs`). Turning a shared gate red
because of the operating system is your decision, not a cleanup, so gate item 5 is **half-closed**:
`src` widened, `scripts` quoting reported and left. `npm run test:all` is the command that shows you both
halves honestly on any OS.

## 4c. Batch 8 — gate item 5 closed, and the one real defect it exposed

Batch 8 did the half that Batch 7 reported and left: `package.json:19`'s scripts glob went from
`'scripts/**/*.test.mjs'` (single quotes, which `cmd.exe` hands to node verbatim, so nothing matches and
the runner prints `# tests 0` and **exits 0**) to the same double-quoted form the `src` half already
used. The scripts suites now genuinely execute here: **195 tests**.

That is the whole point of the change, and it immediately exposed what the silent zero had been hiding.
Of the 6 failures §4a predicted, 2 were stale-test bugs I fixed inside the test, and 4 are one single
**product-side defect** — reported first, then patched when you approved it (Batch 8b, below).

| #   | Failure                                                                                                                                                                                  | Cause                                                                                                                                                                                                                                         | Disposition                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `browser-smoke wires the guard and verdict helpers`                                                                                                                                      | the test pinned `checkedOutputPath(args.outPng, ["/workspace"])`; the shipped script (byte-identical in the pre-audit snapshot, so **not my edit**) hoists the list into `allowedDirs = ["/workspace", resolve("/workspace"), process.cwd()]` | **fixed test-side**: assertions now pin `allowedDirs` _and_ the baseline's separate, narrower `["/workspace"]` list, so the wiring is still pinned and a future silent widening trips here                             |
| 2   | `the CLI reports rather than silently passing when run via a symlink`                                                                                                                    | `symlinkSync` on a directory returns `EPERM` on Windows without `SeCreateSymbolicLink` (developer mode / admin)                                                                                                                               | **fixed test-side**: a `linkDirSync` helper uses the `"junction"` reparse point on win32, which needs no privilege and resolves through `fs.realpath` like a symlink — the assertion still runs, on this OS, unchanged |
| 3–6 | `the wrapped command runs with the app env applied` / `…sees an explicit override…` / `…propagates the command's exit code` / `the CLI still runs when invoked through a symlinked path` | **a real defect in `scripts/with-app-env.mjs:114`**                                                                                                                                                                                           | **product-side**: reported first, then **fixed on approval** in Batch 8b (below)                                                                                                                                       |

**The defect.** `spawn(command, args, { shell: process.platform === "win32" })` — the `shell` flag is
load-bearing (without it, `vite` does not resolve on Windows, because the shim is `vite.cmd` and
`CreateProcess` ignores `PATHEXT`), but under `shell: true` node joins the command and its arguments into
one `cmd.exe` string **without quoting any of them**. So any wrapped command whose path contains a space
dies before it starts:

```
Command failed: C:\Program Files\nodejs\node.exe …\scripts\with-app-env.mjs C:\Program Files\nodejs\node.exe -e …
'C:\Program' is not recognized as an internal or external command,
```

The app's own scripts pass `vite`, `vite build`, `vite preview` — space-free, so `npm run dev`, `build`
and `preview` work here today. **The bug only bites a caller that passes a path with a space**, which is
why it survived: this repo's `npm test` never executed these four tests until Batch 8.

**Applied on approval (Batch 8b).** The wrapper now quotes each token of the command string it hands
`cmd.exe`, and only the tokens that need it:

```js
// scripts/with-app-env.mjs — shellToken(), then main()
function shellToken(token) {
  if (token.includes('"')) return token; // no safe cmd /c form exists; pass through unchanged
  return /[^A-Za-z0-9_.:/\\-]/.test(token) ? `"${token}"` : token;
}

const child =
  process.platform === "win32"
    ? spawn([command, ...args].map(shellToken).join(" "), { stdio: "inherit", env, shell: true })
    : spawn(command, args, { stdio: "inherit", env });
```

The non-Windows branch is the same `spawn(command, args, …)` it always was — no shell, exact argv — so the
platform that the sandbox and Vercel deploy on is byte-for-byte the previous code path. On Windows,
`vite` / `build` / `preview` / `--mode` / `development` all match the safe set, so they join into exactly
the string node joined before. **Only a token that was already being split by `cmd.exe` changes**, which is
the non-obvious constraint worth keeping: `shell: true` is not optional here (`CreateProcess` ignores
`PATHEXT`, so the `vite.cmd` shim would stop resolving), and a shell takes one joined string, not argv.

A token that already contains a `"` is deliberately left unquoted: wrapping it would emit a string `cmd`
mis-parses, and no script in this repo produces one.

**Every launch path re-verified on this host after the patch** — the change is in the code path that starts
the app, so all three were exercised, not just the tests:

| Launch path                             | Evidence                                                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                           | dev server restarted through the wrapper: `VITE v8.2.2 ready`, bound `0.0.0.0:8080` (network URL listed, so the live-preview contract holds), `/` → **200** with 10 696 bytes of server-rendered markup                                                          |
| `npm run build`                         | exit **0**, nitro output produced, `db:migrate` PGLite skip as before                                                                                                                                                                                            |
| `npm run preview` (built output, :8081) | `/`, `/jobs`, `/login`, `/app` → **200 / 200 / 200 / 200**; the `pglite.data` ENOENT count in the log is **8 before and 8 after** (`vetta-audit/preview.log` vs this run), so it is pre-existing host noise, not this change                                     |
| The fixed case itself                   | `node scripts/with-app-env.mjs "C:/Program Files/nodejs/node.exe" -e "…"` now runs and prints — it could not before                                                                                                                                              |
| `npm run check:auth`                    | "dev and build agree: sign-in on"                                                                                                                                                                                                                                |
| `npm run check:router-clock`            | "All replay invariants held"                                                                                                                                                                                                                                     |
| Space-free shim resolution              | `node scripts/with-app-env.mjs vite --version` → `vite/8.2.2 win32-x64 node-v22.16.0` (run with `node_modules/.bin` on `PATH`, which is what `npm run` does; without it the same command reports `'vite' is not recognized` — that is my shell, not the wrapper) |
| Rollback                                | `vetta-audit/60-pre-gate5/with-app-env.mjs` is the pre-patch file, byte-exact                                                                                                                                                                                    |

**One false green in the same file, and what the patch did to it.**
`a signal-killed command is never reported as success` used to pass on Windows _vacuously_: its validator
is `err.signal === "SIGTERM" || err.code !== 0` and the quoting failure yielded `code: 1` from `cmd.exe`
before the wrapped process existed. After the patch the wrapped process really runs and really kills itself,
and the case still reports `code: 1, signal: null` — measured, not assumed — because under `shell: true`
the direct child is `cmd.exe`, which folds the grandchild's termination into its own exit code. So the
"never reported as success" half is now genuinely proven here, while the `128 + signo` translation in
`exitStatusFromChild` stays **POSIX-only coverage**; tightening the assertion to require
`err.signal === "SIGTERM"` would demand something a shell child cannot report. Left as written, with this
paragraph as its caveat.

**The `todo` markers are gone** (all four), so the four tests must pass for real on every platform, and the
`SHELL_QUOTING_TODO` constant was deleted rather than left unused. That is the difference between a marker
and an excuse: the interim state existed only to keep the defect visible while it was un-approved.

### Gates after Batch 8

| Check                                                       | Before Batch 8                       | After Batch 8                                                                                                                       | Verdict                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (`package.json:19`)                              | `# tests 0` (scripts) + 208 / 0 fail | **195 + 208 = 403 tests, 403 pass / 0 fail / 0 `todo`, exit 0**                                                                     | both halves really run on Windows, and every test in the repo passes on it — the first time that has been true here                                                                            |
| `npm run test:all`                                          | 403 / 397 pass / **6 fail**          | 403 / **403 pass / 0 fail**                                                                                                         | the 6 became 2 corrected tests + 4 real product fixes                                                                                                                                          |
| `src` half stability                                        | 208/208 × 4 (§4b)                    | 208 / 0 fail in both Batch-8 runs                                                                                                   | unchanged — no `src` file touched in Batch 8                                                                                                                                                   |
| `npm run typecheck`                                         | clean                                | clean                                                                                                                               | ✅                                                                                                                                                                                             |
| `npx eslint` / `prettier --check` on the files touched here | —                                    | 0 errors, all conforming lines are mine                                                                                             | the repo-wide 11-file dirtiness from §5 is untouched (`apply-200-candidates.mjs` was already non-conforming, and prettier's own output for my 4 lines matches what I wrote)                    |
| App launch paths                                            | dev 200, build 0, preview 200        | dev 200 (restarted), build 0, preview 200 × 4 routes                                                                                | ✅ — table above, because the patched file _is_ the launch path                                                                                                                                |
| Files changed                                               | —                                    | 6: three suites + `package.json` + **`scripts/with-app-env.mjs` and `scripts/apply-200-candidates.mjs`, both after being reported** | `src/` untouched at 51 716 + the 118 Batch-7 test lines; the two product-side edits are a `cmd.exe` token that was previously being split, and a ternary→`if`/`else` with identical increments |

## 4d. After the audit closed: a real browser found the one thing every gate missed

The audit finished with all gates green. The instruction that followed was to test the running software,
so this pass drove an actual browser over dev and the production build. **Every gate in §1–§4c was green
throughout, and the product's primary action was broken.** That is the finding worth keeping.

**How the browser was available.** Playwright's own Chromium is still not installed — the cached build on
the machine is `chromium_headless_shell-1223` while the installed `playwright` module asks for `-1234`, and
`npx playwright install` is a ~100 MB third-party download that was not requested. The pass instead uses the
Edge binary already present, via `chromium.launch({ channel: "msedge" })`. No dependency was added, nothing
was downloaded, and `package.json` is unchanged.

**What passed before the defect surfaced**

| Surface                                                                                                | Result                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `/`, `/jobs`, `/login` — dev, 1440×950 and 390×844                                                     | styled render, real copy, 0 console/page errors, `scrollWidth − innerWidth = 0` |
| same three routes on the **built** output `:8081`                                                      | same, but 2 console errors each — see finding 1 below                           |
| sign-up → `/app`, `/app/talent`, `/app/approvals`, `/app/harness`, `/app/observability`, `/app/portal` | all render real gated content (10/10 steps), 0 errors                           |
| mobile 390×844 authenticated `/app`                                                                    | `overflowPx=0`, 0 errors                                                        |

**The defect.** `ingestResume` inserted `NULL` into four columns declared `not null default ''` in
`migrations/0017_rank_provenance_and_stale.sql:14-19` — `model`, `provider`, `rubric_hash` and, as a
hardcoded literal, `stale_reason`. Because the last one was unconditional, **"Add one" / "Paste one" failed
on every single call**, at every rubric state, and the dialog in `src/routes/app/roles.$roleId.tsx` renders
no error at all, so the user sees a form that silently refuses to close.

The error surfaced only once the rubric was confirmed and the earlier violation stopped masking it:

```
null value in column "stale_reason" of relation "applications" violates not-null constraint
```

The batch path was the tell. `src/lib/recruiting/queue.server.ts:284-300` inserts the same columns with
`""` / `''`, which is why "Drop resumes" — the path used by `scripts/apply-200-candidates.mjs` and every
benchmark in this repo — always worked, and why a 200-applicant run was ever green.

**Attribution, checked before editing.** The insert block is byte-identical to
`00-snapshot/vetta-source-pre-audit.tar.gz`; only its line number moved (787 → 744) because `updateRole` and
`listTalent` were deleted above it in Batch 4. `ai.server.ts`, `role-form.tsx`, `roles.new.tsx`,
`roles.$roleId.tsx`, `vite.config.ts`, `styles.css` and `__root.tsx` are all identical to the snapshot, and
`rubric-version.server.ts` differs only by the removed dead export `loadRubricById`. **The audit did not
break this.** It is inherited app code that no gate in this repo had ever executed.

**The fix, applied on approval** — four values, aligned to the pattern the batch path already uses;
`rubric_version_id` and `rubric_version` stay nullable because the schema allows it:

```js
${ranked.ok ? (ranked.model ?? "") : ""},
${ranked.ok ? (ranked.provider ?? "") : ""},
${ranked.ok ? (ranked.rubricVersionId ?? null) : null},
${ranked.ok ? (ranked.rubricVersion ?? null) : null},
${ranked.ok ? (ranked.rubricHash ?? "") : ""},
false,
''
```

Rollback: `vetta-audit/80-ingest-fix/api.ts.pre-fix`, byte-exact.

**Gates re-run after the change** (`npm test` 403 / 403 pass / 0 fail / 0 todo exit 0 · `typecheck` 0 ·
`eslint .` **0 errors, 46 warnings — baseline restored** · `npm run build` 0 · `check:auth` agree ·
`check:router-clock` invariants held). `prettier --check src/lib/recruiting/api.ts` is red, and was red on
the byte-identical pre-fix backup: the reformatting it wants sits at lines 30 and 383, not in my edit, and
prettier's own output for the six lines I touched matches the file exactly (`''` lives inside a `sql`
template literal, which prettier does not reformat).

**Proof the loop now closes:** sign-up → role from a template → rubric `Version 1 · active · founder_edit` →
paste resume → dialog closes → **ranked candidate in ~5 s** — score 17, "Skills 4/4 strong; must-haves 0/4",
a verbatim evidence quote, the calibration notice, provenance chips `Local · routed choice` and `Rubric v1`,
and live Shortlist / Hold / Out / Re-rank. 0 console errors. Screenshots and JSON verdicts:
`screenshots/qa-2026-11-04/`; harnesses kept out of the repo at `vetta-audit/80-ingest-fix/qa/` (left in
`scratch/` they added 1 lint error and 1 warning, breaking the baseline above).

**Two things this says about the audit's own claims.** First, `01-baseline-report.md`'s gate list was never
a behavioural proof, and §6's "UI unverified" caveat was the honest hedge — it is now closed, and it closed
by finding a bug, not by confirming health. Second, the correct reading of "zero behaviour regression" here
is _no regression introduced by the audit_ (still true, and the diff above is the evidence), not _the app
was working_ (it was not, on this path).

## 5. Format parity

`npx prettier --check` on the 14 Batch-4 files: 11 were **already** non-conforming before the audit
(this repo has no `format:check` gate and `npm run format` has never been run here), 3 were clean, and
2 of those 3 ( `model-registry.ts`, `rubric-types.ts`) were left with a stray trailing newline by the
automated cut. Both were repaired, so **no file's format status changed** relative to baseline. I did
not run `prettier --write` on the 11: reformatting them would bury the cleanup diff in unrelated
whitespace.

Batch 6 note, recorded because it nearly produced a false claim: `eslint.config.mjs` reports DIRTY
after my edit — and was **already** DIRTY before it. The repo's `.prettierrc` sets `printWidth: 100`
while the shipped template file wraps at 80, so prettier wants line 35 collapsed; that is the _only_
line it objects to, and it is pre-existing. My added blocks are conforming. Left alone deliberately
(reformatting it would add unrelated churn). `.prettierrc` does **not** apply to files outside the
project root, so checking the backup copy in `vetta-audit/` gave a misleading "clean" — the numbers
above are from re-checking with `--config .prettierrc`.

## 6. Checks I could not complete — and why

| Check                                                                                             | Blocker                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser render + console-error verification (`scripts/browser-smoke.mjs`, desktop **and** mobile) | Playwright's Chromium binary is absent on this machine: `Executable doesn't exist at …chromium_headless_shell-1234…`. Fixable with `npx playwright install` (~100 MB third-party download) — not done because it wasn't requested. **So I cannot claim the UI renders; I can only claim every route returns HTTP 200 with server-rendered markup and the built bundle boots.** |
| Authenticated UI flows (create role → ingest → shortlist in the browser)                          | Same blocker, plus the dev server was restarted for the dependency change and PGLite is per-process, so the in-memory demo rows are gone by design                                                                                                                                                                                                                             |
| Neon / `DATABASE_URL` path                                                                        | No managed Postgres credentials in this environment; every result above is the PGLite fallback                                                                                                                                                                                                                                                                                 |
| Live provider arms (L6 with keys, deep-rank against real models)                                  | No API keys exported in this shell; `providersAvailable: ["ollama"]` with circuits pre-opened. Yours to run: `npm run bench:live-arms -- --reps=3 --deepen-apps=30`                                                                                                                                                                                                            |
| E2E suite                                                                                         | None exists in the repo                                                                                                                                                                                                                                                                                                                                                        |
| CI                                                                                                | No CI configuration exists, so nothing ran "in CI" before or after                                                                                                                                                                                                                                                                                                             |

**Therefore:** zero regression is claimed for the tested surface — deterministic ranking/pricing/
routing outputs, all 24 `src` suites (**208 of 208 tests, §4b**), typecheck, lint, build, boot, route
availability, migration application, the auth invariant and the router clock replay. It is **not**
claimed for pixel-level UI behaviour, which this environment cannot observe (no Chromium binary, §6).
Batch 8 closed the last verification gap in this paragraph: `npm test` now runs **all 403 tests on
Windows, 403 pass** (§4c). The one product-side line in the audit — the `cmd.exe` quoting fix in
`scripts/with-app-env.mjs` — was reported, approved, applied, and re-verified on all three launch paths it
touches, so the claim no longer stops short of the build wrapper's own contract.
