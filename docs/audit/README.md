# Vetta — codebase audit: read in this order

Nine documents, one mission: **complete audit, dead-code elimination, architecture refactoring — with zero
behaviour regression.** Every claim below is measured on this machine (Windows host, `DATABASE_URL` unset
so the app runs on PGLite, no API keys exported). Nothing ran in CI, because this repo has no CI.

| #     | Deliverable                       | File                             | What it answers                                                                       |
| ----- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| —     | Baseline, taken before any change | `01-baseline-report.md`          | what was true at start, and the rollback snapshot                                     |
| **A** | Repository health (Phases 1–2)    | `02-repository-health-report.md` | the whole-repo reference map, and every file classified A–F with evidence             |
| **B** | Architecture analysis (Phase 5)   | `03-architecture-analysis.md`    | boundaries, dependency direction, and why the moves were deferred                     |
| —     | Cleanup plan + approval gate      | `04-cleanup-plan.md`             | the batched plan, and the 6 items never done unilaterally                             |
| **C** | Deletion report                   | `05-deletion-report.md`          | exactly what was removed, why each was provably dead, how to restore                  |
| **D** | Refactoring report                | `06-refactoring-report.md`       | what was restructured, and what deliberately was not                                  |
| **E** | Regression report (Phase 9)       | `07-regression-report.md`        | before → after on every gate, with the corrections I made to my own earlier reasoning |
| **F** | Remaining technical debt          | `08-remaining-technical-debt.md` | what is still broken, sized, with the decisions attached                              |

## Final state of the gates

```
npm test            403 tests = 195 scripts + 208 src   403 pass / 0 fail / 0 todo   exit 0
npm run typecheck   clean
npm run lint        0 errors, 46 warnings (baseline had 1 error)
npm run build       exit 0
dev :8080           /  /jobs  /login  /app  → 200, bound 0.0.0.0, left running
built output :8081  /  /jobs  /login  /app  → 200
npm run check:auth  dev and build agree: sign-in on
check:router-clock  All replay invariants held
real browser        dev + built output, desktop 1440 and mobile 390×844: styled render,
                    0 console/page errors, no horizontal overflow, authenticated
                    /app surfaces and the full ingest→rank pipeline verified
```

Log: `C:/Users/punam/vetta-audit/60-pre-gate5/final-regression.txt`, then
`C:/Users/punam/vetta-audit/80-ingest-fix/` for the browser pass and the ingest fix that followed it.
Rollback, in order of increasing precision: `vetta-audit/00-snapshot/vetta-source-pre-audit.tar.gz` (the
whole tree, taken before any audit change), then `10-pre-batch/`, `20-batch3-removed/`, `30-pre-batch4/`,
`40-pre-batch6/`, `50-pre-testfixes/`, `60-pre-gate5/`, `80-ingest-fix/`, `99-bak/` (per-file `.bak`). This checkout is not a
git repository, so those directories are the only rollback path and no file in the tree was overwritten
without one.

> **Two things above are no longer true, and both changed on purpose.** As of 2026-11-07 this **is** a git
> repository — `git init` was Batch 0 of the restructure, whose 10 batches (rails → prettier → tier fixes →
> `platform/` → `shared/components/` → nine `features/` folders) are one commit each, so `git revert` is now
> the primary rollback and `.bak` files are not being made. That is what made the deferral in
> `03-architecture-analysis.md` §5 obsolete; its numbers still hold. And the gate line above is the _audit's_
> final state, not the current one: `npm test` is now **419 = 211 scripts + 208 src** (the restructure added
> `move-tree.test.mjs` and the codemod's fixtures), with `npm run check:tree` — the restructure's own gate,
> which re-runs the boundary-rule probes and would fail if any glob stopped matching — added on top. Same
> 0 typecheck errors, same 0 errors / 46 warnings from lint, same build, same eight `200`s on dev `:8080` and
> built `:8081`. Nothing in this section was edited to match, because these nine documents are dated records
> of what was measured when they were written.

## What the audit changed

**Removed:** 1,096 lines and 80 unused package entries, plus whole files proven dead — the template
scaffolding, the empty `seed.ts`, two unused UI primitives, 16 never-imported exports with their 12
orphaned imports, 32 `.bak` files, the 0-byte `{}`, three stale benchmark logs and my own scratch JSONs.
`05-deletion-report.md` lists every one with the references examined and the restore command.

**Edited, by batch:** 14 live files in Batch 4 (dead exports cut in place), `eslint.config.mjs` and
`src/lib/recruiting/README.md` in Batch 6, two `src` test suites in Batch 7, then `package.json` and three
`scripts` test suites in Batch 8 plus **`scripts/with-app-env.mjs`** (quote `cmd.exe` command tokens — the
app's launch path, so re-verified on dev, build and preview) and **`scripts/apply-200-candidates.mjs`** (a
style-only ternary → the equivalent `if`/`else`). The last two are the only behaviour-side edits in the
audit proper, both reported before they were applied and both inert for anything that worked beforehand.

**Changed after the audit closed, on approval (`07` §4d):** a browser pass over the running app found that
`ingestResume` wrote `NULL` into four `not null default ''` columns of `applications` — `model`, `provider`,
`rubric_hash` and a hardcoded literal `null` for `stale_reason` — so the single-resume **"Add one / Paste
one"** path failed on _every_ call and showed no error. Four values in `src/lib/recruiting/api.ts` now match
the pattern `queue.server.ts:284-300` already uses. This is the one edit in the whole engagement that alters
how a product path runs, it is **not** something the audit introduced (the insert is byte-identical to
`00-snapshot`, and `ai.server.ts`, both role routes, `role-form.tsx`, `vite.config.ts`, `styles.css` and
`__root.tsx` are unchanged), and it is a bug fix, not a cleanup: the path went from always-broken to working.

**Never touched:** no module moved, no export or route renamed, no prompt, model configuration, provider
fallback order, database schema, migration or environment variable name changed — and
`src/lib/recruiting/` (ingestion, matching, ranking, providers, RBAC, consent, queues, provenance) lost no
code beyond the exports `05` proves unreachable.

## Four decisions still yours

`04-cleanup-plan.md` lists six gate items; items 4 and 5 are closed (the fallback contract and the test
gate). These four remain open because each is a product judgement, not a cleanup:

1. **`attachments/` (91 MB)** — your own uploaded archives, not project code. The single biggest size win
   available, and deleting a user's uploads is not an audit's call. Keep or delete.
2. **The 5 unwired `*-api.ts` surfaces + `team-api.ts` + `search-api.ts` (517 lines)** — `analytics`,
   `backup`, `dedicated-search`, `embedding`, `privacy`. Each wraps a live `.server.ts` capability and
   reads as planned-not-yet-built. `privacy-api.ts` is the consent/erasure surface, so removing it would
   reduce auditability while looking like tidying. Keep (default) / delete / wire one up.
3. **`live-pipeline.ts` (536 lines)** — 0 importers, and it writes synthetic "Northbeam"/"Lumenfold"
   applicants into **real** tables; `scripts/apply-200-candidates.mjs` is the demo path that superseded it.
   Unreferenced inside the scanned surface, but a script outside it could still call it by path.
   Keep / delete / move to `scripts/` where its write side-effects are visible.
4. **Two label-vs-reality divergences that are real bugs and also behaviour changes** — (a) `describeAi`
   reports the default model as `llama-3.3-70b-versatile` while `providers.server.ts:156` and the registry
   default to `openai/gpt-oss-20b`, so the desk can name a model the call never made; (b) `cacheKey`
   declares a `rubricHash` input it omits from the key, with two hand-written invalidation blocks
   compensating. Both are ranking-provenance sensitive, so either fix changes observable output.

Closest relative among the debt items, also a decision rather than a cleanup: the provider ladder
(`completeWithLadder`) still lives beside the router (`planRoute`) with 5 passing test uses — is it the
documented fallback semantics, or retired with its tests moved to the router (`08` §1)?

Plus two structural gaps no cleanup closes: **there is still no CI**, and **there is still no read-only
format gate** — `prettier --check` is red on 730 files repo-wide, so adding one needs a ratchet or a
scoped pass, not an extra script.

## The one limit on every claim here

**Closed since the first draft of this sheet:** UI rendering _is_ now verified. Playwright's own Chromium
is still absent (the cached build is 1223, the installed module wants 1234, and nothing was downloaded), but
the pass runs against the Edge binary already on the machine via `channel: "msedge"`. That is what exposed
the ingest defect above — every gate in this audit was green while the product's main action was dead,
because no gate had ever opened a browser.

Still unmeasured: **live cloud provider arms** (no keys in this shell) — run
`npm run bench:live-arms -- --reps=3 --deepen-apps=30` for that. And the browser pass covers one recruiter
account, one role and one resume; a 200-applicant burst through the _UI_ (as opposed to
`scripts/apply-200-candidates.mjs`) has not been run.

## Three more things the browser pass found, reported not fixed

1. **The built HTML links a stylesheet that 404s.** The SSR bundle emits `styles-47VNiNFP.css`, which is
   only ever written under `node_modules/.nitro/…`, while the client build emits
   `styles-BJQTlV3f.css` into `.output/public/assets/`. A clean rebuild reproduces both hashes exactly, so
   it is deterministic, not stale cache. Pages still render fully styled — the client bundle injects the
   real file — so the cost is a console error on every built page plus a first-paint risk, not a blank app.
   Source is `import appCss from "../styles.css?url"` in `__root.tsx`, unchanged since before the audit.
2. **The ingest dialog never renders `ingestMut.error`.** That silence is why a 100%-failing path survived
   unnoticed; fixing it is a UI behaviour change, so it is a decision, not a cleanup.
3. **Login offers Google/GitHub unconditionally.** `SOCIAL_PROVIDERS` is a hardcoded list rendered whenever
   `authEnabled`, so with no OAuth credentials configured the button dead-ends on a 404.
