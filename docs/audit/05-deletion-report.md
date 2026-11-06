# Vetta — Deletion Report (deliverable C)

Everything in this document was removed in Batches 1–4 after the plan in
`docs/audit/04-cleanup-plan.md` was approved. **Nothing here was deleted unrecoverably**: the
pre-audit tar.gz (`vetta-audit/00-snapshot/`), the pre-batch copies (`10-pre-batch/`,
`30-pre-batch4/`) and the parked originals (`20-batch3-removed/`, `99-bak/`) are all outside the
repo, so every line below can be restored byte-for-byte — and the restore routes are now
byte-compared, not assumed (see "Restore routes, verified" at the end).

One provenance precision: the snapshot was taken **before any audit change**, not before any change at
all. It contains the 32 `*.pre-*.bak` files from the earlier router/timeout/gate work, which proves it
post-dates that work — so the "pre-audit" baseline for these batches is the repo as it stood after the
router refactor, which is also exactly what `01-baseline-report.md` measured.

Total: **1,096 source lines removed** (52,812 → 51,716 across `src` + `scripts`), **8 source files
removed**, **33 package manifest entries removed** (80 installed packages, incl. transitives),
**964 KB of artefacts** moved or deleted.

The 51,716 figure is the **post-removal** count as of Batches 1–4, and it is the number every "removed
N lines" claim below is measured against. Batch 7 later **added** 118 lines of tests
(resilience.test.ts 661 → 674, grounding-and-adversarial.test.ts 418 → 523), taking the tree to 51,834;
nothing was removed in Batch 7, so this report's totals are unchanged by it.

---

## Batch 1 — clutter

| Item | Size | What it was | Why safe | Restore |
| --- | --- | --- | --- | --- |
| `{}` (repo root) | 0 B | an empty file literally named `{}` — a shell redirection accident from Oct 30 | not a valid module name, 0 references, 0 bytes | n/a |
| `bench-run-1.log`, `bench-run-2.log`, `bench-run-3.log` | 199 KB | Nov 1 console captures of `npm run bench:match` runs | 0 references in `src`, `docs`, `scripts`, `artifacts`, `.grok`; the same data lives in `artifacts/benchmarks/*.json`, which **was kept** | re-run the benchmark |
| `scratch/burst-phaseA.json`, `burst-router-v3.json`, `burst-router-v4.json` | 4 KB | my own burst-measurement intermediates from the router work this session | written by me, consumed by nothing | numbers are in `docs/audit/01` |
| 32 `*.pre-*.bak` | 625 KB | my pre-edit copies of production files (`.pre-router`, `.pre-timeout`, `.pre-gate`, `.pre-beliefcache`, `.pre-rubrichash`, `.pre-utf8fix`, `.pre-watchignore`) | `tsc` and `eslint` never match the `.bak` suffix, and both audit counters exclude them by design, so no tool depended on their presence; the router work they protected is verified by 180 passing tests + build | `cp` back from `99-bak/` |

Deliberately **retained**: `screenshots/` (all 26 — three are the documented `browser-smoke.mjs`
output paths), `.output/` (regenerated), `attachments/` (gate item 1, your uploads), `artifacts/`
(referenced by the pricing doc), `startup.sh`, `vercel.json`, `.grok/`, `server/`, `public/__grok/`.

## Batch 3 — confirmed-dead source files (686 lines, 8 files)

Standard applied to each: 0 importers on the exact module path **and** on every dynamic/string form
across 281 scanned documents (`src`, `scripts`, `server`, `migrations`, `docs`, `public`,
`package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vercel.json`, `startup.sh`,
`AGENTS.md`, `.env.example`); not a framework-convention file (route, middleware, manifest,
migration, seed); no namespace import (`import * as`) and no string-keyed export lookup anywhere in
app code, which are the two ways a zero-importer module can still be reachable.

| File | Lines | Contents | Evidence |
| --- | --- | --- | --- |
| `src/lib/multiplayer/p2p.ts` | 570 | WebRTC peer-connection scaffolding, ICE handling, data-channel helpers from the app-builder template | only references were from `index.ts` in the same folder and a `.grok` skill doc |
| `src/lib/multiplayer/index.ts` | 9 | barrel for the above | 0 importers; the folder is now gone |
| `src/lib/preview-host-bridge.ts` | 18 | `postMessage` bridge for the preview chrome — **a duplicate** | `src/routes/__root.tsx:4` imports `@/components/preview-host-bridge` (a different, live file). The AGENTS.md rule-3 contract (`<PreviewHostBridge />` mounted) is untouched — verified: `/` still renders the bridge |
| `src/lib/preview-embedder-origin.ts` | 19 | embedder-origin helper for the same scaffold | 0 importers |
| `src/components/ui/scroll-area.tsx` | 23 | shadcn Radix scroll-area wrapper | 0 consumers; the script's single "hit" was the `@radix-ui/react-scroll-area` package string in `package.json` |
| `src/components/ui/separator.tsx` | 23 | shadcn Radix separator wrapper | same |
| `src/lib/recruiting/seed.ts` | 3 | `/** Sample/demo seed removed … */ export {};` | the counter's 89 "refs" were the English words "seed"/"seeded" in `role-form.tsx`; an exact `from "…/seed"` grep returns nothing |
| `src/lib/app-data/index.ts` | 21 | re-export barrel for the connector modules | every `app-data` consumer imports the concrete file (`login.ts`, `errors.ts`, `client.server.ts`, `use-connector-readiness.ts` …), all 10 of which remain and are live |

## Batch 4 — dead exports inside live files (410 lines, 14 files)

Each symbol was at **exactly 1 occurrence = its own definition line** before removal, re-checked for
namespace imports and dynamic lookup. Cutting was done by a script that asserts each block ends on a
terminator and **skips** anything ambiguous — `updateCandidateNote` was skipped by the script and cut
by hand for exactly that reason (its neighbour begins with a JSDoc, so the automatic boundary was
unresolved rather than guessed).

| Symbol | File | Lines | Notes |
| --- | --- | --- | --- |
| `updateRole` | `recruiting/api.ts` | 40 | server-fn; no client import ⇒ TanStack never wired it |
| `listTalent` | `recruiting/api.ts` | 34 | same; the live talent surface uses `searchTalent` |
| `submitPortalScreen` | `recruiting/portal.ts` | 122 | largest single removal; the portal screen flow goes through `autonomous-portal-api.ts`, which is wired to `routes/app/portal.tsx` and `routes/portal/$slug.tsx` |
| `completeWithSchemaValidation` | `recruiting/ai-retry.server.ts` | 76+3 | superseded by `completeWithRetry` + the router path; no test referenced it |
| `labelRank` | `recruiting/harness/api.ts` | 25 | unwired server-fn; `harness/api.ts` keeps `getHarness`, `runHarnessEval`, etc. |
| `ensureHarnessReady` | `recruiting/harness/api.ts` | 6 | same |
| `calibrationStatus` | `recruiting/calibrate.server.ts` | 22 | the desk reads calibration through `api.ts` |
| `updateCandidateNote` | `recruiting/collaboration.server.ts` | 26 | cut by hand; `updateWithOptimisticLock` then became orphaned and was removed with it |
| `localFollowUp` | `recruiting/local-rank.ts` | 9 | a `_input`-prefixed stub that returned a constant |
| `weightToNumber` | `recruiting/rubric-types.ts` | 6 | + its doc comment |
| `useRoleSharesQuery` | `recruiting/query.ts` | 7 | react-query hook; `listRoleShares` import removed with it |
| `loadRubricById` | `recruiting/rubric-version.server.ts` | 6 | `rubric-api.ts` exposes the live variant |
| `armPrice` | `recruiting/model-registry.ts` | 3 | the router prices through `predictCostUsd` in `observability/cost.ts` |
| `jobApplyPath` | `recruiting/links.ts` | 3 | `applyPath` is the one in use |
| `embeddingModelName` | `recruiting/embed-text.server.ts` | 3 | |
| `APP_TAGLINE` | `recruiting/constants.ts` | 1 | `APP_NAME` kept; the tagline is hard-coded in the shell |

**12 orphaned identifiers removed with them** (the newly-unused imports/consts this created — found by
diffing the ESLint output, 46 → 58 → back to 46 warnings):
`ai-retry.server.ts` `z` + `extractAndValidateJson`; `harness/api.ts` `fitSchema` + `verdictSchema`;
`api.ts` `RoleInput` + `TalentRow` + `roleStatusSchema`; `collaboration.server.ts`
`updateWithOptimisticLock`; `query.ts` `listRoleShares`; `model-registry.ts` `modelPriceFor`;
`portal.ts` `ClientCard` + `ScreenQuestion`. Two files (`model-registry.ts`, `rubric-types.ts`) gained
a stray trailing newline from the cut; both were restored to prettier-clean, matching their pre-batch
state.

**Measured file-level deltas** (`wc -l` of `30-pre-batch4/<path>` vs the working tree, so this is the
cut itself and nothing else):

| File | Before | Now | Removed |
| --- | --- | --- | --- |
| `portal.ts` | 593 | 469 | 124 |
| `ai-retry.server.ts` | 144 | 65 | 79 |
| `api.ts` | 1359 | 1282 | 77 |
| `harness/api.ts` | 95 | 60 | 35 |
| `collaboration.server.ts` | 440 | 412 | 28 |
| `calibrate.server.ts` | 154 | 132 | 22 |
| `local-rank.ts` | 175 | 166 | 9 |
| `query.ts` | 147 | 139 | 8 |
| `rubric-types.ts` | 62 | 55 | 7 |
| `rubric-version.server.ts` | 498 | 491 | 7 |
| `model-registry.ts` | 516 | 511 | 5 |
| `embed-text.server.ts` | 246 | 242 | 4 |
| `links.ts` | 62 | 58 | 4 |
| `constants.ts` | 162 | 161 | 1 |
| **Σ** | **4653** | **4243** | **410** |

Read the two tables together with this one: the per-symbol column above counts the **symbol block only**,
the Removed column here counts **symbol block + its orphaned identifiers**, which is why e.g. `api.ts`
shows 40 + 34 = 74 symbol lines but 77 removed (`RoleInput`, `TalentRow`, `roleStatusSchema`). The
410 in this heading is the measured total, not an addition of the rows above.

## Restore routes, verified rather than asserted

The paragraph above promised "byte-for-byte" without me having tested it. Tested now, by extracting
from the tarball into a scratch dir and `cmp`-ing against the parked copies:

| Restore route | Contents | Verified |
| --- | --- | --- |
| `vetta-audit/00-snapshot/vetta-source-pre-audit.tar.gz` | 97,305,817 B, **536 entries**, `node_modules` excluded, taken 2026-11-03 20:18, before any audit change | contains `src/lib/multiplayer/p2p.ts`, `src/lib/recruiting/seed.ts`, `src/components/ui/separator.tsx`, `src/lib/recruiting/api.ts`, `eslint.config.mjs` — i.e. both deleted files and edited files |
| `vetta-audit/20-batch3-removed/` | **8 files** = the 8 rows above, same paths | `cmp` IDENTICAL to the tarball for `p2p.ts`, `seed.ts`, `separator.tsx` |
| `vetta-audit/30-pre-batch4/` | **14 files** = exactly the 14 live files Batch 4 cut | pre-cut originals, per-file |
| `vetta-audit/10-pre-batch/` | **3 files**: `package.json`, `package-lock.json`, `vite.config.ts` | Batch 2 (dependencies) restore route |
| `vetta-audit/99-bak/` | **32 `*.pre-*.bak`** | matches the Batch 1 count exactly |
| `vetta-audit/40-pre-batch6/` | `eslint.config.mjs`, `package.json` | Batch 6 route; `eslint.config.mjs` `cmp` IDENTICAL to the tarball copy |

**Arithmetic self-check that caught an error in this document.** Batch 3's per-file `wc -l` sums to
**686**, not the 685 originally recorded, because `seed.ts` is 3 lines (`/** … */`, blank,
`export {};`) and I had counted its two statements. Corrected here, and in `04-cleanup-plan.md` §Batch 3
(which additionally mis-stated the file count as 7 rather than 8). The correction is confirmed by an
independent measurement: 686 + 410 = **1,096**, which is exactly the LOC delta
52,812 − 51,716 = **1,096** — two unrelated ways of counting the same removal now agree, where before
they were off by one.

Recovery command for any single path:

```sh
tar -xzf ~/vetta-audit/00-snapshot/vetta-source-pre-audit.tar.gz -C /workspace ./src/lib/multiplayer/p2p.ts
```

## Not deleted, on purpose

The 5 unwired `*-api.ts` capability surfaces + `team-api.ts` + `search-api.ts`, `live-pipeline.ts`,
the 9 orphaned test suites, the 5 auth/session exports (`SignedIn`, `SignedOut`, `SignInGate`,
`readSessionToken`, `getConnectorAccessToken`), `formatRupees`, `completeWithLadder`,
`deepenTopCandidates`, `hasActiveConsent`, `setOrgRetentionDays`, `restoreEmbeddingWorker`, all 27
migrations, every env var name, and all 11 duplicate-implementation pairs. Reasons are in
`docs/audit/02-repository-health-report.md` §3.F and the approval gate in
`docs/audit/04-cleanup-plan.md`.
